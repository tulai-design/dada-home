# 本地存储、应用迁移与备份审查

核对日期：2026-10-28。基线提交：`9315c03`。范围为本地持久化及与备份、同步接壤的契约；未操作真实浏览器、同步配置或远端数据，未修改产品代码。

## 结论

AI 应用尚未使用 IndexedDB：App 的 `tada.store` 直接读写 `fp.app.<id>`；Applet 的 `persist` 经 `store.ts` 读写 `fp.applet.<id>`。内置组件业务数据和聊天使用 IndexedDB，但当前数据库包装会吞掉事务失败，组件写入队列会提前移除待写项，并存在并发批次中的旧删除覆盖新写入风险。因此“将两个应用调用点改为 `componentData.writeData`”不足以交付可靠迁移。

优先级应分两阶段：**第一阶段先修可靠写入、备份和同步虚假删除；第二阶段再迁移应用，完成独立命名空间、幂等迁移、保存反馈和旧新同步身份兼容。**应用迁移交付需要这些条件闭环，但不应先搬数据再修共同存储基础。保留现有容量策略并精确说明计量单位；扩容、按记录拆分大型应用状态和按需加载可单独验收。把 100000 改成更大的数字不能修复当前丢失路径。

## 已证实的存储地图

| 数据 | 实际位置、读写方式 | 证据 |
| --- | --- | --- |
| 工作空间、页面、应用安装记录、应用设置、主题、模板 | `localStorage['fp.workspace']`，读取经 `migrate`，写失败仅保留内存状态 | `src/lib/workspaceStore.ts:24,249–266`；`src/lib/applications.ts:185–200,237–240` |
| 通用设置、用户画像、已读记录等 | `store.ts` 对 `fp.<key>` 做同步 JSON 读写，模块内存缓存优先；这不是 IndexedDB 适配器 | `src/lib/store.ts:12–35`；`src/App.tsx:61,79,88,292` |
| 内置组件实例业务数据 | IndexedDB `dada` v1 的 `kv` 仓库，行是 `{k: instanceId, v: value}`；启动读全部进内存，写入合并 300ms；无法打开库时回落到 `fp.data.<instanceId>` | `src/lib/db.ts:15–38`；`src/lib/componentData.ts:14–24,35–47,59–85,99–131` |
| 共享业务数据 | 同一 `kv` 仓库，ID 如 `@shared.feeds`、`@shared.bookmarks`、`@shared.events`、`@shared.focusLog` | `src/lib/componentData.ts:178–199` |
| 聊天会话和轮次 | IndexedDB `convs`、`turns`；`turns` 有 `convId` 索引；当前会话 ID 仍保存为 `fp.conv` | `src/lib/db.ts:36–38`；`src/lib/chat.ts:81–83,111–113,141–149,155–178,210` |
| App 私有业务数据 | `localStorage['fp.app.' + instance.id]`，一个 JSON 对象覆盖保存全部键；`tada.store.get/set` 是异步消息桥，但宿主实际写入仍为同步 localStorage | `src/widgets/app.tsx:118–120,220–242,298–317` |
| Applet 私有业务数据 | `localStorage['fp.applet.' + instance.id]`，整个 persist 对象；初次 `ready` 读取，之后每个 `save` 写入 `store.ts` | `src/widgets/applet.tsx:7,70,95–109`；`src/lib/applet/runner.ts:79–93,130–140` |
| 沙盒里直接使用的 localStorage/sessionStorage | 无持久化权限时替换成沙盒内存 Map；不进入宿主备份或任何真实持久化路径 | `src/widgets/app.tsx:108–112`；`src/lib/applet/runner.ts:32–35` |

启动在 `initStorage` 完成后才渲染；其顺序是组件数据、聊天，再开始同步和 React 渲染。见 `src/lib/storage.ts:10–13`、`src/main.tsx:60–70`。**聊天没有 `componentData` 那样的 localStorage 回落**：IDB 不可用时查询得到空数组、写操作返回正常 `undefined`；`db.ts:12` 的笼统注释不能当作聊天已具备回落的证据。

## 100000 的准确语义

1. 两个宿主各有 `MAX_STORE = 100_000`，都比较 `JSON.stringify(...).length > MAX_STORE`。因此是**每个应用完整 JSON 字符串最多 100000 个 UTF-16 代码单元**，包含 JSON 标点与键名；不是每字段上限，不是 UTF-8 字节数，更不是 IndexedDB 或浏览器配额。见 `src/widgets/app.tsx:32,237–241`、`src/widgets/applet.tsx:20,105–109`。
2. ASCII、中文 BMP 字符和 emoji 的 UTF-8 字节数与 `.length` 不同；现有“100KB”错误文案及运行时指南不精确。现状契约已承认差异：`docs/specs/runtime-contract.md:76–78`。迁移时不能悄悄改成按 UTF-8 字节计量，否则相同中文旧记录可能从合法变成超限。
3. App 超限会 reject `tada.store.set`；localStorage 自身 quota/权限错误也会沿宿主拒绝分支返回 SDK。Applet 超限只显示宿主错误，未发送保存确认；小于限额但 localStorage 写失败被 `store.ts` 吞掉。见 `src/widgets/app.tsx:88–106,240–241,314–317`、`src/widgets/applet.tsx:105–109`、`src/lib/store.ts:28–35`。
4. Applet runner 发出 `save` 前就把 `lastSaved` 更新为新值；宿主失败不会回退标记，相同状态后续 render 不再重发。见 `src/lib/applet/runner.ts:90–93`。只加宿主 toast 不能恢复可靠重试。

## 失败、排队、迁移与生命周期风险

| 优先级 | 已证实事实与触发条件 | 对结果的影响 | 证据 |
| --- | --- | --- | --- |
| P1 | `db.run` 遇到打不开、请求失败、事务 error/abort 均返回 fallback；`put/putMany/del/clear` 的 fallback 与成功返回均为 `undefined` | 调用方 `await` 完成不能证明落盘；读失败还会伪装成“没有记录” | `src/lib/db.ts:61–76,79–104` |
| P1 | `componentData.flush` 先清空 pending/gone，再 await 独立 put/delete；失败不重新入队，函数也没有进行中任务的互斥/等待 | 错误后的内存更新看似正常，后续 flush 不会重试；另一个 flush 可能早于旧批次完成而返回 | `src/lib/componentData.ts:35–47,118–132` |
| P1 | 旧批次包含 `put(unrelated)` 和 `delete(x)`，在第一步未完成时新批次 `put(x)`；旧删除最后创建事务 | 结果可能为内存 x 存在、持久化 x 被删。隔离串行事务夹具已复现操作顺序 `put:unrelated → put:x → del:x` | `src/lib/componentData.ts:38–43,135–141`；本报告“验证记录” |
| P1 | 聊天迁移在两次 await 写入后直接删除 `fp.chatTurns.v2`，未检查是否提交；无 IDB 时两次 await 也正常返回 | 旧聊天可能在未成功进入库时被删除；组件迁移的回读保护没有覆盖聊天 | `src/lib/chat.ts:116–137`；`src/lib/db.ts:62–75,84–92` |
| P1 | Applet 的 writeStored 先更新 memory 再尝试 localStorage，catch 后通知订阅；runner 没有保存 ack | 刷新、重新加载或退出后回到旧值，而当前界面没有可靠的“未保存”信号 | `src/lib/store.ts:28–35`；`src/widgets/applet.tsx:105–109`；`src/lib/applet/runner.ts:90–93` |
| P2 | 组件旧数据迁移先设置 `useIdb=true`，循环中的 JSON.parse 由整个循环外的 catch 包围 | 单条坏 JSON 会中断后续迁移；未搬入 cache 的其他合法旧键虽然仍存在 LS，却不会再由 readData 读取 | `src/lib/componentData.ts:59–88,99–115` |
| P2 | 组件迁移首次读库失败与“库为空”一样返回 []；此时 legacy 被当作目标不存在并 put | 如果旧 LS 与更新的 IDB 同名记录同时存在，读错误可使旧值覆盖新值；应区分缺失和读取失败 | `src/lib/componentData.ts:63,75–84`；`src/lib/db.ts:74–81` |
| P2 | `onversionchange` 仅 close 数据库，`opened`/ready 不重置；`onblocked` 先 resolve(null)，之后异步 success 仍可设置 ready | 当前会话无完整重连状态；关闭连接后操作失败被吞掉，openDb 缓存阻止重试；blocked 路径的 promise 与 ready 可能不一致 | `src/lib/db.ts:20–52` |
| P2 | 聊天 flush 与组件 flush 一样先清 dirty/removed，再写库；聊天轮次和会话元信息分两仓写 | 写失败不能重试，也可能出现轮次和会话列表不一致 | `src/lib/chat.ts:155–174` |
| P2 | 组件与聊天只在 pagehide/hidden 时触发异步 flush，既无业务侧提交确认，也无进行中队列屏障 | 代码不能保证离开页面前已持久化；必须以实际提交确认定义“已保存”，不能把事件触发当作完成 | `src/lib/componentData.ts:50–52`；`src/lib/chat.ts:181–183` |

应用身份与清理必须保持原契约：`applicationInstance` 在各形态保留 canonical ID（`src/lib/applications.ts:237–240`）；卸载不删除应用私有数据（`:212–215`），以便撤销。普通组件移除调用 `removeData(instanceId)`（`src/App.tsx:544–547`），它删除 `kv` 的裸实例 ID（`src/lib/componentData.ts:135–141`）。**若迁移成 `writeData(application.id, ...)`，会让页面移除路径删掉应用业务数据**。新位置必须有独立应用命名空间或独立仓库，不能复用裸组件 ID。

## 备份的实际契约与缺口

当前文件是没有显式格式版本的 JSON 对象：顶层各 `fp.*` 项为原始 JSON 字符串，另有 `indexedDB: {chat: {convs, turns}, kv}`。设置页遍历全部 `fp.*`，包括应用数据、同步配置/元数据；`exportIdb` 读全部三仓。见 `src/components/SettingsPage.tsx:56–68`、`src/lib/storage.ts:25–28`。导入整体替换而非合并，与 README 文案一致（`README.md:94–103`）；不能在修复中改成隐式合并。

- **导出漏掉刚改的数据。** 设置页导出没有 flush；`exportIdb`/`exportChat` 也没有。组件 300ms、聊天 400ms 的未落库窗口会进入旧备份。即使新增简单 `await flush()`，目前它不等待其他已在执行的批次，还会吞写入错误，所以还需真正的提交屏障。证据：`src/components/SettingsPage.tsx:56–63`、`src/lib/storage.ts:26–28`、`src/lib/chat.ts:269–272`、`src/lib/componentData.ts:35–47`。
- **读取失败会生成看似完整的空仓备份。** `db.all` 用 [] 作为读失败回退；导出不能区分没有数据和读取失败。证据：`src/lib/db.ts:74–81`、`src/lib/storage.ts:26–28`。
- **格式校验不能保证可恢复。** `parseBackup` 只要求至少一个字符串型 `fp.*` 键或 truthy `indexedDB`；无对象/数组/记录结构的严格校验。`{"indexedDB":true}` 可通过。见 `src/lib/storage.ts:34–48`。
- **先清后写，失败没有恢复点。** `importBackup` 清聊天、清 kv，再逐仓 put，然后删全部 `fp.*` 并逐项写回，最后 reload。数据库失败可静默造成不完整恢复；localStorage 失败会在部分替换后抛错，设置页显示错误但已经改动数据。见 `src/lib/storage.ts:55–69`、`src/components/SettingsPage.tsx:360–369`。
- **局部过滤并非完整验证。** kv 只验证 `k` 字符串，convs/turns 只验证 `id` 字符串；未验证关联、重复 ID、合法值或 `fp.workspace` 内部 JSON。非法项被过滤后仍继续整体替换。见 `src/lib/storage.ts:62–67`。
- **丢弃队列不等于终止正在执行的批次。** `dropPendingData` 只 clear timer/pending/gone，不等待已捕获 rows/dels 的 flush；导入期间旧批次仍可继续下一步。见 `src/lib/componentData.ts:35–43,91–97`。恢复出厂也有同类边界（`src/lib/storage.ts:16–22`）。实际竞态的完整导入时间线尚待专门测试，不能把它描述成已复现的真实数据事故。
- **替换成功前需确认后端可用。** 当前导入即使 IDB 无法打开也继续清 LS 并 reload，备份中的 IDB 数据没有其他落点。见 `src/lib/storage.ts:59–69`、`src/lib/db.ts:62–75`。

## 与同步联动的边界

当前应用业务数据在同步中的记录 ID 为 `ls:fp.app.<id>` / `ls:fp.applet.<id>`；`kv` 行对应 `kv:<row.k>`（`src/lib/sync.ts:207–225`）。迁移并删除旧 LS 键后，同步会将旧身份标记墓碑，同时认为新的 kv 身份是新增记录（`:429–436`）。旧客户端或远端旧 `ls:` 记录仍能经 applyOne 写回 LS（`:230–249`）。这不能靠“同步已经自动扫描 kv”解决。

建议在发布迁移切片前确定一种兼容方式：保持应用的同步逻辑身份不变而改变本地适配位置，或显式版本化并实现别名迁移；不能让同一份业务状态成为两个可独立冲突的记录。旧新客户端并存、远端删除、卸载后保留和旧备份恢复必须都有确定结果。详细远端格式和并发同步策略由同步专项研究负责。

同步本身已在 collect 前调用组件/聊天 flush（`src/lib/sync.ts:420–423`），但沿用当前“无失败、无进行中屏障”的 flush 仍不足以保证快照可靠。

**同步虚假删除必须在第一阶段联动修复。**读库失败返回 [] 后，collectLocal 将该仓库表现为空，再由 `src/lib/sync.ts:435–436` 为先前已知的记录写墓碑。当前的“读取失败”可能变成“用户删除”并传播；严格读取失败应使本轮同步中止，不能进入差异推断、墓碑、元数据更新或远端提交。此处是依据真实调用链的风险推导，尚未执行完整同步夹具或远端复现。

## 最小可靠统一迁移切片（建议，尚未实现）

### 1. 建立可确认持久化的共同边界

- 数据库读需区分“键不存在”“后端不可用”“读失败”，写在事务 complete 后成功；事务 abort/error 必须可观察。可以渐进新增严格接口再迁调用点，但应用、迁移、备份、同步路径不得继续把 fallback 当成功。
- 应用私有状态共用一个宿主存储入口，保留 `app`/`applet` 类型和 canonical ID。最小方案复用现有 `kv`，增加保留前缀的应用命名空间（例如 `@application.app.<id>` / `@application.applet.<id>`），避免裸 ID 清理路径；是否新增独立仓库可在设计时比较，不能同时保留两处正文事实来源。
- 若继续批处理，队列须串行并保留未提交版本，失败可重试；较新写入不能被旧 ack、旧 delete 或重试快照覆盖。`flush` 必须等待本次屏障之前的全部正在执行/排队工作；reset/import 需要暂停新写、排空或取消旧批次的明确生命周期。
- App 的 `set` Promise 在实际事务提交后 resolve；Applet 增加保存序号和宿主成功/失败回复，runner 的“已保存”标记在相应确认后推进。失败有可见状态和重试；切换形态时能区分已保存状态与尚在处理的写入。

### 2. 迁移与容量兼容

- 每条 `fp.app.*` / `fp.applet.*` 独立解析校验；单条损坏不阻断其他记录。保留业务值、应用 ID、设置/业务数据分离与卸载保留契约。
- 目标不存在时写入，事务成功后才清该旧键；目标已存在时有明确优先级。读取失败时中止该条迁移，不当作空目标；重复启动、迁移中断、旧备份恢复均能安全重跑。
- 后端不可用时显式保留 legacy，应用显示当前保存能力。可继续明确 localStorage 降级，但降级失败不能静默只留内存；后端恢复后的回迁行为必须可重复。
- 第一切片保留 100000 代码单元限制并修正文案；迁移历史大值不得截断。若用户要求扩容，再明确单应用上限、实际计量方式、持久化失败和导出规模的行为，不能承诺 IndexedDB 无限容量。

### 3. 备份与同步闭环

- 导出先取得存储屏障并检查读取结果；包含应用最新已接受修改及完整聊天/组件数据。失败时明确中止下载或提供“无法完成备份”状态，不能生成误导性的空仓成功文件。
- 在任何 destructive clear 前完整解析、验证、迁移旧文件，确认目标后端可写。保留整体替换语义；利用 IDB 多仓事务或暂存/恢复协议，避免逐仓失败留半套数据。localStorage 与 IDB 无共同事务，需要设计明确的恢复点与失败恢复流程。
- 新备份建议增加显式格式版本，同时支持现有无版本 `fp.* + indexedDB` 文件。旧应用 LS 项与新 IDB 项同时存在时不能生成两个独立应用副本；格式升级完成前禁止删掉唯一可恢复来源。
- 同步维持同一逻辑应用记录身份，或实现经过验证的版本/别名协议；这属于迁移发布门槛，不应等上线搬完数据后再补。

## 行为验收建议

| 编号 | 公开行为场景 | 必须观察到的结果 |
| --- | --- | --- |
| L1 | 已有 App 与 Applet 记录升级，刷新两次；另有同 ID 普通组件数据 | 应用值与 ID 不变，目标位置唯一；第二次无重迁；组件数据不串读或覆盖 |
| L2 | 迁移中模拟 IDB 写失败、读失败、未完成即中断；夹杂损坏 legacy JSON | 旧值保留且可重试；读失败不覆盖新值；坏一条不阻断合法其他条 |
| L3 | App `await tada.store.set` 和 Applet persist 分别写入后刷新/切形态 | 成功确认的数据可恢复；未提交失败明确显示且不会假报已保存；设置、主题、尺寸改变不清业务状态 |
| L4 | 延迟第一个事务，快速 `write/delete/write` 与并发 flush，注入一次 abort 后恢复 | 最终持久化为最后一次有效操作；旧删除不吞新写；失败记录可重试，flush 等待全部既有工作 |
| L5 | IndexedDB 不可用且 localStorage quota/权限错误 | 有明确失败/降级结果；不得以仅内存读回证明保存；重开不会误删 legacy |
| L6 | JSON 长度为 99999、100000、100001；包含中文和 emoji；旧值超过新建议配额 | 边界遵循已公布单位；拒绝写不损坏上次值；迁移不截断旧值，文案准确 |
| L7 | 应用从页面移除、卸载、撤销；普通组件删除 | 应用私有数据按现有契约保留；普通组件仅删自己的裸实例命名空间 |
| B1 | 刚编辑组件/应用、聊天仍在排队或事务进行中时导出 | 文件含提交屏障内最新修改；另一个正在执行的 flush 不被跳过；读写失败不会得到“成功空备份” |
| B2 | 老无版本备份、新备份、旧新重复应用键分别在空环境导入 | 整体替换后可打开记录，ID/设置不变；同一应用只有一个权威值；旧格式兼容结果明确 |
| B3 | `{"indexedDB":true}`、无效记录关联、损坏 fp JSON、写入中途失败、IDB 不可用 | 验证失败不动现有数据；运行期失败保留可恢复原状态；不 reload 假报成功 |
| B4 | 导入/reset 时旧 flush 已开始，且仍有组件或聊天更新 | 旧批次不能在替换后写回或删掉新数据；替换生命周期结束后才恢复正常写入 |
| S1 | 同一应用先在旧客户端/远端 LS 身份，再由新客户端迁移；另一端有更新或墓碑 | 不重复、不复活旧值、不因物理搬家删除有效数据；升级兼容规则可解释 |

既有 `scripts/test-app-runtime.mjs:6,14–20,74–88` 只执行 SDK/消息桥，不加载宿主应用存储；`scripts/test-applet-runtime.mjs:19–49,67–115` 使用 runner 消息夹具，不能证明宿主落盘。应在这些公开消息边界补行为测试，并为存储/备份新增隔离后端夹具；真实 IndexedDB 事务、刷新恢复另用独立浏览器 context 验证。不得复用用户正在使用的页面、数据库或同步账号。

## 本轮验证记录与待查

已执行源码级隔离验证：用本机 Node v24.11.0 + TypeScript transpile + VM 执行真实模块，localStorage/IndexedDB 入口全部为内存替身。已保存复现夹具 `research/local-storage-probes.mjs`；未运行完整产品测试、类型检查或构建。本报告的断言确认当前缺陷，修复后应改写为预期行为测试，不能当成产品验收通过。

从仓库根目录运行：

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node .trellis/tasks/10-28-storage-sync/research/local-storage-probes.mjs
```

1. 真实 `db.ts` 在无 IndexedDB 环境 `put` 正常返回 undefined，`all` 返回 []；另用事务替身触发 abort，仍正常返回 undefined。
2. 真实 `store.ts` 在 localStorage.setItem 抛 quota 错误时正常返回，后续 readStored 仍读到内存 `count=7`。
3. 真实 `componentData.ts` 面对模拟“底层正常 resolve 但无落盘”后，第二次 flush 无重试，内存 `count=9` 仍可读。
4. 真实 `componentData.ts` 配合按请求建立顺序串行的事务替身，复现 `put:unrelated → put:same-key → del:same-key`，最终内存为 `{v:2}` 而磁盘无键。
5. 真实 `chat.ts` + 真实 `db.ts` 在无 IndexedDB 时迁移旧聊天，旧 LS 键被删除，而持久化轮次数为零。
6. 真实 `storage.ts` 接受 `{"indexedDB":true}`；调用 importBackup 在内存夹具中触发 clearChat、clear kv 和 reload。

尚未验证：真实浏览器的存储配额/驱逐策略、pagehide 持久化时机、多标签页并发、不同浏览器错误事件顺序、IDB 升级阻塞和关闭后的恢复；也未测真实大数据备份/启动耗时。当前 `componentData` 会在启动全量载入 kv（`src/lib/componentData.ts:18,63`），将大应用状态迁入该仓会放大启动内存；聊天虽按会话载入轮次，导出仍全量 getAll。增长规模与按需载入是否进入首切片应由产品范围和测量决定，不应以代码注释里的“无限增长”“几十毫秒”作为性能承诺。
