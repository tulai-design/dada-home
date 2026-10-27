# 组件、布局与主题

## 宿主 UI

遵守 [设计规范](../../../docs/design-system.md)：Lobe 控件、Phosphor 图标、现有主题变量、必要文案和明确状态。避免以硬编码底色、文字色、大圆角和阴影作为默认示例。交互组件需覆盖空、加载、错误、禁用和键盘焦点。

`docs/design-system.md` 由 [skills.ts](../../../src/lib/skills.ts) 以 `?raw` 导入，不能随文档重组移动路径。主提示词、工具示例和运行时技能必须与它一致。

## 新增页面组件

通过 [registry.ts](../../../src/lib/registry.ts) 的 `registerComponent` 注册，提供名称、用途、配置 schema、默认配置、跨度、是否多实例及必要的 `normalize`。在 [widgets/index.ts](../../../src/widgets/index.ts) 导入注册模块；例如 [countdown.tsx](../../../src/widgets/countdown.tsx)。只有宿主接入成功后，AI 才能从目录发现和调用。

舞台组件使用定义中的 `stage` 交给 [PageView.tsx](../../../src/components/PageView.tsx) 布局。顶部紧凑显示应提供专用 `status`，不能直接缩放完整窗口。

## 容器与主题

页面、半宽组件、抽屉、弹窗和 AI 分栏的可用宽度不同。按实际容器布局，不以浏览器窗口宽度代替；移动端、窄抽屉和分栏都应检查。宿主标题栏、窗口控制和设置入口由宿主承担，应用内容不要重复绘制。

颜色引用语义变量。新主题的共享变量与 `light` / `dark` 分支按 [themes.ts](../../../src/lib/themes.ts) 规整；默认外观还原使用 [appearance.ts](../../../src/lib/appearance.ts)，不能以重新应用布局模板代替。

文字或数据的动画降级必须保留语义内容。这是新增/修改效果时的实现要求；当前已有错误隔离并不代表所有旧效果已实现该降级，详见 [特效规范](../ai/effects.md)。
