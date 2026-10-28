# 执行与所有权

1. Provider worker：syncTypes.ts、syncProviders.ts、test-sync-providers.mjs；严格网络边界、条件版本、预算和限流，先冻结公共接口。
2. Protocol worker：sync.ts、syncProtocol.ts、storageCommit.ts、storage.ts、persistence.ts，以及 test-sync-protocol.mjs；必要更新 test-storage-sync-guard/backups 的真实模块 loader。合并、门禁内复查与恢复提交，保持之前存储测试。syncData.ts 在首版交接给主会话，避免并行改写。
3. UI/browser worker：SyncSettings.tsx、PersistenceNotice.tsx、test-sync-browser.mjs、隔离同步测试入口；读冻结接口，真实设置入口、范围/错误/冷却/双主题与两客户端行为。
4. 主会话：syncData.ts、test-sync-records.mjs、任务约束取消兼容、索引/长期规范、集成回归、独立审查、归档日志与本地提交。不能回滚其他代理改动。

基线8ff7043；main工作。各项完成后先相关测试，再统一完整test/tsc/build；不写纯文案快照，不使用空门禁mock掩盖旧测试loader变化。当前协议为快照，不声称已交付独立增量服务或应用容量提升。
