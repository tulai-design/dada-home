/**
 * 工作空间数据模型。
 *
 * 整个产品的地基：页面不是写死的 JSX，而是「组件实例」的有序集合。
 * AI 编辑的永远是这份数据，不是代码。改完之后由渲染器重新渲染。
 *
 * 四条约束：
 * 1. 每份数据都能 JSON 序列化，能导出、能导入、能迁移。
 * 2. 组件实例只保存 type + config，不保存函数、DOM 或任何运行时对象。
 * 3. 版本号随结构演进，读取旧数据时按版本迁移。
 * 4. 自定义组件是「声明」，不是代码：AI 写一份规格，渲染器解释它。
 */

/** 当前工作空间结构版本。改结构就加一，并在 migrate 里补一条迁移。 */
import type {DockStyle} from './dock'
import type {ThemeFont} from './fonts'

export const WORKSPACE_VERSION = 6

/** 内置组件类型。新增内置组件要在 registry 里注册，并在这里加一个值。 */
export type BuiltinType =
  | 'clock'
  | 'weather'
  | 'todos'
  | 'note'
  | 'bookmarks'
  | 'feeds'
  | 'hot'
  | 'search'
  | 'links'
  | 'quote'
  | 'monitor'
  | 'calendar'
  | 'agenda'
  | 'countdown'
  | 'pomodoro'
  | 'music'
  /** 特效素材：背景 / 文字 / 卡片 / 3D 场景，来自 src/fx 的素材库 */
  | 'fx'
  /** 沙盒应用：AI 写的 HTML/CSS/JS，跑在隔离 iframe 里 */
  | 'app'
  | 'applet'

/**
 * 组件类型：内置类型，或 `custom:<自定义组件 id>`。
 * 自定义组件由 AI 用声明式规格创建，和内置组件走同一套渲染路径。
 */
export type ComponentType = BuiltinType | `custom:${string}`

export function isCustomType(type: string): type is `custom:${string}` {
  return type.startsWith('custom:')
}

/** 组件在页面中的尺寸档位，由布局渲染器翻译成 CSS grid 跨度。 */
export type ComponentSpan = 'full' | 'half' | 'third' | 'two-thirds'

/** 外观变体。所有组件（含自定义）共用这一套，保证视觉一致。 */
export type Variant = 'plain' | 'card' | 'accent' | 'quiet'

/** 组件实例级的外观覆盖；不填就用主题默认。 */
export type Appearance = {
  variant?: Variant
  /** 主色的语义别名，映射到主题变量 */
  tone?: 'neutral' | 'main' | 'green' | 'blue' | 'amber' | 'violet'
  /** 标题字号档位 */
  titleSize?: 'sm' | 'md' | 'lg'
  /**
   * 自定义 CSS 声明，例如 "border-radius: 18px; background: linear-gradient(...)"。
   * 经 sanitizeCss 校验后作用在这一块的外层容器上。
   */
  css?: string
  /** 预置动画名，取值见 customWidget.ANIMATIONS */
  animation?: string
}

/** 一个组件实例：AI 编辑的最小单位。 */
export type ComponentInstance = {
  id: string
  type: ComponentType
  /** 组件自己的配置，形状由该组件的定义决定。 */
  config: Record<string, unknown>
  /** 布局档位；不填由组件定义给默认值。 */
  span?: ComponentSpan
  /** 用户给这一块起的别名，用于「把天气那块挪到右上」这类指令。 */
  title?: string
  /** 外观覆盖 */
  look?: Appearance
}

/** AI 应用的入口与用户设置属于安装记录，与它是否放在某一页无关。 */
export type ApplicationOpenMode = 'modal' | 'drawer' | 'page'
export type ApplicationSurface = ApplicationOpenMode | 'widget' | 'status'
export type ApplicationStatusMode = 'launcher' | 'compact'
export type ApplicationSettingField = {
  kind: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  default?: string | number | boolean
  min?: number
  max?: number
  options?: {value: string; label: string}[]
}
export type GeneratedApplication = {
  id: string
  /** 与原实例共用 id，打开形式变化不会改变私有数据命名空间。 */
  instance: ComponentInstance
  description: string
  group: string
  openMode: ApplicationOpenMode
  dock: boolean
  status: boolean
  /** 未适配紧凑界面的脚本默认只作为启动入口。 */
  statusMode?: ApplicationStatusMode
  settingsSchema?: Record<string, ApplicationSettingField>
  settings?: Record<string, string | number | boolean>
}
export const MAX_APPLICATIONS = 60

// ───────────────────────── 自定义组件 ─────────────────────────

/**
 * 自定义组件的声明式规格。
 *
 * AI 不写代码，只描述「取什么数据、怎么显示」。渲染器解释这份规格。
 * 这样做的代价是能力有边界，换来的是：可校验、可撤回、可导出、
 * 不会因为 AI 写错一个分号就让整页白屏。
 */

/** 数据来源：静态内联，或一个 GET 接口。 */
export type DataSource =
  | {kind: 'static'; items: Record<string, unknown>[]}
  | {
      kind: 'http'
      url: string
      /** 从响应里取数组的路径，例如 "data.list"；留空则用响应本身 */
      path?: string
      /** 每隔多少毫秒重取；不填只取一次 */
      every?: number
    }

/**
 * 字段映射：把一个数据项渲染成什么。
 * 路径支持点号取值，例如 "author.name"。
 */
export type FieldBind = {
  /** 数据项里的字段路径 */
  path: string
  /** 前缀，例如 "来源：" */
  prefix?: string
}

/** 列表项模板。 */
export type ItemTemplate = {
  /** 主文本 */
  title: FieldBind
  /** 副文本 */
  subtitle?: FieldBind
  /** 右侧角标 */
  meta?: FieldBind
  /** 主文本点开跳转的地址字段 */
  link?: FieldBind
}

/** 自定义组件的布局形态。刻意只留几种，保证出来都好看。 */
export type CustomLayout =
  | 'list'
  | 'cards'
  | 'stats'
  | 'text'
  | 'links'
  /** 直接渲染一段 SVG 图形（AI 画的插图、图表、图标） */
  | 'art'

/** 自定义组件定义（存在工作空间里，跟着用户走）。 */
export type CustomWidget = {
  /** 短 id，作为 type 的后半段 */
  id: string
  name: string
  description: string
  layout: CustomLayout
  item: ItemTemplate
  source: DataSource
  /** 空数据时的提示 */
  emptyText?: string
  /** layout 为 art 时必填：一段 SVG 源码 */
  svg?: string
  /** 组件作者可以给自己加少量配置项，供用户调整 */
  options?: {
    /** 最多显示几条，0 不限 */
    limit?: number
    /** 是否显示序号 */
    numbered?: boolean
  }
}

/**
 * 网络访问授权。
 *
 * AI 不能凭空请求任意地址：新域名必须由用户明确同意后才写入这里。
 * 这是「只允许预先授权域名」的落点。
 */
export type NetworkGrant = {
  host: string
  /** 授权时间，导出时能看出是什么时候加的 */
  grantedAt: number
}

/** 页面背景。壁纸是页面属性，不属于任何组件，任意页面都能设置。 */
export type Wallpaper =
  | {mode: 'off'}
  | {mode: 'unsplash'; index: number}
  | {mode: 'custom'; url: string}

/**
 * 页面特效图层：铺在页面内容之后（background / scene）或之上（overlay）。
 * effect 是素材库 id；params 经 fx 目录校验，未知键会被丢弃。
 */
export type Layer = {
  effect: string
  params: Record<string, unknown>
}

/** 分区只引用现有实例，不拥有另一份组件或应用数据。 */
export type PageSection =
  | {id: string; kind: 'hero'; title?: string; items: string[]; align?: 'start' | 'center'}
  | {id: string; kind: 'section'; title?: string; items: string[]; columns?: 1 | 2 | 3}
  | {id: string; kind: 'split'; title?: string; primary: string[]; secondary: string[]; ratio?: 'equal' | 'wide-primary'}

/** 一个页面：组件实例的有序集合。 */
export type Page = {
  id: string
  name: string
  /** 左侧导航里显示的短标签。 */
  label: string
  components: ComponentInstance[]
  /** 可选语义分区；缺省保持旧扁平栅格，未引用组件仍显示在末尾。 */
  sections?: PageSection[]
  /** 不填等同于 {mode:'off'}。 */
  wallpaper?: Wallpaper
  /** 特效图层，最多 3 层。不填等同于没有。 */
  layers?: Layer[]
  /** 页面级自定义 CSS，作用在内容容器上 */
  css?: string
  /** 页面内容的对齐方式 */
  align?: 'start' | 'center'
  /** 侧栏图标，取值见 pageIcons；不填用通用图标 */
  icon?: string
  /** 不填默认展示；应用自己的旧页面可以保留内容而不占用 Dock。 */
  dock?: boolean
}

/** 首页是固定项：不能删除、不能挪走、始终排第一。 */
export const FROZEN_PAGE_ID = 'home'

/** 默认首页装饰由初始化、外观说明和还原操作共用，避免各自猜一份。 */
export const DEFAULT_HOME_LAYERS: Layer[] = [
  {effect: 'waves', params: {lineColor: '#1b1714', accentColor: '#e5372e', spacing: 14, lineWidth: 0.8, opacity: 0.45, fade: 0.55, amplitude: 34, speed: 0.5}},
]

/**
 * 状态条（顶栏右侧）里的一项：某个组件的「紧凑形态」。
 * 组件在注册时声明 status 渲染才能放进来；config 沿用该组件自己的配置项。
 */
export type StatusItem = {
  id: string
  type: ComponentType
  config: Record<string, unknown>
}

/** 状态条最多放几项，再多就挤不下了。 */
export const MAX_STATUS_ITEMS = 5

/** 页面数量上限。侧栏放不下的会自动收进「全部页面」。 */
export const MAX_PAGES = 30

/** 默认主题的 id。它永远存在，不能改、不能删，是「回到最初」的锚点。 */
export const DEFAULT_THEME_ID = 'default'

/** 主题库最多存多少个。 */
export const MAX_THEMES = 24

/**
 * 一个主题：名字、说明，加上相对默认主题的 CSS 变量差异。
 * 默认主题的 overrides 为空，也就是「什么都不改」。
 */
export type ThemeEntry = {
  id: string
  name: string
  /** 一两句话说明这个主题的气质，列表里显示，也让 AI 和用户记得它是什么 */
  description: string
  /** 两种模式共用的变量，主要放主色、尺寸、字体变量等；键名不含 `--`。 */
  overrides: Record<string, string>
  /** 当前模式的变量覆盖；未配置的值沿用系统对应模式。 */
  light?: Record<string, string>
  dark?: Record<string, string>
  /** 从 Google Fonts 引入的字体；带 role 的会接管对应的字体变量（serif / sans / mono） */
  fonts?: ThemeFont[]
  /** 应用主题时的初始模式偏好；用户仍可切换，重新加载不会覆盖用户选择。 */
  mode?: 'light' | 'dark'
  builtin?: boolean
}

/** 当前使用哪个主题，以及明暗。主题本身存在 Workspace.themes 里。 */
export type ThemeConfig = {
  active: string
  /** 实际生效的明暗；读取已保存工作空间时以此为准。 */
  mode: 'light' | 'dark'
  /** 用户自己选的明暗。切到不指定明暗的主题（比如默认主题）时回到它，这样「还原」才是真的还原。 */
  base: 'light' | 'dark'
}

/** 模板库最多存多少个（内置预设不占名额）。 */
export const MAX_TEMPLATES = 12

/**
 * 模板快照：一套完整的「页面设计」。
 * 页面、组件、状态条、版式、AI 做的自定义组件、装了哪些市场组件——都在里面。
 * 组件里的数据（待办、便签、书签…）不在模板里，它们属于用户，不随布局来回搬。
 */
export type TemplateSnapshot = {
  pages: Page[]
  statusbar: StatusItem[]
  layout: LayoutConfig
  widgets: CustomWidget[]
  addons: string[]
  applications?: GeneratedApplication[]
  /** 带上配色。不填表示套用模板时保持当前主题不变。 */
  theme?: ThemeEntry
  /** Dock 样式。不填就是默认的纸质卡片。 */
  dock?: DockStyle
}

/** 模板库里的一条记录。 */
export type TemplateEntry = {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  snapshot: TemplateSnapshot
}

/** 工作空间：用户全部可导出内容的根。 */
export type Workspace = {
  version: number
  pages: Page[]
  theme: ThemeConfig
  /** 主题库：默认主题加上所有存下来的主题 */
  themes: ThemeEntry[]
  layout: LayoutConfig
  /** AI 创建的自定义组件，按 id 索引 */
  widgets: CustomWidget[]
  /** AI 开发并安装的应用；市场是固定入口，其他挂载按需启用。 */
  applications?: GeneratedApplication[]
  /** 已授权可访问的域名 */
  network: NetworkGrant[]
  /** 状态条：顶栏右侧的实时小组件，默认只有一个时钟 */
  statusbar: StatusItem[]
  /** Dock（侧栏 / 手机底栏）的样式；不填就是默认的纸质卡片 */
  dock?: DockStyle
  /** 已安装的市场组件（见 market.ts）。没装的组件不出现在页面、侧栏和 AI 的可用清单里。 */
  addons: string[]
  /** 模板库：存下来的页面设计，可随时套用。内置预设在代码里，不占这里。 */
  templates: TemplateEntry[]
  /** 最近套用或保存的模板 id，只用来在列表里标出「当前」。 */
  template?: string
}

export type LayoutConfig = {
  /** 默认列数，组件按 span 折算占几列 */
  columns: number
  /** 内容区最大宽度 */
  maxWidth: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  columns: 12,
  maxWidth: 1480,
}

/** span 到栅格列数的映射；渲染器按这个算。 */
export const SPAN_COLUMNS: Record<ComponentSpan, number> = {
  full: 12,
  half: 6,
  third: 4,
  'two-thirds': 8,
}

/** 外观变体对应的 CSS 类后缀，渲染器按这个加 data 属性。 */
export const TONE_VAR: Record<NonNullable<Appearance['tone']>, string> = {
  neutral: 'text2',
  main: 'main',
  green: 'c-green',
  blue: 'c-blue',
  amber: 'c-amber',
  violet: 'c-violet',
}

let counter = 0

/** 生成实例 id。带时间戳前缀，方便阅读导出数据时看懂先后顺序。 */
export function instanceId(type: string): string {
  counter += 1
  return `${type.replace(':', '-')}-${Date.now().toString(36)}-${counter.toString(36)}`
}

export const DEFAULT_THEME: ThemeEntry = {
  id: DEFAULT_THEME_ID,
  name: '纸张',
  description: '米白纸张、墨色文字、红色点缀，搭搭的默认气质。',
  overrides: {},
  builtin: true,
}

/** 预设主题。读入时始终用这份，不采用库里存过的同 id 副本。 */
export const IOS_THEME_ID = 'ios'

export const IOS_THEME: ThemeEntry = {
  id: IOS_THEME_ID,
  name: 'iOS',
  description: '分组灰底、白卡片、系统蓝。圆角，没有外框。',
  overrides: {radius: '12px', 'radius-lg': '16px', frame: '0px', 'frame-gap': '0px'},
  light: {
    bg: '#f2f2f7', bg2: '#ffffff', bg3: '#e5e5ea',
    text: '#1c1c1e', text2: '#3a3a3c', text3: '#8e8e93', text4: '#c7c7cc',
    border: 'rgba(60, 60, 67, 0.12)', rule: '#1c1c1e', main: '#007aff',
  },
  dark: {
    bg: '#000000', bg2: '#1c1c1e', bg3: '#2c2c2e',
    text: '#ffffff', text2: '#aeaeb2', text3: '#8e8e93', text4: '#3a3a3c',
    border: 'rgba(255, 255, 255, 0.12)', rule: '#ffffff', main: '#0a84ff',
  },
  fonts: [{family: 'Noto Sans SC', role: 'serif'}],
  mode: 'light',
  builtin: true,
}

/** 当前启用的主题；id 失效时回落到默认主题。 */
export function activeTheme(workspace: Pick<Workspace, 'themes' | 'theme'>): ThemeEntry {
  return workspace.themes.find((item) => item.id === workspace.theme.active) ?? workspace.themes.find((item) => item.id === DEFAULT_THEME_ID) ?? DEFAULT_THEME
}
