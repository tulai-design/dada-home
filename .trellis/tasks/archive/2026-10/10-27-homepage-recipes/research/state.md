# Research: 首页草稿状态、身份与副作用边界

- Query: 如何复用工作空间/模板/撤销建立隔离首页草稿，检测正式设计冲突，保留组件和应用身份，并防止预览污染业务数据？
- Scope: internal
- Date: 2026-10-27
- Active task: `.trellis/tasks/10-27-homepage-recipes`

## Findings

### 1. 已有基础与最小接入点

`ops.ts:35–40` 明确所有结构操作为纯函数，不读取存储、不触碰 React；例如 `setPageSections` 经 `replacePage` 规范化引用并检查特效预算（`ops.ts:72–80`）。因此草稿编辑应复用这些纯领域操作，不能复用现有工具 execute 后再试图回滚正式 store。

`workspaceStore.ts:275–283` 的 `commit(next)` 一次写入历史、清空 redo、持久化 `fp.workspace` 并通知订阅；`undo/redo` 在 `291–309` 完整恢复工作空间对象。应用草稿只需要最终一次 `commit`，现成历史就可把所有改版结构作为一步撤销。生成、调整、检查、关闭预览和取消均不得调用此 commit。

`snapshotOf(workspace)`（`templates.ts:20–31`）通过 JSON clone 生成设计快照，内容包括页面、布局、组件定义、应用记录等，明确不包含组件业务数据。可复用它建立预览设计上下文或作为公开行为测试的快照边界；不必在 Workspace 新增 drafts 字段，不应把未应用草稿保存到模板库。草稿本身适合独立内存 store，React 用现有 `useSyncExternalStore` 习惯订阅。刷新即丢弃草稿是明确而小的边界，若将来需要草稿恢复再独立设计。

**不要直接套用现有 applyTemplate 作为首页应用。** `templates.ts:139–164` 会整体替换 pages/statusbar/layout/widgets/addons/dock，并可能启用主题；内置预设还会重发组件与应用 ID（`templates.ts:100–117`）。这符合旧模板语义，却不符合本任务“保留已有首页内容和应用身份”。首页组合应只生成/替换 `home` 的受控设计，沿用当前其他页面、安装记录、网络授权、模板/主题库和状态栏。用户应用后仍可用现有 saveTemplate 保存正式结果，不需再造模板系统。

### 2. 冲突检测不能依赖“草稿创建后用户不会再编辑”

正式工作空间可以在预览打开期间被 AI 工具、设置、页面操作、撤销或重做改变。现有 store 有内部 stamp，但没有公开 revision；`getWorkspace()` 返回不可变操作产生的稳定对象（`workspaceStore.ts:270–283`）。检查器也利用对象身份识别未提交 DOM（`pageInspectionHost.ts:48–49`）。

**建议第一版使用保守的对象基线冲突检查：** 草稿创建记录 `baseWorkspace = getWorkspace()`，应用时重新读取，要求同一对象；不相等就拒绝应用并保留草稿，提示基于最新设计重新生成，不静默覆盖。冲突检查与同步 `commit` 放在同一动作内，中间不要 await。这样无需给正式 store 增加通用事务框架，undo 回到同一对象时可以安全应用；业务数据本身不在 workspace，所以用户写便签不应被误判为设计冲突，也不会被草稿覆盖。

局限：切换全局明暗、保存模板等无关结构修改也会触发保守冲突。预览内的明暗/宽度选择应是预览局部状态，不提交 workspace。若产品希望允许无关设计改动，后续可把冲突基线缩为首页及其依赖投影（首页结构、被引用应用 canonical 配置、custom 定义、实际布局/主题），然后把 draft.home 合并到最新 workspace；不能仅比较 home 而忽略影响预览的应用源码变化。

跨设备同步直接写 localStorage 后重新加载页面（`sync.ts:246,527,544`），内存草稿会一起失效；本轮不需处理跨刷新对象基线。也不应给所有 localStorage 写入增加全局草稿补丁。

### 3. 首页改版保留身份的最小字段范围

`Page`（`workspace.ts:230–250`）包括固定 id、name/label、components、sections、wallpaper/layers/css/align/icon/dock。推荐草稿只允许受控首页设计变动：

- 页面 id 固定 `home`，其他页面整条保留；首页 name/label/icon/dock 默认保留。
- 原有 `ComponentInstance.id/type/config/title` 保留；组合优先只重排原实例并设置 sections，必要外观修改仅 span/look。未安排进组合的原内容保留在尾部，不用删除组件工具移除。
- 允许新增的内容必须明确记录为草稿新增实例，只在首次构造时生成 ID，后续改配方不能反复生成同一业务块；不能把已有应用变成新 ID。
- `workspace.applications` 整体保留。`PageView.tsx:73–75` 用应用 canonical instance 覆盖页面副本的 type/title/config；仅改页面副本源码不会生效。为本轮布局改版保留应用源码、settings/schema、group、dock/status、openMode 更可靠。
- 挂载应用 ID 即数据命名空间身份，不能拷贝到新 ID。`applications.ts:218–234` 明确一个应用只挂载一页；组合若只作用当前首页，不应把别页挂载应用复制进首页。
- 保留 workspace.widgets/addons/network/statusbar/layout/themes/templates 等上下文；若组合确需修改全局字段，应显式扩展设计范围和冲突校验，不能借整套模板隐式覆盖。
- 首页 wallpaper/layers/css/align 可作为配方装饰的受控字段；层和内容特效仍走同一预算，旧超限设计只能保持或减负，不能靠预览绕过预算。

业务数据并非一个统一命名空间：内置组件大多是 `fp.data.<实例id>` / IndexedDB，Applet 是 `fp.applet.<实例id>`，App 是 `fp.app.<实例id>`。只保持配置而重发 ID 会让用户以为数据丢失。更不能调用 remove_component execute，它还会调用 `removeData`（`tools.ts:431–440`）；该删除副作用不在 workspace undo 里。

### 4. 真实组件不能无条件放进预览

给 PageView 的 onUpdateConfig/onRemove/host 回调换成 no-op，**不足以隔离预览**。真实组件可绕过这些回调直接读写共享模块，或启动网络/声音/外部窗口。证据：

| 路径 | 已有行为 | 对预览的影响 |
| --- | --- | --- |
| `componentData.ts:99–132,202–225` | readData 读全局 cache/IDB/localStorage；useComponentData 更新直接 writeData | 便签/待办输入会写正式实例数据，no-op config 回调无效 |
| `widgets/note.tsx:12`、`todos.tsx:18` | 按原实例 ID 使用 useComponentData | 不能直接启用交互后声称取消会回滚业务数据 |
| `widgets/applet.tsx:70,89–121` | runner ready 读取 readStored(applet.id)，save 写 writeStored；call 可 fetch/copy/open/ask/toast | 挂载就运行 AI 源码，init 可能写 persist 或取数；第二份实例可能并发写同一命名空间 |
| `widgets/app.tsx:220–254,298–320` | iframe RPC 直接写 fp.app.id、取数、剪贴板、打开窗口 | 需要独立运行时隔离才能安全真实执行，不适合靠外层按钮禁用解决 |
| `widgets/weather.tsx:20–24`、`feeds.tsx:33–41`、`hot.tsx:24–27` | 挂载 useResource 即发请求/定时刷新，订阅读共享来源 | 预览不应偷偷联网或再次请求私有订阅 |
| `widgets/custom.tsx:20–46` | custom 数据源可 fetch | “声明式”不等于无副作用，远程数据定义需要只读占位或静态快照 |
| `focus.ts:98–120,144–177,208–213` | 写全局计时状态、修改标题、写专注记录、声音/通知 | 番茄钟不应在预览中启用真实控制 |
| `widgets/music.tsx:118–135` | 订阅全局播放器，挂载/卸载计数影响离页暂停 | 即使用户不点击，预览生命周期也可能干扰真实播放器 |
| `widgets/calendar.tsx:34,110,399–427` | 全局日程/日历订阅写入 | 不应在草稿预览内编辑真实日程 |

**建议明确只读预览投影：** 复用 PageView 的真实布局、真实包装层、分区、主题和可安全展示的静态/装饰组件；有业务副作用或未声明安全的组件使用固定、可读的预览内容/占位。不要重命名 ID 假装隔离（会丢用户内容且仍共享全局数据），不要暂时覆盖 localStorage、store 单例或全局 fetch。

可给 PageView 加显式 preview render policy（参数或专用 renderer），在实例渲染前决定安全投影；不能让未知组件默认执行。对 App/Applet 标明“预览仅显示位置，应用后运行”，报告 measurement scope 也必须说明这些占位的几何不代表应用内部布局已通过。只读占位应有可视内容和合理高度，不让空框制造“无溢出=全通过”的假象。

预览的本地明暗应作用于隔离容器/主题边界。当前 App 使用 document.documentElement 全局设置主题（`App.tsx:267–281`），App iframe 和部分 effect useDark 也读 documentElement；因此局部预览不能直接复用这些依赖并假定已双主题验收。需要专用预览 theme context 或隔离文档，或将安全投影限定为容器 token 可控制的内容并明确测试。此处由渲染研究进一步定案。

### 5. 建议模块 API（设计建议，非现有接口）

```ts
// homepageRecipes.ts：纯规则/目录，不读写 storage
listHomepageRecipes(): HomepageRecipe[]
buildHomepageRecipe(workspace: Workspace, recipeId: string): Page

// homepageDraft.ts：单个内存草稿，不放进 Workspace/模板库
type HomepageDraft = {
  id: string
  revision: number
  recipeId: string
  baseWorkspace: Workspace // 内部基线，不完整暴露给模型
  page: Page              // clone 后的草稿首页
}
getHomepageDraft(): HomepageDraft | null
createHomepageDraft(recipeId: string): HomepageDraft
updateHomepageDraft(input: unknown): HomepageDraft
cancelHomepageDraft(id: string): void
applyHomepageDraft(id: string): void // 同步检查基线→预算/结构校验→commit一次→清草稿
```

具体命名可由主会话调整。重要边界是：草稿操作显式，不把 getWorkspace/commit 全局切换为“现在都编辑草稿”；现有 AI 普通写工具仍写正式设计，模型必须从结果知道改的是哪个对象。工具若要调整草稿，提供局部白名单字段/明确 draftId，而非把任意工具 execute 重放进沙盒。

检查接口可复用 createPageInspectionHost 的泛化宿主依赖：它已接收 getWorkspace/getMounted（`pageInspectionHost.ts:31–34`），可传草稿 projection 而不是全局 store。需要独立 mounted ref 和 draft revision，修正后旧 DOM 报 stale；报告显式 target=draft 与实际宽度/主题/占位限制，不能把正式页 inspect_page 报告当草稿通过。页面 ID 相同也必须区分两个测量根。

### 建议验收边界

- 生命周期公开行为：创建/更新/取消均不改变 getWorkspace 对象、history、fp.workspace、业务数据或应用记录；apply 只提交一次，undo/redo 完整往返。
- 冲突：草稿存在时正式 commit/undo/redo 导致基线变化，apply 拒绝且零提交；保留草稿供重做，不部分应用。
- 身份：四类组合应用前后原 ID、config、application records、private namespaces 相同，未分组内容仍可达。
- 副作用：用“挂载即写数据/发网络请求”的真实 Applet/App 或探针，确认 preview 根未执行它；内置计时/音乐不改变全局状态。
- 真实布局：预览包含原 PageView 布局与 data-id，检查工具只能测当前 draft revision；修正→复查→应用→撤销在同一请求链验证。

## Files Found

- `src/lib/workspaceStore.ts`：正式 workspace 单例、迁移、持久化与 undo/redo。
- `src/lib/templates.ts`：纯快照、模板保存/应用，内置预设换 ID。
- `src/lib/ops.ts`：纯结构操作和页面预算/规范化入口。
- `src/lib/pageSections.ts`：布局引用、规范顺序和插入规则。
- `src/lib/applications.ts`：canonical 应用记录及唯一挂载身份。
- `src/lib/componentData.ts`、`src/lib/store.ts`：两种共享数据存储路径。
- `src/components/PageView.tsx`：业务组件与布局相接的位置。
- `src/lib/pageInspectionHost.ts`：已提交 DOM 与 workspace 对象一致性检查。
- `src/widgets/app.tsx`、`applet.tsx`、`note.tsx`、`todos.tsx`、`weather.tsx`、`feeds.tsx`、`hot.tsx`、`custom.tsx`、`music.tsx`、`calendar.tsx`：预览副作用证据。
- `src/lib/focus.ts`、`src/lib/sync.ts`：全局计时副作用与跨设备持久化/刷新。

## External References

无外部 API 或依赖选择，本研究只依据当前仓库源码；没有调用第三方文档或新增依赖。

## Related Specs

- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/page-layouts.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/ai/tools-and-apps.md`
- `docs/specs/runtime-contract.md`
- `.trellis/tasks/10-27-homepage-recipes/prd.md`

## Caveats / Not Found

- 当前没有现成草稿事务、公开 workspace revision、通用无副作用组件预览协议；以上建议 API 尚未实现。
- 本研究未穷举所有 widget 的初始化副作用，未知组件应默认不执行而非默认安全。
- 研究阶段未运行浏览器或修改生产源码；行号以 2026-10-27 本轮开始时读取为准，后续并行实现可能移动。
- 给主会话的即时消息把 App/Applet 存储概括为 useComponentData 不精确：精确路径分别为 App 直接 localStorage、Applet readStored/writeStored；结论同样是绕过 PageView host/config 回调。
