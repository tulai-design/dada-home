# Research: Applet 图表运行时接入

- Query: 现有目录、沙盒协议与宿主渲染怎样接入趋势图，保留 Bars 与应用生命周期？
- Scope: internal；仅源码与本地规范，不做外部图表库选型
- Date: 2026-10-27

## Findings

### 现有公开链路

1. `src/lib/applet/catalog.ts:16` 的 `CATALOG` 是名字与给模型看的属性说明；`COMPONENT_NAMES` 在第50行由同一数组生成。**它没有机器可执行的属性 schema**，不能把目录的一行属性文字误认为校验已经存在。
2. `appletGuide()` 在 `catalog.ts:65` 拼接完整技能，组件列表在第187–188行输出。`src/lib/skills.ts:73` 的 `applet` 技能直接调用它；`src/lib/tools.ts:1274` 的 `create_applet` 要求先读技能。新增积木应直接加到此目录，避免另建重复工具或文档目录。
3. `src/lib/applet/runner.ts:58` 为 `COMPONENT_NAMES` 每个名字构造 `ui.Xxx(props,...children)`，返回 `{$t,p,c}`；第67行 `ser()` 转为 `{t,p,c}`，函数只转为 `{$fn:number}`，业务处理函数保留在沙盒。
4. `runner.ts:81` 的 render 调 `view(state,ctx)`，通过 `postMessage` 发送 `view` 树；宿主 `src/widgets/applet.tsx:89` 验证消息来源是自己 iframe，`view` 分支将树交给 `UiTree`。
5. `src/lib/applet/render.tsx:270` 的公开 `UiTree({node,fire})` 按 `node.t` 分支渲染真实宿主 React 控件，各组件从 `unknown` 属性主动取值、限范围。新增 `LineChart` 需注册目录和 switch 分支；runner 无需增加专用消息。
6. `create_applet` 的 tool schema 只解析源码与应用安装元数据（`tools.ts:1253–1292`），运行时图表输入来自 `view()`，不能在 create tool 的源码字符串入口校验每次图表数据。

### Bars 的实际兼容合同

公开目录：`catalog.ts:32`，`ui.Bars({values:number[], labels?:string[], highlight?:index, height:40-240})`。

实际渲染在 `render.tsx:224–239`：

- values 不是数组则为空；只取前60项，每项经 `num(v,0,0)`，非有限数字回落0，负数夹为0，上限沿用 num 默认1e9。
- labels 是数组则逐个 `str()`；字符串及数字可显示，其余变为空字符串。labels 不决定柱数。
- peak 至少为1；柱高最小3%，零也有细柱。
- highlight 仅精确等于索引时用强调色；height 默认96，夹在40–240。
- 根为 `role="img" aria-label="柱状图"`，每柱使用 `title="标签：值"`；现有 Bars 没有触摸/键盘明细面板。
- `src/life.css:749–784` 使用 `.ap-bars/.ap-bar`、`--text3`、`--main`，非高亮柱带透明度，间距8px。

新增折线图应保持此分支及原CSS行为。不要借本任务把 Bars 的负数/空值/截断语义改为新折线图规则；可以补兼容回归，但新增可访问性要求至少落实在新增图表。

### 不重启应用的既有能力

`src/widgets/applet.tsx:72` 的 srcdoc memo 只依赖源码与手动重运行计数，width、dark、settings不在依赖中。第123–131行分别发送 dark/context/viewport 消息；实际可见容器由 `useContainerWidth()`（`render.tsx:50`）测量，使用内容宽度与 ResizeObserver，不看隐藏 iframe。

`runner.ts:130–162`：init只执行一次；dark和viewport消息仅schedule重绘；settings实际值变化才排队运行onSettingsChange。`ctx.viewport` 冻结为 `{width,compact:width<480}`，`ctx.dark`是getter；`view()`不应启动请求/定时器。

因此图表只需要根据自己的实测宽度调整轴刻度、标签和明细布局，使用宿主主题CSS变量；不要把宽度/主题放进iframe key、srcdoc或业务init路径。一个应用中嵌套Grid后的图表宽度可能小于ctx.viewport，图表应测自身容器。

### 最小推荐接口与模块边界（建议，尚未冻结）

建议一个 `ui.LineChart`，用有序类别轴支持记账/习惯/监控的等距趋势，暂不引入时间解析、双轴、可执行formatter或用户任意CSS。

可讨论的最小形状：

```js
ui.LineChart({
  title: '每日支出',
  labels: ['周一', '周二', '周三'],
  series: [{name: '支出', values: [80, null, 45], tone: 'accent'}],
  unit: '元',
  height: 220,
})
```

- labels统一横轴，series对应相同位置，支持1–3条曲线即覆盖必要图例需求；顺序由调用方提供，不擅自排序日期。
- 只接受有限数字或显式null，null表示缺测、折线断开；不能沿用Bars把缺失或错误数据伪造为0。负数可用于净收入等趋势。
- 标题/系列名/标签/unit都是纯文本，不允许HTML、任意CSS颜色、函数formatter。tone映射现有语义色，图例还用名称/线型区分，避免只靠颜色。
- 空数组/全缺测给Empty；格式错误提供清楚的局部错误；长度不匹配明确报告或明确补null，不能静默错位。局部错误不应把整个Applet变成“重新运行”页面。
- 对单点、常数、正负混合数据明确y域处理，防止零跨度/除零；有缺测时摘要不越过缺测伪造变化。
- 本任务可采用有明确错误信息的硬上限，如最多3系列、每系列200点；上限属于待设计决定，不是现有事实。超过上限提醒作者按日/周聚合，不暗中删掉最新数据。若选择截断或抽样，必须在图和摘要披露，且摘要与表格采用同一规范化数据。

推荐 `src/lib/applet/chartData.ts` 集中纯输入解析/上限/摘要语义，返回可判别的valid/empty/error结果；`LineChart.tsx`承接绘图与可访问明细。`UiTree`只做t分派。这会让协议测试覆盖用户可见结果而非第三方库内部结构。

容器测量可以保留 `render.tsx` 中的薄wrapper调用既有 `useContainerWidth`，将width传给ChartView；也可把共享hook抽到独立文件后由Grid和图表复用。避免新图表反向import render导致循环依赖。不要为单个图表扩出通用widget注册体系。

数据预算放宿主规范化边界，目录公布相同限制。runner目前的4000节点限制（第68行）不计props中的数组项，不能靠它保证图表点数上限；不能只在AI说明里写限制而让渲染器无界遍历。若需处理巨型payload传输预算是另一层问题，本任务至少在图表映射、绘图与表格构造前拒绝过量数据。

### 触摸、键盘与主题接入

- 图本身需要可读标题和摘要，关键值应能通过真实HTML控件/原生details+table读取；只给SVG路径title或hover tooltip不满足触屏/键盘要求。
- 窄容器少刻度、长标签截短显示，但明细保留完整标签；图例换行而非强制一排。表格可以局部横滚，外层不能横溢。
- 图表库若支持CSS变量，直接映射 `--text/--text2/--text3/--border/--main/--c-blue/--c-green`等已定义变量；必须检查变量实际存在，不能另加硬编码两套palette。
- 状态栏限高32px，完整图表不适合；AI示例在 `ctx.surface==='status'` 分支返回最后值/简短趋势，常规surface才返回图表。
- 尽量关闭非必要绘图动画，或尊重prefers-reduced-motion，resize只影响UI不重复请求。

### 可复用的公开测试边界

| 路径 | 现有价值 | 图表任务建议 |
| --- | --- | --- |
| `scripts/test-applet-runtime.mjs:1` | 实际buildRunnerDoc+VM，断言init/persist/viewport/settings语义 | 通过ui.LineChart生成真实view树，证明目录→runner接通；不只快照目录字符串 |
| `scripts/test-application-tools.mjs:161` | 工具和runner公开路径已有回归 | 复用create_applet/list_applications验证趋势示例安装与源码/设置保留，无需新tool |
| `tests/application-layout-regressions.tsx:12` | 无workspace/storage导入的内存fixture，真实UiTree+真实sandbox iframe | 可参考创建独立chart fixture，覆盖真实props→显示、键盘/触摸与容器变化 |
| `tests/application-layout-regressions.tsx:114` | iframe resize后persist与init次数保持 | 趋势示例复用此模式，增加fetch计数，断言resize/theme不重复请求 |
| `src/lib/applet/render.tsx:270` | UiTree公开入口 | 浏览器测试不要只挂第三方LineChart；从UiTree的t/p/c进入 |

推荐行为样例：空、全null、单点、常数、负数、断点、非法类型、标签/系列长度差、过量点；摘要用固定数据断言实际值。浏览器用320/375/768/桌面及桌面窄容器、双主题、减少动画，键盘打开明细/逐项读取、触摸取值、无横溢。Bars至少保留60项上限与旧height/highlight结果。

完整趋势小工具示例应在catalog技能中可发现，使用本地样例或用户输入，不需要新远端数据源。可配置显示周期/单位用settings，业务点数组用persist；图表自己不取数。

## Files Found

- `src/lib/applet/catalog.ts`：组件目录、COMPONENT_NAMES和模型技能正文。
- `src/lib/applet/runner.ts`：沙盒构造函数、树序列化与生命周期消息。
- `src/lib/applet/render.tsx`：UiTree与Bars/Grid/Table宿主实现，容器宽度hook。
- `src/widgets/applet.tsx`：隐藏iframe、消息桥、业务存储与真正宿主挂载。
- `src/lib/tools.ts`：create/update_applet和list_applications公开工具入口。
- `src/lib/skills.ts`：appletGuide挂接到应用内技能。
- `src/life.css`：Applet积木和Bars/Table主题样式。
- `tests/application-layout-regressions.{html,tsx}`：已有内存隔离渲染与运行时浏览器入口。
- `scripts/test-applet-runtime.mjs`：实际runner VM测试，已有3项生命周期回归。
- `scripts/test-application-tools.mjs`：AI应用工具与运行时测试。

## External References

本研究未访问外部库资料，也未选择或安装依赖；图表绘制实现由主会话另行核对官方资料。以上行号以2026-10-27研究时工作区为准。

## Related Specs

- `.trellis/spec/ai/tools-and-apps.md`：目录、渲染、可验证属性必须同时接通；不以安装npm包代替能力。
- `.trellis/spec/frontend/type-safety.md`：unknown边界先校验，非法数据明确失败或既有回落。
- `.trellis/spec/frontend/hook-guidelines.md`：resize更新布局不重启init，view纯渲染。
- `.trellis/spec/frontend/component-guidelines.md`：主题语义变量、真实容器、控件名称和状态。
- `docs/design-system.md:170–210`：Applet优先、五种surface、设置与业务数据分离。

## Caveats / Not Found

- 没有独立的applet-runtime spec文件，合同分布于AI tools-and-apps、frontend hooks与design-system，勿引用不存在路径。
- 现有catalog只是描述，不是属性schema；runner只限制树节点而非属性数组大小。
- 现有Bars不足以作为新增图表的可访问实现范本，它只有title hover；保留行为不意味着已经满足新图表验收。
- 本次只读研究未执行自动测试或浏览器验证，所列是已有代码能力与建议测试入口。
- 建议接口/上限尚未由本研究冻结，不应当作已实现合同写入运行时文档。
