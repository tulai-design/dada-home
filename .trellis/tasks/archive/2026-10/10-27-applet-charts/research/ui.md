# Research: Applet 图表 UI 与现有依赖

- Query: 当前可复用哪些图表能力；本轮折线/趋势图怎样适配宿主主题、窄容器、触摸与键盘，并给 AI 一个可用示例？
- Scope: internal（源码、已安装包元数据、现有规范；外部官方资料由主会话另查）
- Date: 2026-10-27

## Findings

### 当前能力与文件

| 文件 | 本地事实 |
| --- | --- |
| `package.json:15` | 直接依赖没有 Recharts、ECharts、Chart.js、Visx、D3、uPlot；已有 React、Lobe UI、Motion 等。 |
| `pnpm-lock.yaml` | 对上述主流图表库及 d3-* 搜索未找到锁定项；不能视为已有可复用图表引擎。 |
| `node_modules/react/package.json` | 本机实际安装 React 19.3.1，声明范围为 ^19.1.1。 |
| `node_modules/@lobehub/ui/package.json` | 本机 Lobe UI 6.5.1，peer React ^19.0.0；依赖含 TanStack table/virtual，但未含上述图表库。不能因为其间接安装就从应用直接消费未声明依赖。 |
| `src/lib/applet/catalog.ts:32` | 目前只有 `Bars(values, labels, highlight, height)`，接着是简单 Table。新增图表需明确目录项。 |
| `src/lib/applet/render.tsx:224` | Bars 是宿主原生 div 柱形：最多60个非负值，最小高度3%，title显示数值，role img仅叫“柱状图”；没有趋势折线、触摸/键盘取值或数据摘要。保留现有行为，不顺带改Bars协议。 |
| `src/life.css:749` | Bars以text3/主色区分柱与highlight，无背景卡片；Table样式在786起。新图表样式可同样靠近applet范围或独立文件，不继承复杂网页卡片装饰。 |
| `src/lib/applet/render.tsx:49` | `useContainerWidth()`用真实DOM contentRect和ResizeObserver测可见容器，清理observer；Grid已经使用它，不能测隐藏runner iframe或用window宽度判断图表刻度。 |
| `src/widgets/applet.tsx:54` | 宿主独立测量容器并把viewport发到runner；srcdoc只依赖source/run（72），dark和viewport分别热更新（123–131）。新增图表的尺寸/选择状态应留在宿主组件，不改变source/run。 |
| `src/lib/applet/catalog.ts:65`、`src/lib/skills.ts:73` | `appletGuide()`从CATALOG拼真实积木说明，作为应用内applet技能正文。完整趋势示例放入这里才是AI实际能读到的入口；仅写测试或README不等于AI获得能力。 |
| `tests/application-layout-regressions.tsx:12` | 现有fixture完全用内存状态、真实runner/UiTree，不导入workspace/storage。可沿用其隔离模式。114起测resize后persist和init次数。 |

### 选择建议（基于本地事实的推断，非外部库评测）

本轮仅需有限、分类横轴的折线/趋势图，建议宿主封装一个小型SVG实现。当前没有已安装图表引擎，因此“复用现有库”实际不存在；新依赖须由主会话进一步查兼容和说明取舍。

| 选择 | 本轮优势 | 需要承担的工作/边界 |
| --- | --- | --- |
| React宿主内SVG有限折线 | 不增加依赖；直接使用宿主CSS变量；图形、摘要、键盘选择都可按当前设计约束；与React19本地运行方式一致 | 必须自行定义合法数值、缺失点分段、单点/常量/负值域、刻度和文本尺寸、点上限；不能不加测试就宣称可靠。实际bundle差值需要构建测量，不虚报KB。 |
| 引入完整图表库 | 若后续明确需要复杂坐标轴、刷选、缩放、堆叠、多类型组合，成熟引擎可能节省实现 | 当前没有现成依赖；需锁定兼容React19的具体版本、核对模块体积及可访问行为，仍需宿主协议/主题/空态/摘要封装。不能把库默认tooltip当触摸和键盘已可用。 |

SVG是本轮范围足够小的选择，不应同时承诺时间比例轴、任意formatter函数、缩放、多轴或完整可视化编辑器。线条建议直线连接，不用平滑曲线制造采样间不存在的极值；缺失点断线，不能把缺失当0。

### 视觉与主题

`docs/design-system.md:34`允许控件库没有对应物的图形采用SVG，但要求键盘可到达与token样式。颜色只读`--text/--text2/--text3/--border/--main/--c-blue/--c-green/--c-amber/--c-violet`等变量（40）。不要读一次计算后的颜色后缓存到state，否则主题热更新可能滞后；SVG的stroke/fill直接引用CSS变量即可随宿主变化。

建议图形自身不再套边框卡片，不写渐变面积/强阴影/大圆角。一个短标题、必要单位、图形及可读摘要即可；一条主要序列可用主色，第二/第三序列用语义色与不同线型/点形共同区分，不只靠颜色。轴线用border、轴标签text2，数值使用tabular-nums；不要给整张图铺灰色背景。

有多系列时图例是文字列表，可换行；单系列不必重复图例和标题。长系列名最多截断可视文本，完整名称仍在可读摘要或表格中。只显示数据任务必要说明，不额外加“由搭搭生成/实时洞察/智能趋势”等口号。

### 窄容器、触摸、键盘

1. 图形宽度以自身容器为准，SVG viewBox随实际宽度；高度有界。保留左右轴标签空间，宽度不足时减少x刻度（例如首/中/末或首/末）与y刻度；不靠整体缩放把文字变成不可读的6px。
2. 建议横轴为输入顺序的分类标签，AI显式传清楚标签/单位。密集点降低刻度密度，不改变数据语义；过量数据点直接明确拒绝或说明截断范围，不能悄悄做未知聚合。若使用抽样，摘要必须基于完整允许输入并注明显示/输入数量。
3. 点选择可由整张绘图区的pointer事件找最近索引，触摸无需命中小圆点；不要阻止纵向页面滚动。键盘用一个焦点入口，左右选择、Home/End跳端点，避免每个数据点都进Tab链。聚焦态沿用宿主focus token。
4. 当前所选标签和各系列精确值显示在图下常驻一行/多行，不依赖hover/title。可用礼貌live region播报键盘选点，避免mousemove不断朗读。
5. 提供Lobe文字按钮“查看数据”，展开语义table或列表，长表局部滚动。这个入口必须键盘可用、触摸可点；摘要和数据表不依赖SVG是否被辅助技术支持。SVG可标记为image并以标题/摘要关联，数据表有caption和行列标题。
6. 宿主chart本地选点/表格展开状态不会回写Applet业务state，也不需要`onChange`沙盒桥；本轮无需新增事件协议。若数据更新，应夹住当前索引或明确回到最后点。

### 空、缺失、错误

- 空数组、无有效数值：用现有Lobe Empty，避免画一条似乎有效的零线。
- null/缺失点：呈现断点，精确值区用“无数据”，不要伪造0或将跨缺失段连上。
- 错误数据形状、系列长度不符、非有限数值：图表内短错误状态说明数据无效，不让UiTree整个应用抛错；对同一个坏点是拒绝还是缺失必须在最终契约写清，不混用策略。
- 全常量/单点/全负数：坐标域有最小跨度和对称缓冲，点可见；摘要数值必须与原始合法数据一致。
- 过量数据：先确定显式上限。已存在runner树节点限制不等于图表数据数组已受限，图形/表格和摘要都要一致处理。
- 加载/取数失败由Applet业务控制展示Loading或错误说明，图表本身是纯数据视图，不代替请求；不在view或resize中fetch。

### 建议演示：每日专注趋势

在`appletGuide()`加入一个完整`create_applet`示例“专注记录”：分组“效率”、drawer打开、默认不钉Dock/状态栏；7或14个本地日期/分钟数据、当天分钟NumberInput、一个“记录”主操作、持久化entries；趋势图显示分钟，摘要给最近值和范围。没有远程数据源、订阅或timer，容易验证值与图形一致。

可用settingsSchema提供目标分钟或显示天数，但不要同时引入双y轴或任意图表配置。若展示status能力，只返回最新分钟一行Text，不能把完整图塞进32px高状态栏（设计规范190–200）。演示必须通过真实目录→runner→UiTree；浏览器测试可据该同一示例在320/375/抽屉/桌面窄栏、深浅主题、键盘和触摸检查，并在resize后核对persist值、init/request计数。

## External references / Versions

本研究未浏览外部官方文档；所有版本来自本机安装包元数据。外部图表实现、版本和可访问性标准的核对由主会话独立完成，不能把上述建议写成第三方库官方保证。

## Related specs

- `.trellis/tasks/archive/2026-10/10-27-applet-charts/prd.md`：趋势图、空/错误状态、窄屏、数据上限和真实示例验收。
- `.trellis/spec/frontend/component-guidelines.md`：Lobe控件、宿主token、实际容器适配。
- `.trellis/spec/frontend/hook-guidelines.md`：尺寸变化不重启业务、监听清理。
- `.trellis/spec/frontend/quality-guidelines.md`：公开行为与实际浏览器证据。
- `.trellis/spec/ai/tools-and-apps.md`：新增Applet积木要接通目录与渲染；不暴露任意React UI。
- `docs/design-system.md`：单一运行时设计正文，SVG例外及主题、表格/图形交互和无障碍要求。

## Caveats / Not Found

- 没有找到可直接使用的已安装图表引擎；没有测量任何新库bundle大小。
- 本文给出方案建议，未改变公开协议或修改生产文件。最终点数/系列上限、数据字段形状及错误策略由主会话写入design后实现。
- 现有Bars仅title提示不足以充当新趋势组件的可访问设计样板，但本轮应保留其兼容行为。
- 尚未执行图表浏览器验证；不能把SVG方案和可访问设计建议记为已交付。
