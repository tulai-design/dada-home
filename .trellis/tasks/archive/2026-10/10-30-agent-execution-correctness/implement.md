# 实施计划

1. 在基线复现A1/A2，沿用行为测试写取消/失败回归，确认失败后小步修复。
2. 实现代理拥有 src/App.tsx、src/lib/ai.ts、tools/siteTools/lifeTools/searchTools、必要取消辅助模块、scripts相关行为回归及 package.json 测试入口；不修改文档/任务。
3. 实现稳定后真实浏览器代理拥有 scripts/test-agent-execution-browser.mjs 与任务内 browser 验证输出，独立上下文模拟模型、真实审批/停止/失败；需要改产品代码由根会话协调给实施者。
4. 根会话更新 AI 规范、运行时合同、架构评估状态和质量规范入口。统一 tsc/test/build；双轴独立审查修复，提交归档日志。

命令使用 /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm；build PATH 首位同一本机bin。浏览器工具从 DADA_PLAYWRIGHT_PATH 提供，不增加生产依赖。不声称线上模型或跨浏览器验证。
