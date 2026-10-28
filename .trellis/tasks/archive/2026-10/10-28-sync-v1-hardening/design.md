# 新同步协议设计

基线 `8ff7043`，2026-10-28。用户撤销旧实例/旧格式兼容要求；保留现有存储可靠性与本地数据，不执行真实远端写入。

## 最小差距和职责

当前单文件 v1 任意 fp 键参与同步、协议缺验证、加密策略未触发写入、网络期间的编辑可被覆盖。问题在协议、投影和提交边界，不能仅改设置文案。本轮替换该同步实现，沿用 UI 调用入口名称；无需兼容旧 wire、旧 meta 或旧 ls 记录身份。

- `syncTypes.ts` 定义配置/范围、预算；`syncProviders.ts` 仅负责读写网络、条件版本、限流与字节预算，不读业务库或修改设置。
- `syncProtocol.ts` 负责严格版本、信封、规范化 JSON 哈希、逻辑版本与合并。
- `syncData.ts` 负责逻辑记录 codec、双向配置投影/本机字段合并及数据采样；配置范围不得读取/应用聊天业务。
- `sync.ts` 协调保存屏障、绑定连接的元数据、策略更新、网络等待后的本机复查、可恢复应用、状态与调度。
- 将 storage.ts 的可恢复提交提取为独立 `storageCommit.ts`，供备份和同步共用，避免 storage/sync 循环依赖。保持恢复日志、Web Locks、失败只读和原备份行为，用上一轮测试证明提取无回归。
- `SyncSettings.tsx` 展示实际范围、整包/并发能力、轮换时本次解密原口令与状态。根会话维护文档、任务、完整检查与提交。

## 冻结接口

`SyncConfig` 保留现有字段 backend/webdav/gist/http/secrets/passphrase/auto/device，由 backend 决定 `SyncScope = configuration | full`。文件名 `dada-sync-v2.json`。wire UTF-8 预算 WebDAV/HTTP 64 MiB、Gist 8 MiB；非存储配额，超量明确失败。

`createRemote(config)` 返回 `read(): {text, version, bytes}` / `write(text, expected): {createdGistId?, bytes}`。`RemoteVersion` 为 missing、强 etag、unprotected；创建用 If-None-Match，更新用强 If-Match，缺能力如实 unprotected。provider 异常可含 conflict/retryAt，冷却零请求。

协议是显式 v2 快照，含 app/version/scope/secrets/records。记录以 config、component、app、conversation、turn 等逻辑身份区分，不暴露任意本地 key 写权限。版本使用逻辑 counter + device，内容 SHA-256；同版本不同内容也确定处理，禁止以 Date.now 同毫秒误认相同。未知记录及超范围记录拒绝。具体合法值和会话关联先验证；无 raw 异常透传。墓碑不按年龄自动清理。

元数据使用新的 key，按提供方资源身份、scope、协议隔离；全新基线时已有远端同身份记录优先，本机独有记录仍上传。密码不放元数据或网络明文；加密 PBKDF2 + AES-GCM 信封明确算法/版本/参数/长度。`runSync(mode, {decryptPassphrase?})`、`syncNow(options?)`、`testConnection(config, options?)` 的本次原口令只在内存用于解密。业务无变化也根据远端加密/密钥策略与本次轮换请求重新表示。

本机采样包含比较用指纹。等待 GET/PUT 发生变更可保守拒绝并请重试，不能覆盖或丢弃新队列。入站在同标签保存门禁内排空并再次复核，通过共用恢复日志同时保护 LS 与 IDB；成功后返回 needsReload，由宿主刷新。页面各业务缓存未热更新，因此在提交成功后保持专用只读门禁，直到重新加载，禁止旧内存继续写回覆盖拉取内容。不得自动刷新正在输入/生成变化的页面。push 不应用远端，full 排在运行 push 后执行，不能错误复用一次 push 当完成 full。连接设置中途改变则旧操作失败，不保存 Gist ID/meta 到新连接。

## 检查与边界

测试调用公开同步/连接入口和真实 provider fetch 边界，用隔离存储/网络替身先红后绿；浏览器独立 context+本地模拟远端，禁止真实令牌和公网写入。保留存储 23 项及新同步真实浏览器验证。完整 test/tsc/build、Standards/Spec 审查后本地提交，不推送或部署。
