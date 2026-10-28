# 实施与验收

基线：a16b81b，main。依赖 storage-durability 与 sync-v1-hardening 已验收归档。

1. 独立 schema、应用仓库队列、apps DB 仓与版本失效门禁；针对公开行为验证后实现。
2. App Promise 桥和 Applet 初始化/保存确认协议接入，补运行时行为测试。
3. 新版备份、恢复日志、保存屏障、完整同步接入 apps；更新现有测试替身，不能用宽泛 mock 隐藏依赖。
4. 隔离真实浏览器覆盖大数据持久性、生命周期与故障；同步 AI 技能正文、runtime contract、README 和相关规范。
5. 本机 pnpm 执行 tsc --noEmit、test、build；独立 Standards / Spec 审查；修复、记录验证后本地提交、归档、日志。无独立 lint 命令，无本轮推送或发布。

所有权：核心工作者负责 applicationDataSchema/applicationData/db/persistence/PersistenceNotice 与独立核心测试；运行时工作者负责 widgets/app、widgets/applet、applet/runner 与两份 runtime 测试；集成工作者负责 storageCommit/storage/syncData 与已有 storage/sync 测试；主代理负责任务、文档、AI 提示词、新浏览器应用验收、package test 注册和提交。浏览器应用验收直接在独立上下文中使用真实主 App，不另建替代宿主。共享接口以 design 为准，任何变更先通知其他工作者，不回滚他人改动。
