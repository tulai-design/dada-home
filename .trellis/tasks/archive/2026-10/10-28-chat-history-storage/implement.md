# 实施步骤

1. 纯chatStorageSchema、DB索引/仓与聊天仓库分页/显式写API，公开行为测试。
2. App发送上下文与目标绑定，Assistant真分页/锚点，ToolRow按需明细与状态，行为测试。
3. 备份v3/恢复五仓/sync逻辑join-split及原测试适配。
4. 真实1000会话/10000轮基线对比、页面操作/流式/细节故障、完整备份和同步，文档规范更新。
5. 全量检查、独立双轴审查、中文验收、本地提交与归档日志。

所有权：核心代理chatStorageSchema.ts/chat.ts/db.ts及新test-chat-history.mjs；UI代理App.tsx/Assistant.tsx/ToolRow.tsx/assistant.css与test-assistant-flows.mjs及其布局导航测试必要适配；集成代理storage.ts/storageCommit.ts/syncData.ts与已有storage/sync测试和测试入口；主代理任务/文档/新chat-history-browser脚本及独立测试页/package脚本/提交。接口变化先沟通，不回滚他人工作；main，不推送或部署。
