# 搭搭实现规范

这些文档记录当前代码的职责、约束与验证入口。产品目标和长期契约见 [文档中心](../../docs/README.md)；尚未实现的工作以 `.trellis/tasks/` 为准，不把目标能力写成现状。

| 层 | 修改前阅读 | 范围 |
| --- | --- | --- |
| 前端 | [frontend/index.md](frontend/index.md) | 页面、组件、主题、状态与浏览器运行时 |
| AI 搭建 | [ai/index.md](ai/index.md) | 工具、应用生成、技能与特效目录 |
| 取数服务 | [backend/index.md](backend/index.md) | Node 取数代理、开发代理与部署边界 |
| 跨层修改 | [guides/index.md](guides/index.md) | 数据流、复用和验证范围 |

`docs/design-system.md` 是人和应用内 AI 共用的设计规范，并被运行时直接导入。这里引用它，不维护另一份设计规范正文。
