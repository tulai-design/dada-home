# 同步协调独立审查

日期：2026-10-28。审查范围为 `src/lib/sync.ts` 与 `src/lib/syncProtocol.ts` 的协调、版本、队列及提交边界；不重复审查提供方实现和领域 codec。本轮按当前 PRD/design 的新 v2 协议审查，不要求旧协议兼容。

## 方法与边界

- 调用公开 `runSync` / `writeSyncConfig`，复用 `scripts/test-sync-protocol.mjs` 的真实模块加载器和隔离存储、HTTP/Gist 替身。一次性 Node probe 仅修改替身钩子，不修改核心源码、不连接真实远端。
- 命令：`node scripts/test-sync-protocol.mjs`。2026-10-28 最终复核已独立实测 21 项通过；完整工程检查以根会话结果为准。
- Probe 使用 `node --input-type=module`，读取该脚本 `let count=0` 之前的测试装配，转译真实 TypeScript 模块，使用 `node:crypto` 的 `webcrypto`。以下均为公开行为观察，不是仅凭代码推断。

## 已发现的事实

### 1. 提交门禁中切换连接会被旧 Gist 配置覆盖（P1，已修）

复现步骤：

1. 保存 Gist 配置，ID 留空；模拟 POST 成功返回 `{id: 'created-old-target'}`。
2. 在提交阶段 `db.get('recovery', ...)` 的等待钩子里，调用 `writeSyncConfig` 切换到另一个 HTTP 地址。
3. 修复前 `runSync` 返回成功，但最终 `backend` 又是 `gist`，新 HTTP 地址消失，自动创建的旧 Gist ID 被写入，meta 也已保存。

原因是连接复查发生在恢复提交中的异步读取之前，而 `writeSyncConfig` 没有遵守保存门禁。最小修复为该公开设置写入口调用 `assertPersistenceWritable()`。core 已实施，并增加提交钩子中的拒绝测试及拉取后只读状态测试；独立读回确认代码已存在，16 项行为测试已通过。

### 2. 轮换凭据被当成新资源，导致未上传编辑被远端旧值覆盖（P1，已修并有回归）

复现步骤：

1. HTTP 地址保持不变，先同步 `component:note = '已同步旧值'`。
2. 本机改为 `'未同步新编辑'`，只通过 `writeSyncConfig` 更换 HTTP token。
3. 再执行完整同步。

修复前观察结果为 `pulled: 1, pushed: 0, needsReload: true`，本机和远端都变成 `'已同步旧值'`。原绑定把整个 HTTP/WebDAV/Gist 配置对象纳入摘要，密码、token、代理改变也会丢弃既有基线。根会话确认资源身份应与凭据/代理路由分离：提供方、范围、目标 URL、Gist ID，以及有身份意义的 WebDAV 用户名参与绑定；token、密码、代理不参与。core 已修复，并补充“相同资源轮换凭据或代理保留基线，新目标重新使用远端基线”回归；本次独立运行通过。

### 3. 首次 PUT 等待期间的新编辑在重试时仍会丢失（P1，已修并有重载回归）

复现步骤：

1. 无本机 meta，远端返回 404，本机 `component:note = '旧采样'`。
2. 模拟首次 PUT 等待期间将本机 note 改为 `'等待上传期间的新编辑'`，仅触发一次。
3. 首次 `runSync()` 正确抛出“同步期间本机数据有新变化，请重试；新编辑已保留。”；本机暂时保留新值，远端已接受旧采样，meta 尚未保存。
4. 按提示再次调用 `runSync()`。

修复前观察结果为第二次 `pulled: 1, pushed: 0, needsReload: true`，本机最终退回 `'旧采样'`。原因是第一次成功远端写入后未保留本次采样/版本的可信基线，重试仍被当成新设备；“首次同身份远端优先”覆盖了第一次失败后保留的新编辑。core 现已在首次上传前通过恢复提交持久化采样基线，并将后续已知记录的新编辑与初次远端优先分开处理。新增回归覆盖立即重试和重新加载后重试两条路径，本次独立运行均通过。只验证首次失败不足以证明新编辑得到保留，必须覆盖重试后结果。

### 4. 等价 URL 写法误建新基线，覆盖未同步编辑（P2，已修并有回归）

修复前通过公开 API 复现：先用 `https://sync.invalid/data` 同步旧值，随后本机修改为新值，再将地址改为 `https://SYNC.invalid:443/data#settings` 并完整同步。provider 的实际请求仍全部指向 `https://sync.invalid/data`，但 meta 绑定按原字符串分离，结果为 `pulled: 1, pushed: 0`，本机新编辑退回旧值。

最终实现新增 `syncResourceIdentity(config)`，复用实际网络层的 `connectionUrl(value.url, '', webdav)`，将主机名/默认端口、fragment 和 WebDAV 目录追加文件名后的实际目标用于绑定；凭据和代理路由仍不参与。`sync.ts` 的 `binding` 已调用该共享入口。新增回归覆盖 HTTP 等价地址和 WebDAV 目录/文件地址两条路径，最终独立运行 21 项全部通过，此 P2 关闭。

## 已验证的其他行为

- counter 与 device、SHA-256 的比较顺序确定；相同逻辑版本不同内容由 hash 稳定选择，未发现 `Date.now()` 同毫秒误判。
- 当前 `initialized` 基线标记已修复“首次 push 之后 full 对零版本记录错误使用本机值”的问题。独立双设备 probe 使用远端设备 `A`、本机设备 `Z`，首次 push 后完整同步仍正确拉取远端值。
- push/full 使用不同排队身份，full 等待 push 后实际执行，不复用 push 的无拉取结果。
- 在首次自动 push 成功后继续修改并再次 push 的独立 probe 中，新值正确上传；后续 full 不会重新拉回第一次上传的旧值。
- 明文/加密表示切换、口令轮换/移除在业务值不变时仍进入写入路径；信封参数、长度和内层协议均经公开测试校验。
- 连接变更、字节预算、限流、保存失败等行为的最终覆盖应以根会话完整检查为准。本审查没有证明多个活跃标签页可安全协作，也没有进行真实账号验证。

## 最终 Spec 结论

PASS。本次独立审查发现的三个 P1 和一个 P2 均已修复并通过公开行为回归；最新 checkpoint、LS-only 恢复日志、提交门禁释放前只读锁、配置/完整范围、凭据策略、同名 App/Applet 身份及实际设置 UI 契约未发现剩余确定缺失或越界。不将独立增量服务、容量扩展及旧协议兼容作为本任务缺失。
