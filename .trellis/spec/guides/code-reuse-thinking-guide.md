# 复用与事实来源

新增能力前用 `rg` 搜索现有实现、注册项与测试。优先复用已经承担规整和生命周期的模块，避免在工具/组件中再写一套。

| 需要的信息或能力 | 事实来源 |
| --- | --- |
| 组件配置与可用类型 | [registry.ts](../../../src/lib/registry.ts) 和各 widgets 定义 |
| 默认/当前/差异外观与还原 | [appearance.ts](../../../src/lib/appearance.ts) 与 [workspace.ts](../../../src/lib/workspace.ts) |
| 主题规整与明暗分支 | [themes.ts](../../../src/lib/themes.ts) |
| Applet 可用 UI 积木 | [catalog.ts](../../../src/lib/applet/catalog.ts) 与 [render.tsx](../../../src/lib/applet/render.tsx) |
| 特效 ID 与参数 | [fx/catalog.ts](../../../src/fx/catalog.ts) |
| 人与运行时 AI 共用的设计要求 | [docs/design-system.md](../../../docs/design-system.md) |
| 验证命令与脚本 | [package.json](../../../package.json) 与 [质量检查](../frontend/quality-guidelines.md) |

不要复制同一默认外观到提示词里；不要安装第二套 UI 控件仅为获得一种组合；不要让新增依赖绕开 Applet 积木目录。现有 `Bars`/`Table` 是简单数据展示，未来 Chart/DataTable 是能力增强，描述时保留这个区别。

发现说明与实际能力冲突时，先定位权威实现和用户意图，再一起修改相关说明与例子。审查意见也要沿真实数据来源验证，不能把内部固定目录和外部 AI 输入混为同一信任边界。
