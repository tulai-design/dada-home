# 执行与文件所有权

基线：7991440，直接在 main 开发。用户已要求先做存储，当前子任务无需重复确认。

1. 核心代理：db.ts、componentData.ts、chat.ts、store.ts、workspaceStore.ts、新 persistence.ts，以及 scripts/test-storage-durability.mjs。先复现失败结果和队列交错，再实现严格事务、重试、迁移。
2. 备份代理：storage.ts、SettingsPage.tsx、scripts/test-storage-backup.mjs。按核心冻结的 batch/snapshot/recovery 接口实现校验、恢复日志和导出屏障；与核心协调，不覆盖他人文件。
3. 主会话：同步共用服务研究与任务边界、文档、App/main 的可见失败与启动恢复、测试链与集成；核心完成后把释放的代理用于真实浏览器检查与双轴审查。

检查先对相关行为逐项红绿，再完整 test/tsc/build。真实浏览器新增独立 context 的测试入口，阻断外网和自动同步，不使用用户标签页。完整回归覆盖旧运行时 loader 的新增依赖，不能用空 mock 代替真实持久化模块而误报通过。

本轮归档条件为 PRD 全部验收有证据；如果真实错误需要扩大方案，先记录原因和范围变化，不能声称吞错已修却遗漏备份或启动调用点。
