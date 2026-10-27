# 图表实现核对

日期：2026-10-28。

## 事实

- 本仓React/ReactDOM声明^19.1.1，本机及lock锁定19.3.1，现有Applet白名单只有Bars和简单Table，package.json未直接依赖Recharts。目录生成runner ui函数与AI指南，渲染仍须显式接线。
- [Recharts官方仓库](https://github.com/recharts/recharts)说明其为React/D3的SVG图表库；官方安装说明要求react-is与React版本匹配。Context7读取官方package.json的v3 peer约束包含React19。
- [Recharts无障碍官方资料](https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx)说明3.0默认开启accessibilityLayer，以键盘/tooltip反馈点数据。这是候选库能力，并不代替本仓协议、主题和实际容器适配。
- [W3C复杂图像指南](https://www.w3.org/WAI/tutorials/images/complex/)要求为图表提供简短识别说明和传达关键信息的详细文本表达，并建议让详细说明对所有用户可见。
- [MDN SVG元素参考](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/svg)描述SVG可嵌入HTML并定义自己的viewport/viewBox；无需图表依赖即可绘制受控折线。

## 决策（工程判断）

本轮范围是有界分类序列的折线/趋势，而非通用图表编辑器。使用React原生SVG与宿主数据明细表，保留既有依赖和运行时；将参数检查、缺失值、数量限制与可读信息集中在小模块中。没有声称Recharts不兼容或不能满足需求，只是本轮不需要增加完整图表运行时。

明确限制为120个点、4个系列，同一纵轴/单位，无动画和缩放；超过限制要求AI预聚合，不能截断后误称完整数据。未来出现复杂坐标/缩放/组合图需求时重新比较库封装，不把本模块扩成自制通用图表引擎。
