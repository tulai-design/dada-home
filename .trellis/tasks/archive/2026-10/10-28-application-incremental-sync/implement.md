# 实施

1. 固定 SDK 包、任务与边界。并行实现存储状态机及 codec/controller，各自明确所有权。
2. 沿现有应用公开保存接口验证纯本地行为；真实 IndexedDB 测事务、并发、队列与恢复门禁。
3. 临时真实服务、两个隔离浏览器 origin 验证对象/增量/重试/冲突/失败游标；不访问真实用户数据。
4. 运行本机 pnpm 的 exec tsc --noEmit、test、build。独立 Standards 与 Spec 审查，修复后针对验证。
5. 更新长期契约、父任务进度与日志，归档已验收子任务，本地提交；不推送或发布。

主代理负责任务、依赖、真实浏览器验收与收尾。sync_store_core 负责 db/applicationData/store/types/storageCommit；sync_http_standards 负责 codec/projection/controller 与纯测试。审查使用独立代理。
