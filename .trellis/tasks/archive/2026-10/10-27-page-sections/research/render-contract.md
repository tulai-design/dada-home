# Research: 页面分区渲染与容器响应式接缝

- Query: 如何在现有 PageView 中增加 hero / section / split 布局，保留组件身份、实际容器适配及可检查性？
- Scope: internal
- Date: 2026-10-27

## Findings

### 文件与现有职责

| 文件 | 已确认的行为 |
| --- | --- |
| `src/components/PageView.tsx` | 页面数据转实际组件的唯一通道；应用安装记录解析、跨度、外观、错误边界和暂停态在此集中处理 |
| `src/styles.css` | `.page-grid` 基础12列栅格、单组件舞台与760px窗口断点 |
| `src/theme.css` | 主题覆盖、桌面一屏/组件局部滚动、默认首页三组件特殊居中、手机整页纵向滚动 |
| `src/App.tsx` | 当前 `.page` 根与检查器注册、FxLayers包裹、AI分栏后真实canvas |
| `src/fx/Fx.tsx` | 保持业务子树父级稳定，页面特效背景portal与预算上下文 |
| `src/lib/pageInspector.ts` | 以真实页面根采组件外框，按 `.widget[data-id]` 定位，允许真实局部滚动 |
| `tests/page-inspector-regressions.*` | 真实DOM容器、溢出/裁切、未知与只读边界的现有夹具 |
| `tests/effect-policy-regressions.tsx` | 在隔离内存页面中切换实际容器宽度、明暗与特效，同时验证业务输入存活 |
| `tests/application-layout-regressions.tsx` | Applet实际容器响应式、局部表格横滚及init次数保持的可复用测试模式 |

### 源码证据与必须避开的冲突

1. **已有组件身份必须继续由实例ID控制。** `PageView.tsx:59-99` 在同一个 `.page-grid` 父级直接map组件，key是instance.id，并统一选择应用canonical配置、暂停态、CustomWidget、注册组件和WidgetBoundary。新布局应重用这段渲染，不另写第二套应用解析或使用section/index作为组件key。
2. **响应式不能只依靠现有media query。** `styles.css:3691-3695` 的全宽规则使用窗口760px；`theme.css:2035-2054` 的单列、整页滚动也在手机media query内。AI分栏里窗口仍宽、左侧页面已窄，这两处不会自动解决新分区。`App.tsx:714-743` 已有真实canvas及`.page`可作为容器边界。
3. **长页面必须显式解除一屏限制。** `theme.css:1005-1013` 页面overflow:hidden、栅格height:100%；`theme.css:1089-1098` widget max-height:100%和局部滚动。新分区若只加wrapper，长内容会被裁。建议新布局模式给`.page`标记，启用overflow-y:auto；新栅格height:auto/min-height:100%，新widget不受旧一屏max-height影响。旧扁平页面规则保持原样。
4. **首页与舞台有特殊布局。** `PageView.tsx:46-56` 单个注册stage组件会居中；`styles.css:3671-3687`给stage固定上限宽度且移除卡片外观。`theme.css:1020-1033`用三个直接widget的nth-child/has规则将clock/search/links居中。显式sections模式应关闭自动整页stage和旧三组件特殊匹配；未声明sections继续旧逻辑。单独hero可控制本区宽度和留白，而不自动变成整页舞台。
5. **首页只冻结身份与导航位置。** `ops.ts:106,118,147`限制改名/图标、删除和移动；`setPageStyle`在`ops.ts:123-141`不禁止首页外观修改。因此首页可增加布局字段，无须改变冻结规则。
6. **不要因断点或主题重建业务树。** `Fx.tsx:199-204`特意保持业务父级稳定，`widgets/applet.tsx:72-97`的iframe首次ready执行init；布局重挂载会重启它。仅CSS收列最安全。若使用ResizeObserver，只改data属性或布局计算，observer清理遵循Hooks规范，不能切换两套桌面/手机JSX。
7. **检查器可直接复用。** `pageInspector.ts:103-110,170-183`以页面根内widget为归属；新增分区wrapper不要带`.widget`或复用业务data-id，真实widget继续保持data-id/type。如果直接widget仍共用父级，现有selector及外框检查无需扩大范围。
8. **点击穿透必须保留。** `theme.css:183-195`栅格pointer-events:none，只有直接widget恢复auto。新标题或控件若作为直接兄弟/新wrapper，应明确交互控件恢复pointer-events:auto；不要用覆盖整个区的透明点击层挡住背景或业务控件。

### 推荐的最小渲染方案（设计建议）

- 数据仍保留`page.components`作为组件实体集合。页面可选布局描述只引用这些实例ID；一个ID最多出现一次，未被引用的组件按原顺序追加，不因不完整分区描述消失。具体校验与操作边界交由数据层研究。
- 首版三种结构足够：`hero`为一个主内容组、限制可读宽度与可选居中；`section`为带可选短标题的内容组；`split`为主列/辅列及受控比例（如2:1、1:1）。不要开放任意CSS定位树或新控件库。
- **强身份保证优先时，保持widget为同一个稳定`.page-grid`的直接keyed子节点。** 将布局描述编译成扁平渲染顺序与受控grid-row/grid-column位置，标题也是稳定key兄弟。split主列/辅列可按索引配对占行，首版不做独立瀑布流。这样分区增删/重排和宽度变化都不会因为React父级改变而重启业务组件。
- 如果选择真实section/column嵌套wrapper，CSS`display:contents`也不会消除React父级身份变化；组件在组间移动或从旧扁平切换到分区会重挂载。不能在采用该方案后声称“只改布局保留运行内存”。至少明确测试断点变更稳定，并就结构迁移的状态边界作出产品决定。没有必要为此引入portal重挂载系统。
- 窄容器布局使用CSS容器查询，容器以`.page`或稳定布局外壳为准，收列规则不使用window宽。建议主辅列默认在实际可用宽小于约720px时按主列→辅列落单列；最终阈值由长内容夹具验证。所有grid列使用minmax(0,...)，widget和标题min-width:0，长标题overflow-wrap:anywhere。
- DOM顺序即阅读/键盘顺序：分区顺序→主内容→辅助内容。手机仅撤销显式行列位置回到自动流，不用CSS order造成键盘跳跃。不要用tabIndex正值修补布局顺序。
- 标题可用h2，hero主标题由其内容组件提供或只选一种来源，避免重复标题。未传标题不显示占位口号；空分区省略或紧凑Empty（按产品决定），不绘大空卡片。普通分区靠24/32px留白分组，使用主题变量，不默认加外框、上边线、大圆角和解释性文案。

### 预期修改与验证入口

必须：`PageView.tsx`（共用widget渲染与布局计划）、`theme.css`或单独`page-layout.css`（受控布局样式）、`App.tsx`（可选页面模式/容器标记及滚动边界）、布局计划模块（纯数据至位置计算）、工具目录/说明和设计规范。`styles.css`旧规则若能通过模式限定覆盖则不必改；`Fx.tsx`、Applet和检查器不应为本任务重构。

新增独立`tests/page-sections-regressions.html/.tsx`，沿用现有内存夹具与Lobe ConfigProvider，渲染真实PageView/FxLayers。浏览器脚本沿用外部DADA_PLAYWRIGHT_PATH，不新增生产依赖。

验收应同时覆盖：

1. 320/375/768/桌面窗口，以及同一1440px窗口下将页面容器从900px缩到360px再恢复，测实际geometry与横向overflow。
2. 浅深主题、长中文/连续拉丁长标题、空分区、只有一个stage组件的新旧两种页面、默认clock/search/links首页保持旧布局。
3. 输入值、计数、本地state和Applet init次数在宽度/主题/布局计划变化后保持；同ID不能出现两份widget或应用运行实例。
4. 依次Tab获取的控件顺序与窄容器内容顺序一致；无CSS order重排。
5. 真实inspect_page采样新布局，合法长页面/滚动不报裁切，故意固定宽度组件能定位并在修复后消失。

## External References

本研究只核对仓库源码和已接受任务，没有新增依赖或外部API选择；未引用外部网页。实际React/CSS行为应由本仓真实浏览器夹具验证，本文建议不等同于已实现能力。

## Related Specs

- `.trellis/tasks/10-27-page-sections/prd.md`：实际容器重排、旧页面身份兼容、键盘/主题/空内容。
- `.trellis/spec/frontend/component-guidelines.md`：PageView统一渲染、舞台交由宿主、实际容器布局。
- `.trellis/spec/frontend/hook-guidelines.md`：尺寸只更新布局，不能重新初始化应用。
- `docs/design-system.md`：token、必要文案、少装饰、舞台和页面质量要求。

## Caveats / Not Found

- 没有独立widgetGrid模块；现有布局逻辑集中在PageView与两份CSS中。
- 现有media query只解决窗口窄屏，不能作为AI分栏已适配的证据。
- 首版扁平grid方案不提供独立主辅列瀑布流；如果需求要求真正嵌套任意分区树，需要另定身份和重挂载边界，不能隐藏该代价。
- 本研究未运行浏览器或改动源码，列出的用例是实施验收建议。
