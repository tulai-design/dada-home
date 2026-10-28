# Research: 应用增量同步独立 Spec 审查

- Query: 本轮应用增量同步是否满足 PRD 的原子保存、稳定重试、冲突、跨标签 CAS、凭据过滤和失败游标保护？
- Scope: internal；只读产品实现、任务、测试及固定 SDK 包，只写本报告。
- Date: 2026-10-28
- 主代理指定基线：`e56ee5c` 加本轮工作区与未跟踪文件；研究角色未执行 Git 操作。
- 本轮只审查 `10-28-application-incremental-sync`，不将聊天、配置、UI、自动后台或部署等父任务范围当作遗漏。

## Findings

### 当前结论

**Spec PASS：本轮明确范围内无剩余阻断缺陷。** 审查发现的恢复流程 P1 已修复并复核；恢复 generation、冲突双版本 CAS 和按 epoch 索引读取均符合约定。以下分别记录独立执行证据与主代理提供的最终验收结果。

### 已关闭 P1：活动应用绑定使非应用更新的失败恢复永久受阻

`storageCommit.ts` 对任意非空 update.operations 都记录完整五仓快照（原第118行）；回滚再用 `replaceOperations` 恢复全部五仓。新增 `commitExternal` 正确拒绝活动绑定下任何 apps 写入，但组合后出现新问题：绑定活动时，允许的仅 kv 更新与配置写入若遇到 localStorage quota，回滚却意外包含 apps，于是被绑定保护拒绝。保留的 recovery 日志在下次 recoverStorage 仍触发同样拒绝；backup-restore 门禁也使正常 controller.detach 不能解除此状态。

本审查通过复用 `scripts/test-storage-backup.mjs` 的纯内存夹具、加载真实 storageCommit 模块，并模拟活动绑定与 commitExternal 的真实拒绝规则重现：

```json
{"writeError":"保存没有完成，原数据的恢复日志已保留。请刷新页面重试恢复，暂勿继续编辑。","recoveryError":"应用增量同步仍已绑定","recoveryRows":1,"note":"remote note","blocked":true}
```

最终修复采用恢复日志 v4，只保存和回退实际触及的业务仓：`storageCommit.ts:9` 使用 Partial<DbSnapshot>，`:40` 的 replaceOperations 跳过未列出的仓，`:117`–`:124` 按操作集生成精确日志；`:86` 保留 commitExternal 的活动应用绑定保护。日志校验拒绝非业务仓，新方案不增加旧日志迁移分支，符合当前单人测试开发授权。

同一个独立探针修复后输出如下；kv 恢复、apps 不变、日志与门禁清除：

```json
{"failure":"模拟配置quota","recoveryRows":0,"note":"原便签","app":"原应用","blocked":false}
```

最终 backup 回归新增活动绑定下 kv+配置 quota 失败即时回滚、回退再次失败后新模块启动读取 v4 日志恢复，并确认期间的新应用编辑保留。两项已独立运行通过。主代理另确认真实 IndexedDB 对应恢复路径通过。

### 需求对应证据

| PRD 行为 | 实现证据与判断 |
| --- | --- |
| 保存与待同步意图原子、离线可用 | applicationData 的保存队列进入 applicationSyncStore.saveLocal；db.atomic 在同一 apps/applicationSync 读写事务检查 generation、更新业务值/最新 draft。网络不在此路径。 |
| 首次 seed、后续增量 | bind 扫描已有 apps 建立新 epoch draft；next 只 claim 非冲突 draft/inFlight。安装/卸载语义没有被替换为删除业务。 |
| 8 MiB / 100 层 / 原身份范围 | codec 将完整应用 JSON 放入加密对象，metadata 保持小记录；JSON.stringify 后对 canonical application key 取 SHA-256，合法孤立 surrogate 不被 TextEncoder 折叠。 |
| 原密文先持久化、旧确认不清新编辑 | prepare 保存 request+Blob；run 查询原 operation 并比较整批请求，确认只清理 generation 不超过该 inFlight 的 draft，后继编辑保留。 |
| 入站完整认证后同事务应用 | decode 认证 context/实体、metadata、外壳 refs、manifest、双 hash，再进入保存门禁 flush；applyPage 重读当前值/版本/队列，业务/generation/冲突/cursor 统一事务提交。 |
| 同记录及删除修改冲突 | draft/inFlight 存在时入站保留双方候选；ack conflict 不自动 rebase；逻辑墓碑与空对象分开；resolve 要求 remoteReady，并同时检查观察时 localGeneration 与 remoteRevision（applicationSyncStore.ts:289）。 |
| 凭据隔离 | apiKey/token/password/secret/keys 递归剔除；入站只恢复本机已有字段；数组按唯一 id 归属，避免下标错配。controller 只把 keyring 摘要放绑定；token/keyring 只留运行时。 |
| 旧实例写回保护 | apply/resolve 更新持久 generation；applicationData 缓存携带旧 generation 时 saveLocal 拒绝覆盖；本标签入站变化设置 sync-reload 门禁直到重载。 |
| 生命周期与恢复保护 | bind/run/resolve/detach 共用 dada-storage-restore Web Lock；显式 detach 保留旧 epoch 状态，新绑定重新 seed；活动绑定阻止含 apps 的整包替换。commitExternal 在业务写入同事务更新受影响 apps 的 generation（applicationSyncStore.ts:142），恢复及回退后旧标签缓存不能覆盖。非 apps 恢复使用 v4 精确日志。 |
| 查询范围 | inspect 使用 epoch 索引，不读取其他已归档 epoch 的 prepared Blob；活动 epoch 在读事务中再次比对（applicationSyncStore.ts:279），绑定变化时拒绝返回错配结果。 |

公开程序接口不自动联网或绑定，不接管现有快照 provider。单轮最多一个 commit、每 commit 一个应用；这是设计明确的有界内存限制，多记录远端事务在下载前拒绝且不推进游标，不是静默拆开服务原子事务。

### 实际执行的检查

使用本机 Node 24.11.0 运行：

- `scripts/test-application-sync-store.mjs`：最终 10/10 通过，包含整包替换/回退 generation、冲突双方版本 CAS 和按 epoch 索引读取。
- `scripts/test-application-sync-codec.mjs`：6/6 通过，包含实际原生加密的完整 8 MiB、100 层和身份案例。
- `scripts/test-application-sync-controller.mjs`：最终 7/7 通过，包含双版本解决选择。
- `scripts/test-storage-backup.mjs`：最终 20/20 通过，包含以上活动绑定组合缺陷的即时回滚与重启恢复回归。
- `sha256sum vendor/tulai-design-sync-sdk-0.1.0.tgz`：与 vendor/README.md 记录的 `3ee56ae34f2299017684dd0348043307dc8d8b81bd071554076cabd5cc0defd0` 一致；package.json 与 lockfile 均引用仓内 tarball，无源码绝对路径依赖。

以上独立运行共 43 项定向行为检查通过。状态机/controller 单测采用替身，不能当成真实 IndexedDB 事务或浏览器跨标签验收。主代理已报告完整 test、tsc --noEmit、build 全部通过；这些全量命令未由本审查者重复执行。

### 浏览器夹具覆盖与证据边界

已读 regressions / worker / QA 启动器。夹具使用双随机 loopback origin、临时真实 HTTP/SQLite、原生 IndexedDB，以及 fetchImpl 注入已提交后丢响应、读取中断和离线。页面覆盖大对象/深层ID/凭据、第二次增量、重建客户端、旧确认期间编辑、同记录/删除冲突、下载期间编辑、保存事务 abort 和活动绑定恢复门禁。

首轮审查提出缺少真实浏览器对入站 apply 事务 abort 和同 origin 旧缓存 CAS 的独立 case；主代理随后已加入这两个 case，并增加活动绑定下真实配置写入失败和日志恢复。最终夹具共 10 组，主代理确认全部通过，包括真实 IndexedDB 恢复。浏览器实际操作与结果归属主代理，本审查者完成夹具及产品路径核对，未重复执行浏览器自动化。

### 交付配置核对

最终 Dockerfile 在 `pnpm install --frozen-lockfile` 之前复制 `vendor/`；`.dockerignore` 未排除该目录，固定 file: tarball 可进入安装层。构建阶段 Node 镜像及 CI setup-node 均为 24.11.0，与包内 engines `>=24.11.0 <25` 一致。此项只核对配置和归档声明；本机 Docker daemon 不可用，不能声称已完成镜像构建或容器冒烟。

## Files Found / Code Patterns

- `src/lib/applicationSync.ts`：稳定请求协调、网络/加密在事务外、Web Locks 与重载门禁。
- `src/lib/applicationSyncStore.ts`：epoch / generation / draft / inFlight / conflict 状态机与原子应用。
- `src/lib/applicationSyncTypes.ts`：本机绑定/请求/候选类型；不持久化同步访问秘密。
- `src/lib/applicationSyncCodec.ts`：应用身份、加密对象、入站引用/格式校验。
- `src/lib/applicationSyncProjection.ts`：已知凭据剔除及本机归属恢复。
- `src/lib/applicationData.ts`：业务缓存、保存队列、generation CAS。
- `src/lib/db.ts`：真实 IndexedDB atomic 回调同步读计划写及事务完成确认。
- `src/lib/storageCommit.ts`：整包替换与恢复保护。
- `tests/application-sync-regressions.js` / `application-sync-worker.js`：真实浏览器验收编排和产品接口入口。
- `scripts/serve-application-sync-qa.mjs`：临时服务/代理/计数；没有在生产配置增加远端同步服务器。
- `vendor/README.md` / tarball / `pnpm-lock.yaml`：固定可重现 SDK 来源。

## Related Specs

当前任务 PRD / design / implement；`.trellis/spec/frontend/state-management.md` 的保存确认、恢复门禁、跨引擎边界和 AI 应用存储；`AGENTS.md` 的本机工具链、保留数据、当前单人测试范围。

## Caveats / Not Found

当前报告是本子任务实现冻结后的独立 Spec PASS；不代表父任务、设置界面或聊天同步已经完成。类型/全量测试/构建/真实浏览器结果已明确归属主代理；镜像仅完成配置审查。未访问真实用户数据、远端账户或改变产品源码。凭据过滤只覆盖约定字段名，不宣称能识别任意自由文本中的秘密。本报告不包含 Standards 轴结论，该轴由另一审查者承担。
