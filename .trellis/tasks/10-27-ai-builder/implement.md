# 执行地图

## 任务图

父任务负责本地图和最后集成；每个子任务有独立 PRD 与验收。任务状态以各 task.json 为准，归档目录仍保留原 task id。

| 任务 | 交付 | Blocked by |
| --- | --- | --- |
| `10-27-builder-workflow` | 建立项目工作流和文档基线 | 无 |
| `10-27-builder-guidance` | 统一 AI 设计指引与工具示例 | 无 |
| `10-27-effect-policy` | 约束页面特效组合与运行质量 | `10-27-builder-guidance` |
| `10-27-effect-theme-fallback` | 特效双主题配色与静态内容降级 | `10-27-effect-policy` |
| `10-27-page-inspector` | 为 AI 提供真实页面检查反馈 | 无 |
| `10-27-page-sections` | 响应式首页布局积木 | 无 |
| `10-27-homepage-recipes` | 首页组合与草稿预览应用 | `10-27-page-sections`、`10-27-page-inspector`、`10-27-effect-theme-fallback` |
| `10-27-applet-charts` | 增强 Applet 数据图表能力 | 无 |
| `10-27-applet-data-table` | 增强 Applet 数据管理能力 | 无 |

## 当前批次

- [x] 初始化工作流、完成文档和源码约束、校验上下文。
- [x] 修正 AI 工具示例与设计指引，运行现有回归。
- [x] 两轴审查并归档本轮已验收子任务，记录未提交状态。

## 后续批次

1. 效果策略贯通目录→写入→渲染，再做主题/内容降级；检查器可以并行。
2. 响应式布局积木→四类首页组合与草稿应用，结合第一批检查能力验收。
3. 图表和数据列表分别选定版本、封装目录、做完整小工具示例。

## 验证

本机 pnpm：`/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`。
按子任务运行现有针对性脚本、`exec tsc --noEmit` 和必要的 `test`/`build`；build 子进程 PATH 也优先本机路径。文档检查任务关系、上下文、Markdown本地链接和workflow phase提取。UI任务增加实际浏览器证据。

父任务最终做全范围需求审查和组合场景验证；一批通过不等于父任务完成。

## 2026-10-27 交付进度

工作流与设计指引已提交为 f8e5504。effect-policy已提交41ce919并归档。effect-theme-fallback已实现并通过验收：语义/双模式配色、失败上报与重试，详见子任务verification.md；已提交19b0c78并归档。

page-inspector已接通真实页面ref、有限DOM采样、只读inspect_page与模型结果回灌，完成真实溢出→修复→复查路径及四种宽度/双主题浏览器矩阵。验收与提交见该子任务verification.md。

page-sections已实现主视觉、内容分区、主次分栏及AI目录/写入工具；保持旧页面和组件/应用ID，接通CRUD、保存、模板与撤销。真实PageView覆盖四种宽度/双主题、桌面窄容器、键盘顺序与状态存活；真实App的AI双栏649px容器、inspect_page回灌和刷新恢复也已验证。详见该子任务verification.md。后续首页组合消费此合同。

homepage-recipes已接通四方向确定性编排、内存草稿、版本/正式首页冲突校验、静态预览和单次应用/取消/撤销，AI目录与独立草稿检查宿主完整转发。真实App模拟模型完成生成→检查→修正→复查→应用→撤销，便签与原DOM保留。验收范围仅布局，动态背景和业务内容不运行。详见该子任务verification.md。下一项applet-charts，随后applet-data-table；父任务仍需最终集成验收。

2026-10-28：applet-charts接通有界LineChart目录/数据校验/宿主SVG、精确明细和共享本地记录示例；保留Bars与既有运行时。当前子任务验收见其verification.md，后续applet-data-table及父任务最终集成。此前main已推送至1d12e1f，CI和镜像发布成功。

2026-10-28存储核对：用户询问100KB与IndexedDB，确认内置组件/聊天已用IndexedDB，而AI App/Applet仍各自写localStorage且硬编码100000 JSON字符上限。当前数据表任务保持存储边界；后续重点为统一AI应用IndexedDB存储、旧数据迁移、失败反馈、备份兼容和重新制定容量，另设完整纵向任务后实现。不能仅提高常量或宣称切库已完成。

2026-10-28：applet-data-table交付受控DataTable、稳定ID选择/删除、窄容器详情、共享开销记录示例与AI目录。协议11/11、UiTree SSR7/7、完整test/tsc/build、真实App闭环及四宽双主题矩阵通过，修复同内容快照导致旧回声阻挡外部状态的问题。子任务验收见其verification.md；父任务仍需对首页草稿、检查器、特效和新数据积木执行组合场景验收后再归档。

2026-10-28：存储后续已独立建立 [storage-sync](../10-28-storage-sync/prd.md) 父任务与六个子任务，覆盖可靠保存、v1兼容、AI应用迁移、长期聊天、可选自建增量服务和容量管理。用户确认允许可选服务并保留纯本地；当前仅研究/规划。本任务组合验收仍保留，不因转入存储工作而视为完成。
