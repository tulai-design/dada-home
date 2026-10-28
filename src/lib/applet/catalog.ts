import {POINT_LIMIT, SERIES_LIMIT} from './lineChartData'
import {TREND_APPLET_EXAMPLE} from './chartExample'
import {ROW_LIMIT, COLUMN_LIMIT} from './dataTableData'
import {RECORD_APPLET_EXAMPLE} from './dataTableExample'

/**
 * 小程序（applet）的组件目录。
 *
 * 这是「AI 能用哪些积木」的唯一事实来源：
 *   - 沙盒里的 ui.Xxx() 构造函数由这里的名字生成；
 *   - 渲染器按名字找到对应的 Lobe 组件；
 *   - 给 AI 的说明（工具描述、技能全文）也由它拼出来，所以文档不会和实现脱节。
 */

export type CatalogEntry = {
  name: string
  /** 一行属性说明，直接给 AI 看。children 写在最后。 */
  props: string
}

export const CATALOG: CatalogEntry[] = [
  // 布局
  {name: 'Stack', props: '{direction:"row"|"column"(默认), gap:0-48, align:"start"|"center"|"end"|"stretch", justify:"start"|"center"|"end"|"between", wrap:true(row默认)|false, grow, padding, width, height}, ...children  —— 最大宽度不超过容器，横排默认换行；wrap:false 用于必须同行的内容'},
  {name: 'Card', props: '{title?, variant:"outlined"(默认)|"filled"|"borderless", padding:0-32, onClick?}, ...children  —— 一块带边线的区域；有 onClick 时可点'},
  {name: 'Grid', props: '{columns:1-6, gap:0-32, minColumnWidth:80-600(默认180), responsive:true(默认)|false}, ...children  —— 等宽网格，测量自身容器并自动减少列数；计算器键盘等固定网格才用 responsive:false'},
  {name: 'Divider', props: '{}  —— 一条发丝线'},
  {name: 'Spacer', props: '{}  —— 在 row 里把后面的内容推到右边'},

  // 文字与展示
  {name: 'Text', props: '{text?, size:"xs"|"sm"|"md"(默认)|"lg"|"xl"|"display", tone:"default"|"secondary"|"tertiary"|"accent"|"danger"|"success", serif, mono, strong, align:"left"|"center"|"right", ellipsis}, 或直接把字符串当 children  —— display 是 64px 衬线大数字，一个小程序最多用一次'},
  {name: 'Kicker', props: '{text}  —— 必要的辅助短标签；不在标题上方重复加文案'},
  {name: 'Tag', props: '{text, tone:"default"|"red"|"green"|"blue"|"orange"|"purple", icon?}'},
  {name: 'Statistic', props: '{title, value, suffix?}  —— 带标题的数字'},
  {name: 'Progress', props: '{percent:0-100, tone:"default"|"accent"|"success"|"danger"}'},
  {name: 'Empty', props: '{title, description?}  —— 空状态，列表为空时用'},
  {name: 'Icon', props: '{name, size:12-48, tone}  —— name 见「图标」'},
  {name: 'Bars', props: '{values:number[], labels?:string[], highlight?:index, height:40-240}  —— 简单柱状图'},
  {name: 'LineChart', props: `{title?:string, labels:string[], series:{name:string,values:(number|null)[],tone?:"accent"|"blue"|"green"|"orange"}[], unit?:string, height:160-360(默认220)} —— 趋势折线图；最多${POINT_LIMIT}点/${SERIES_LIMIT}系列，values与labels等长。零和负数保留，null缺失断线；非法/超量明确报错，不截断。窄容器减刻度，图例与明细保留准确数据；标题/名称/标签最多80字符，unit最多16，数值绝对值≤1e12`},
  {name: 'Table', props: '{columns:string[], rows:(string|number)[][]}  —— 简单表格'},
  {name: 'DataTable', props: `{title?, columns:{key,label,type?:"text"|"number",priority?:1|2|3}[], rows:{id:string,values:Record<string,string|number|boolean|null>}[], state:{query?,sort?:{key,direction:"asc"|"desc"}|null,page?,pageSize?:5|10|20|50,selectedIds?:string[]}, onChange(patch), selectable?:boolean} —— 可搜索、排序、分页和查看详情的受控数据表；最多${ROW_LIMIT}行/${COLUMN_LIMIT}列，稳定唯一id；onChange以Object.assign(s.table,patch)合并，不替换整个state。窄容器优先关键列，详情保留全部字段`},

  // 输入与操作
  {name: 'Button', props: '{label, icon?, variant:"default"|"primary"|"text"|"dashed", size:"small"|"middle"|"large", danger, disabled, block, onClick}  —— 一个小程序里最多一个 primary'},
  {name: 'IconButton', props: '{icon, label(无障碍名称，必填), size:"small"|"middle"|"large", active, disabled, onClick}'},
  {name: 'Input', props: '{value, placeholder?, type:"text"|"password", maxLength?, onChange(text), onEnter?}'},
  {name: 'TextArea', props: '{value, placeholder?, rows:2-12, maxLength?, onChange(text)}'},
  {name: 'NumberInput', props: '{value, min?, max?, step?, onChange(number)}'},
  {name: 'Switch', props: '{checked, label?, onChange(boolean)}'},
  {name: 'Checkbox', props: '{checked, label, onChange(boolean)}'},
  {name: 'Slider', props: '{value, min:0, max:100, step:1, onChange(number)}'},
  {name: 'Select', props: '{value, options:(string|{label,value})[], placeholder?, onChange(value)}'},
  {name: 'Segmented', props: '{value, options:(string|{label,value})[], block, onChange(value)}  —— 2~5 个互斥选项'},
  {name: 'DatePicker', props: '{value:"YYYY-MM-DD"|"", placeholder?, onChange(text)}'},
  {name: 'TimePicker', props: '{value:"HH:mm"|"", placeholder?, onChange(text)}'},
]

export const COMPONENT_NAMES = CATALOG.map((entry) => entry.name)

/** 可用的图标名（Phosphor）。刻意收窄，保证打包体积和风格统一。 */
export const ICON_NAMES = [
  'plus', 'minus', 'x', 'check', 'trash', 'edit', 'copy', 'refresh', 'search', 'settings', 'star', 'heart', 'bookmark', 'flag',
  'play', 'pause', 'stop', 'skip-forward', 'skip-back', 'shuffle', 'repeat', 'volume', 'music', 'timer', 'clock', 'calendar', 'bell',
  'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
  'link', 'download', 'upload', 'eye', 'eye-off', 'lock', 'unlock', 'key', 'shield', 'user', 'home', 'mail', 'message', 'info',
  'alert', 'help', 'sun', 'moon', 'cloud', 'zap', 'flame', 'sparkles', 'wand', 'dice', 'hash', 'type', 'list', 'grid', 'filter',
  'wallet', 'coins', 'chart', 'trending-up', 'trending-down', 'target', 'trophy', 'book', 'code', 'terminal', 'globe', 'map-pin', 'image',
] as const

export type IconName = (typeof ICON_NAMES)[number]

/** 沙盒里的运行说明，拼进工具描述和技能。 */
export function appletGuide(): string {
  const components = CATALOG.map((entry) => `  ui.${entry.name}(${entry.props})`).join('\n')
  const applicationExample = JSON.stringify({
    title: '轻计数',
    description: '记录次数',
    group: '效率',
    openMode: 'drawer',
    dock: false,
    status: true,
    statusMode: 'compact',
    settingsSchema: {
      label: {kind: 'string', label: '操作名称', default: '计数'},
      step: {kind: 'number', label: '每次增加', default: 1, min: 1, max: 1000},
      showCount: {kind: 'boolean', label: '显示计数', default: true},
      format: {kind: 'select', label: '数字格式', default: 'decimal', options: [{value: 'decimal', label: '十进制'}, {value: 'hex', label: '十六进制'}]},
    },
    settings: {label: '记录', step: 2, showCount: true, format: 'decimal'},
    source: [
      'applet({',
      '  state: {count: 0},',
      "  persist: ['count'],",
      '  view: (s, ctx) => {',
      "    const value = ctx.settings.format === 'hex' ? s.count.toString(16) : String(s.count)",
      "    if (ctx.surface === 'status') return ui.Text({text: ctx.settings.showCount ? value : '—', size: 'sm', mono: true})",
      '    return ui.Stack({gap: 12}, [',
      "      ctx.settings.showCount && ui.Text({text: value, size: ctx.viewport.compact ? 'xl' : 'display', serif: true}),",
      "      ui.Button({label: ctx.settings.label + ' +' + ctx.settings.step, variant: 'primary', onClick: () => {s.count += ctx.settings.step}}),",
      '    ])',
      '  },',
      '})',
    ].join('\n'),
  }, null, 2)
  return `# 小程序（applet）

用系统自带的控件（Lobe UI）搭一个有交互的小工具：计算器、密码生成、记账、待办、单位换算、抽签、倒计时、问卷、简易看板……
逻辑是你写的任意 JavaScript，界面是下面这套积木拼出来的，所以：
  · 控件沿用主页风格与深浅色，不用写 CSS；
  · 点击、输入、拖动由主页控件处理；
  · 逻辑跑在隔离沙盒里，读不到主页数据，网络要用户授权。
做游戏、Canvas/WebGL/Three.js、需要完全自定义视觉的东西，才用 create_app。

## 写法

只写一个脚本（ES module），调用一次 applet({...})：

\`\`\`js
const {Stack, Text, Button, Input, Spacer, IconButton} = ui   // 先解构要用的积木

const s = {name: '', items: []}                              // 状态：一个普通对象，必须能 JSON 化
const add = () => {
  if (!s.name.trim()) return
  s.items.push(s.name.trim())
  s.name = ''
}

applet({
  state: s,
  persist: ['items'],                                        // 这些键自动存下来，刷新还在
  view: () =>                                                // 每次状态变化都会重新调用，返回界面
    Stack({gap: 12}, [
      Input({value: s.name, placeholder: '写点什么', onChange: (v) => { s.name = v }, onEnter: add}),
      Button({label: '添加', variant: 'primary', onClick: add}),
      ...s.items.map((item, i) =>
        Stack({direction: 'row', align: 'center'}, [
          Text({text: item}),
          Spacer(),
          IconButton({icon: 'trash', label: '删除', onClick: () => s.items.splice(i, 1)}),
        ]),
      ),
    ]),
})
\`\`\`

规则：
- 直接修改 state 对象就行，事件处理函数结束后界面会自动刷新；异步函数在每个 await 之后也会刷新。
- persist 字段统一存入本应用独立的 IndexedDB 记录，整个 JSON 对象最多 8 MiB（UTF-8 字节）。只能保存 JSON 值；不要存函数、undefined、NaN、循环引用或巨型二进制。读取成功后才启动 init，真实保存由宿主事务回执确认；保存错误由宿主显示并提供重试，不要在事件结束时自行提示“已保存”。
- 事件属性（onClick / onChange / onEnter）直接给函数。onChange 的参数是新值。
- children 可以是数组，false / null / undefined 会被忽略，所以能写 \`cond && Tag({text:'新'})\`；字符串自动变成 Text。
- 列表项很多时，别一次渲染几百条；上限约 4000 个节点。
- view 里不要做副作用（请求、定时器）；放进 init、事件或 onSettingsChange 里。
- ctx 提供的能力：
    ctx.fetch(url) → Promise<{ok,status,text,json}>，域名必须先被用户授权，未授权会弹出授权请求
    ctx.copy(text) 复制到剪贴板；ctx.open(url) 新标签打开 https 链接；ctx.toast(text, "success"|"error"|"info") 弹提示；ctx.ask(text) 把一句话发给搭搭助手
    ctx.every(ms, fn) 定时执行（返回取消函数）；ctx.after(ms, fn) 延时执行；ctx.render() 在长异步过程中手动刷新；ctx.dark 是否深色
    ctx.settings 只读用户设置；ctx.surface 当前展示形态：widget / modal / drawer / page / status。设置变化会更新上下文并重新渲染，persist 状态保持。
    ctx.viewport = {width, compact}：实际容器宽度；compact 表示宽度小于 480px，不是 ctx.surface === "status" 的别名。布局变化会重渲染，不应重启业务逻辑。
- view(s, ctx) 的参数就是 state 和 ctx，也可以不用参数、直接用外面的 s。
- 可选的 init(s, ctx)：启动时执行一次，可以是 async，用来拉取初始数据、启动定时器。
- 可选的 onSettingsChange(s, ctx, previous)：init 完成后，仅在设置值实际改变时调用；previous 是改变前的只读设置。init 不会因设置更新而重跑。在此重新设置依赖设置的定时器、请求地址或订阅，先取消旧任务；view 直接读取 ctx.settings 即可。不要将用户设置复制进 persist 后永久使用旧值。
- 应用默认安装进组件市场，用户可从市场打开、设置、分组和卸载；创建时不必给 pageId。只有用户要页面小组件时才给 pageId，不自动建页面或固定 Dock。
- create_applet 的 openMode 选择 modal 弹窗、drawer 抽屉、page 全页面；dock/status 按需开启。顶部默认 statusMode:"launcher" 为启动入口；只有 view 明确按 ctx.surface === "status" 返回单行窄内容时，才开启 statusMode:"compact" 运行真实紧凑视图。避免标题和大按钮，只留数字/图标/一项核心状态。Applet 限高 32px，桌面最大宽 200px、手机 140px；HTML App 对应宽 160px/130px、高 32px。
- 主窗口或可见页面小组件运行时，状态栏自动回退入口；切换形态可能重新挂载，只保留 persist 声明的状态。关闭主窗口后，如果紧凑状态栏仍挂载则运行该形态；所有运行形态卸载后，请求、定时器不会后台常驻。倒计时保存截止时间，重新打开按当前时间推算；不要承诺后台轮询或准点通知。
- 可配置的值通过 settingsSchema 声明，系统在设置页自动生成表单，settings 提供当前值；字段支持 string/number/boolean/select，select 提供 options。业务数据用 persist，设置只从 ctx.settings 读。用 open_settings section:"application:<id>" 打开该应用设置。
- 沙盒里没有 DOM 可操作，也没有 localStorage（用 persist）。可以 import "https://esm.sh/包名" 来用库（dayjs、mathjs 等）做计算。

## 完整的创建参数示例

以下是一次 create_applet 的完整参数：假设用户明确要求把计数显示在状态栏，源码提供 status 分支后启用 compact。普通安装可用 status:false、statusMode:"launcher"，不传 pageId。设置的四种字段都在业务逻辑中读取。

\`\`\`json
${applicationExample}
\`\`\`

依赖设置的副作用另用生命周期管理。例如轮询间隔变化时，取消旧定时器再创建新定时器：

\`\`\`js
let cancel
function restart(s, ctx) {
  if (cancel) cancel()
  cancel = ctx.every(ctx.settings.refreshSeconds * 1000, () => { s.ticks += 1 })
}
applet({
  state: {ticks: 0},
  init: restart,
  onSettingsChange: (s, ctx, previous) => {
    if (previous.refreshSeconds !== ctx.settings.refreshSeconds) restart(s, ctx)
  },
  view: (s) => ui.Text({text: String(s.ticks)}),
})
\`\`\`

此例需声明 refreshSeconds 为有正数默认值和下限的 number 设置。页面尺寸和展示形态变化只改变布局，不在 view 里重建定时器。

## 趋势图示例

趋势图使用 ui.LineChart，不导入宿主React图表库。labels按输入顺序等距排列；先排序，超过${POINT_LIMIT}点先按日/周/月聚合，单图最多${SERIES_LIMIT}系列。数值保留零和负数，缺失用null并断线；不把缺失当0，不静默删点，不混用不同单位。宿主按实际容器减少刻度，提供最新值摘要和可展开的精确数据表；触摸和键盘都可读取明细。

下面示例从空记录开始，业务数据始终保存分钟，显示单位设置会实际换算；观察范围只改变展示，保留全部已存记录，并标明“最近N条”。达到${POINT_LIMIT}条后拒绝新增，用户可删除最近一条。默认安装到市场，不开启状态栏；若用户需要，可启用已实现的compact状态分支。

\`\`\`json
${JSON.stringify(TREND_APPLET_EXAMPLE, null, 2)}
\`\`\`

## 记录管理与受控数据表

少量静态展示用 ui.Table；需要搜索、单列排序、分页、选择及详情时用 ui.DataTable。数据格式为 columns: [{key,label,type?,priority?}] 和 rows: [{id,values:{列key:标量}}]，最多${ROW_LIMIT}行/${COLUMN_LIMIT}列，不静默截断。key以英文字母开头且只含字母、数字、下划线（最多40字符，不用constructor/prototype）；id是每条记录稳定且唯一的字符串（最多80字符），不能用当前排序或分页的下标。

每个声明列必须有values自有字段。text列可用string/number/boolean/null，文本最多500字符；number列只用有限number/null，数值绝对值≤1e12。null显示缺失，0与false保留；不要把业务值格式化成带单位的数字字符串后再要求数值排序。title/列名最多80字符。priority为1/2/3，越小越优先；窄容器只显示关键字段，详情保留全部列。搜索检查所有列，包括隐藏列；数字排序按数值，文本排序按文字，null在升降序都放最后。

state是单独的临时视图对象：{query:'',sort:null,page:0,pageSize:10,selectedIds:[]}。page从0开始，pageSize只能是5/10/20/50；sort为{key,direction:'asc'|'desc'}或null，query最多200字符。onChange必须是顶层函数，接收局部patch，用Object.assign(s.table,patch)合并，不能写成s.table=patch；columns里不能放render/formatter等函数。搜索、排序、页容量变化回到第0页；删除后宿主会显示最后有效页。selectable:true启用选择，选择跨分页/筛选保留ID，当前页全选只改变当前页；删除后的ID会从有效选择剔除。业务增删仍由应用处理，图表/表格本身不取数或保存记录。

业务records和ID计数放persist，搜索/排序/分页/选择通常不persist。刷新恢复记录和应用设置，临时视图回到初始状态。数据表500行限制不等于保存额度：每个 Applet 的业务 JSON 总量上限为 8 MiB（UTF-8 字节），按字段长度控制业务容量；宿主事务提交后才确认保存，失败时可重试。下面的完整创建参数从空记录开始，最多100条，备注200字符，支持添加、按ID删除、设置页容量与紧凑状态栏；不要自动灌入假记录。可直接作为create_applet参数再按用户需求调整：

\`\`\`json
${JSON.stringify(RECORD_APPLET_EXAMPLE, null, 2)}
\`\`\`

## 积木（ui.Xxx(props?, ...children)）
${components}

图标名：${ICON_NAMES.join(' ')}

## 设计要求
- 先定焦点：一个小程序只有一个最大的东西（结果数字、当前任务），其余让位。
- 结果、数字用 Text 的 serif + size:"display" 或 "xl"；必要单位、字段标签用辅助文字，不在标题上方重复加 Kicker。
- 输入在上、结果在下，或左右分栏；不要把所有控件挤成一排。
- 布局以实际容器为准：320–375px 手机、小组件半宽、modal、drawer、page 都不能横向溢出。Grid 默认收列，Stack 横排默认换行；表单在窄容器可按 ctx.viewport.compact 改为 column。固定网格只给键盘等确需保持行列的控件。
- 文案只留任务所需的信息，不加口号、重复标题和入口说明；不用大圆角卡片、层层框线或逐行上边框，以对齐、间距分组。
- 空状态用 Empty，出错用 Text tone:"danger" 并说清怎么办。
- 表单类的主操作用一个 variant:"primary" 的 Button。
- 创建或更新后用 list_applications 核对源码、设置、分组与入口；open_application 可打开应用。当前没有浏览器截图、实际溢出或控件尺寸的视觉反馈工具，不能声称已通过浏览器视觉检查。
`
}
