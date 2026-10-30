# 前端规范

搭搭是 React + TypeScript + Vite 单项目，宿主控件使用 Lobe UI。先读 [设计规范](../../../docs/design-system.md)，再按改动范围选择下列文档。

| 文档 | 适用改动 |
| --- | --- |
| [目录与职责](directory-structure.md) | 找代码、决定新增文件位置 |
| [组件与主题](component-guidelines.md) | 宿主 UI、内置组件、页面布局 |
| [主题作者合同](../../../docs/specs/theme-authoring.md) | 单字段目录、草稿事务、独立预览和字体 lease |
| [页面分区](page-layouts.md) | 主视觉、内容分区、主次分栏、引用顺序与容器重排 |
| [首页草稿](homepage-drafts.md) | 首页组合、预览隔离、版本与冲突、单次应用和检查 |
| [Applet趋势图](applet-charts.md) | 有界数据协议、缺失值、主题、响应式与数据明细 |
| [Applet数据管理](applet-data-table.md) | 受控搜索/排序/分页、稳定ID选择、窄容器详情与持久化边界 |
| [状态与持久化](state-management.md) | 工作空间、应用数据、撤销与迁移 |
| [Hooks 与生命周期](hook-guidelines.md) | 尺寸、定时器、监听与异步状态 |
| [输入与类型](type-safety.md) | AI 配置、导入数据、字段协议 |
| [质量检查](quality-guidelines.md) | 测试、构建和浏览器验证 |

修改 AI 工具、Applet 或特效还需读 [AI 规范](../ai/index.md)。页面特效预算已实现，契约见 [特效规范](../ai/effects.md)；有限 DOM 页面检查通过 `inspect_page` 提供，边界见 [工具规范](../ai/tools-and-apps.md)，不能视为截图或审美验收。
