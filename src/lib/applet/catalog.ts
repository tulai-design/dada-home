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
  {name: 'Stack', props: '{direction:"row"|"column"(默认), gap:0-48, align:"start"|"center"|"end"|"stretch", justify:"start"|"center"|"end"|"between", wrap, grow, padding, width, height}, ...children  —— 弹性布局，最常用'},
  {name: 'Card', props: '{title?, variant:"outlined"(默认)|"filled"|"borderless", padding:0-32, onClick?}, ...children  —— 一块带边线的区域；有 onClick 时可点'},
  {name: 'Grid', props: '{columns:1-6, gap:0-32}, ...children  —— 等宽网格'},
  {name: 'Divider', props: '{}  —— 一条发丝线'},
  {name: 'Spacer', props: '{}  —— 在 row 里把后面的内容推到右边'},

  // 文字与展示
  {name: 'Text', props: '{text?, size:"xs"|"sm"|"md"(默认)|"lg"|"xl"|"display", tone:"default"|"secondary"|"tertiary"|"accent"|"danger"|"success", serif, mono, strong, align:"left"|"center"|"right", ellipsis}, 或直接把字符串当 children  —— display 是 64px 衬线大数字，一个小程序最多用一次'},
  {name: 'Kicker', props: '{text}  —— 小号大写标签，放在标题上方'},
  {name: 'Tag', props: '{text, tone:"default"|"red"|"green"|"blue"|"orange"|"purple", icon?}'},
  {name: 'Statistic', props: '{title, value, suffix?}  —— 带标题的数字'},
  {name: 'Progress', props: '{percent:0-100, tone:"default"|"accent"|"success"|"danger"}'},
  {name: 'Empty', props: '{title, description?}  —— 空状态，列表为空时用'},
  {name: 'Icon', props: '{name, size:12-48, tone}  —— name 见「图标」'},
  {name: 'Bars', props: '{values:number[], labels?:string[], highlight?:index, height:40-240}  —— 简单柱状图'},
  {name: 'Table', props: '{columns:string[], rows:(string|number)[][]}  —— 简单表格'},

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
  return `# 小程序（applet）

用系统自带的控件（Lobe UI）搭一个有交互的小工具：计算器、密码生成、记账、待办、单位换算、抽签、倒计时、问卷、简易看板……
逻辑是你写的任意 JavaScript，界面是下面这套积木拼出来的，所以：
  · 风格和主页完全一致，深浅色自动适配，不用写 CSS；
  · 点击、输入、拖动都是真控件，不会像 iframe 里那样失灵；
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
- 事件属性（onClick / onChange / onEnter）直接给函数。onChange 的参数是新值。
- children 可以是数组，false / null / undefined 会被忽略，所以能写 \`cond && Tag({text:'新'})\`；字符串自动变成 Text。
- 列表项很多时，别一次渲染几百条；上限约 4000 个节点。
- view 里不要做副作用（请求、定时器）；放进 init 或事件里。
- ctx 提供的能力：
    ctx.fetch(url) → Promise<{ok,status,text,json}>，域名必须先被用户授权，未授权会弹出授权请求
    ctx.copy(text) 复制到剪贴板；ctx.open(url) 新标签打开 https 链接；ctx.toast(text, "success"|"error"|"info") 弹提示；ctx.ask(text) 把一句话发给搭搭助手
    ctx.every(ms, fn) 定时执行（返回取消函数）；ctx.after(ms, fn) 延时执行；ctx.render() 在长异步过程中手动刷新；ctx.dark 是否深色
- view(s, ctx) 的参数就是 state 和 ctx，也可以不用参数、直接用外面的 s。
- 可选的 init(s, ctx)：启动时执行一次，可以是 async，用来拉取初始数据、启动定时器。
- 沙盒里没有 DOM 可操作，也没有 localStorage（用 persist）。可以 import "https://esm.sh/包名" 来用库（dayjs、mathjs 等）做计算。

## 积木（ui.Xxx(props?, ...children)）
${components}

图标名：${ICON_NAMES.join(' ')}

## 设计要求
- 先定焦点：一个小程序只有一个最大的东西（结果数字、当前任务），其余让位。
- 结果、数字用 Text 的 serif + size:"display" 或 "xl"；说明用 secondary；标签用 Kicker。
- 输入在上、结果在下，或左右分栏；不要把所有控件挤成一排。
- 空状态用 Empty，出错用 Text tone:"danger" 并说清怎么办。
- 表单类的主操作用一个 variant:"primary" 的 Button。
`
}
