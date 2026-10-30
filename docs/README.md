# 搭搭文档中心

`docs/` 保存长期产品知识、运行时契约和决策；`.trellis/tasks/` 保存任务状态与执行材料；`.trellis/spec/` 保存开发时必须读取的精炼代码约束。术语以根目录 [GLOSSARY.md](../GLOSSARY.md) 为准。

## 文档地图

| 入口 | 回答的问题 | 范围 |
| --- | --- | --- |
| [使用指南](guides/usage.md) | 怎样配置 AI、使用应用、备份和同步数据？ | 完整产品操作说明 |
| [部署指南](guides/deployment.md) | 怎样一键部署 Vercel，或运行 Docker、静态站点？ | 部署配置、代理与运行边界 |
| [开发指南](guides/development.md) | 怎样启动、构建、测试与扩展系统？ | 开发环境与源码地图 |
| [产品定位与能力地图](product/product-brief.md) | 搭搭为谁服务、现在能做什么、有哪些边界？ | 当前产品上下文 |
| [系统契约](specs/README.md) | 当前行为是什么、已接受的目标是什么？ | 现状与目标分别标注 |
| [设计规范](design-system.md) | 界面、文案、主题和应用形态怎样保持一致？ | 人与应用内 AI 共用的规范 |
| [决策记录](decisions/README.md) | 为什么采用某种架构或工作方式？ | 决策与取舍 |
| [工作记录](work/README.md) | 本轮研究、范围和验证证据在哪里？ | 阶段性记录 |
| [任务工作流](agents/workflow.md) | Matt skills 如何与 Trellis 一起工作？ | 开发工作流 |
| [任务跟踪约定](agents/issue-tracker.md) | 需求与任务保存在哪里、如何关联？ | 任务唯一来源 |
| [领域文档约定](agents/domain.md) | AI 应读取哪些术语与决策？ | 文档消费规则 |

## 当前入口

- [浏览器扩展契约](specs/browser-extension.md)：完整新标签页的打包下载、运行实例、权限与生成应用边界；早期分析见[可行性调研](work/research/2026-10-30-browser-extension-feasibility.md)。
- [架构与扩展性评估](work/research/2026-10-29-architecture-extensibility-audit.md)：主题、Agent、应用和存储的当前判断与演进建议，未作为已接受设计。
- [A3 深度主题与创意工坊设计研究](work/research/2026-10-30-theme-shell-architecture.md)：主题身份、稳定宿主、Agent 作者接口与热插拔路径；分层开放方向已接受；主题身份与完整派生已落地，稳定宿主、作者预览及本地包继续按序推进。
- [运行时现状契约](specs/runtime-contract.md)：工作空间编辑、应用设置、形态、主题与生命周期。
- [AI 页面生成质量目标](specs/ai-page-design-quality.md)：已接受的改进方向；未完成能力不能宣称已交付。
- [AI 搭建能力增强里程碑](work/milestones/2026-10-27-ai-builder.md)：本轮范围与实施顺序。
- [代码与组件生态审查](work/research/2026-10-27-ai-builder-audit.md)：问题证据与扩展候选。
- [存储与可持续同步计划](work/milestones/2026-10-28-storage-sync.md)：可靠保存、应用存储、快照同步、长期聊天和自建增量同步开发已交付；容量与同步范围管理继续完善。

## 单一事实来源

1. 产品现状写在 `product/`，稳定行为写在 `specs/`；任务执行进度只在 `.trellis/tasks/` 维护。
2. `.trellis/spec/` 记录实现约束并链接长期契约，不复制整份产品文档。
3. 任务完成后，将已验证的行为更新到现状契约；目标规范的接受状态不能代替实现与验证状态。
4. `docs/design-system.md` 已被应用内技能直接读取，保留原路径；设计规则只在该文件维护一份。
5. 研究与讨论保留日期和证据。结论成为长期规则后，链接正式规范，避免两处正文继续分叉。

## 命名与状态

文件名使用 ASCII `kebab-case`，正文以中文为主。长期文档使用稳定名称，阶段记录使用 `YYYY-MM-DD-topic.md`，决策使用四位编号。

规范分别记录**决策状态**与**实现状态**：`accepted` 表示方向已接受，`planned` 表示尚待实现，不能合并为“已完成”。现状文档记录核对日期，行为变化时连同源码一起更新。

## 原有文档

- [修复计划](fix-plan.md)：早期功能修复记录，保留原路径；当前待办以 Trellis 任务为准。
- [书签扩展上架材料](extension-store-listing.md)：浏览器扩展的商店说明与发布材料。

项目 [README](../README.md) 提供功能画廊与快速开始，详细操作收录于上方指南；[截图说明](images/readme/README.md)记录演示内容及复现方法，[品牌图提示词](brand/readme-art-prompts.md)提供可选宣传素材方向。
