# AI 搭建能力审查

日期：2026-10-27。初始源码基线：`d896f02d6dcb0e383db0dd7f0d5137c6f86f44b6`。范围：源码与官方资料，未进行一轮真实模型生成效果验收。后续改动和检查证据由对应任务记录。

## 已有基础

- 系统指令与工具提供内置/声明式组件、特效、Lobe Applet 和 HTML App 四档能力，见 [ai.ts](../../../src/lib/ai.ts)。
- 应用目录、设置、分组、运行形态、容器上下文和持久数据已有实现；Applet 已有简单 `Bars` 和 `Table`，见 [catalog.ts](../../../src/lib/applet/catalog.ts)。
- 图层、主题与模板有规范化和撤销基础；主题默认还原已有统一资料。
- 很多本地特效已实现减少动画、离屏/页面隐藏暂停、DPR限制；[views.tsx](../../../src/fx/views.tsx) 已延迟加载，[Fx.tsx](../../../src/fx/Fx.tsx) 已错误隔离。不能笼统说特效没有适配。

## 缺口与影响

| 证据 | 缺口 | 后续任务 |
| --- | --- | --- |
| [tools.ts](../../../src/lib/tools.ts) 的外观示例、[fx.tsx](../../../src/widgets/fx.tsx) 的描述 | 初始基线鼓励固定渐变、大圆角、阴影和叠加，与设计规范矛盾 | builder-guidance |
| [workspace.ts](../../../src/lib/workspace.ts) Page 与 ComponentSpan | 页面主要是有序组件与粗粒度跨度，缺少分区/主次组合 | page-sections |
| [设计规范](../../design-system.md) 交付检查 | AI 没有渲染测量或截图；配置成功不等于视觉验收 | page-inspector |
| [catalog.ts](../../../src/fx/catalog.ts) FxDef / normalizeParams | 描述与参数完整，但无组合成本/设备降级元数据；颜色主要为固定值 | effect-policy、effect-theme-fallback |
| [ops.ts](../../../src/lib/ops.ts) setLayers | 最多三图层不是统一性能预算，内容块也可运行效果 | effect-policy |
| [Fx.tsx](../../../src/fx/Fx.tsx) Quiet | 出错统一返回 null，承载文字的效果也可能丢内容 | effect-theme-fallback |

## 库研究结论

安装依赖不等于 AI 可调用。新 UI 能力先封装进宿主目录，继续使用现有主题和控件；计算库导入与 UI 组件导入区分。

- **Motion / GSAP**：项目已经安装，先统一现有动效。Motion 的减少动画设置主要关闭 transform/layout，其他动画仍需单独处理：[官方无障碍指南](https://motion.dev/docs/react-accessibility)。
- **Recharts**：候选用于趋势、折线等增强；封装窄屏刻度、摘要、主题和数据量约束：[官方仓库](https://github.com/recharts/recharts)。
- **TanStack Table**：候选用于筛选/排序等数据管理逻辑，宿主负责 UI 和手机布局；实现前锁定版本，不混用不同主版本文档：[官方仓库](https://github.com/TanStack/table)。
- **Embla**：仅在画廊/触摸轨道确有需要时接入，少量内容可用 CSS 滚动：[官方仓库](https://github.com/davidjerleke/embla-carousel)。
- **Magic UI**：选择其开源组件逐个适配，避免搬入第二套 UI：[官方仓库](https://github.com/magicuidesign/magicui)。
- **dotLottie**：未来受控动画资产播放器的候选，运行时与素材资产许可分别核对：[官方仓库](https://github.com/LottieFiles/dotlottie-web)。
- **React Bits**：继续使用已登记的本地效果；当前上游许可带附加条件，不能仅据本仓“MIT”注释推断来源。核对引入版本与通知，不能反推历史副本必然适用新条款：[当前许可](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)。

这些是基于适配成本的推荐，不是已选定依赖或已完成的功能。没有进行设备性能基准测量，不编造 FPS、耗电或加载耗时。
