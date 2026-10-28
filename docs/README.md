# 搭搭文档中心

`docs/` 保存长期产品知识、运行时契约和决策；`.trellis/tasks/` 保存任务状态与执行材料；`.trellis/spec/` 保存开发时必须读取的精炼代码约束。术语以根目录 [GLOSSARY.md](../GLOSSARY.md) 为准。

## 文档地图

| 入口 | 回答的问题 | 范围 |
| --- | --- | --- |
| [产品定位与能力地图](product/product-brief.md) | 搭搭为谁服务、现在能做什么、有哪些边界？ | 当前产品上下文 |
| [系统契约](specs/README.md) | 当前行为是什么、已接受的目标是什么？ | 现状与目标分别标注 |
| [设计规范](design-system.md) | 界面、文案、主题和应用形态怎样保持一致？ | 人与应用内 AI 共用的规范 |
| [决策记录](decisions/README.md) | 为什么采用某种架构或工作方式？ | 决策与取舍 |
| [工作记录](work/README.md) | 本轮研究、范围和验证证据在哪里？ | 阶段性记录 |
| [任务工作流](agents/workflow.md) | Matt skills 如何与 Trellis 一起工作？ | 开发工作流 |
| [任务跟踪约定](agents/issue-tracker.md) | 需求与任务保存在哪里、如何关联？ | 任务唯一来源 |
| [领域文档约定](agents/domain.md) | AI 应读取哪些术语与决策？ | 文档消费规则 |

## 当前入口

- [运行时现状契约](specs/runtime-contract.md)：工作空间编辑、应用设置、形态、主题与生命周期。
- [AI 页面生成质量目标](specs/ai-page-design-quality.md)：已接受的改进方向；未完成能力不能宣称已交付。
- [AI 搭建能力增强里程碑](work/milestones/2026-10-27-ai-builder.md)：本轮范围与实施顺序。
- [代码与组件生态审查](work/research/2026-10-27-ai-builder-audit.md)：问题证据与扩展候选。
- [存储与可持续同步计划](work/milestones/2026-10-28-storage-sync.md)：可靠保存、应用存储、快照同步与长期聊天已交付；共用自建同步服务与容量管理继续分期实施。

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

安装、使用、部署与备份说明仍以项目 [README](../README.md) 为入口。
