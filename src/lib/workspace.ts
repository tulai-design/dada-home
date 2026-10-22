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
export const WORKSPACE_VERSION = 2

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
  | 'quote'
  | 'monitor'

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

/** 一个页面：组件实例的有序集合。 */
export type Page = {
  id: string
  name: string
  /** 左侧导航里显示的短标签。 */
  label: string
  components: ComponentInstance[]
  /** 不填等同于 {mode:'off'}。 */
  wallpaper?: Wallpaper
  /** 页面级自定义 CSS，作用在内容容器上 */
  css?: string
  /** 页面内容的对齐方式 */
  align?: 'start' | 'center'
}

/** 主题：只存差异，未列出的键沿用主题预设。 */
export type ThemeConfig = {
  /** 预设主题 id */
  preset: string
  /** CSS 变量覆盖，键名不含 `--` 前缀，例如 {main: '#f5223f'} */
  overrides: Record<string, string>
  /** 亮色还是暗色基底 */
  mode: 'light' | 'dark'
}

/** 工作空间：用户全部可导出内容的根。 */
export type Workspace = {
  version: number
  pages: Page[]
  theme: ThemeConfig
  layout: LayoutConfig
  /** AI 创建的自定义组件，按 id 索引 */
  widgets: CustomWidget[]
  /** 已授权可访问的域名 */
  network: NetworkGrant[]
}

export type LayoutConfig = {
  /** 默认列数，组件按 span 折算占几列 */
  columns: number
  /** 内容区最大宽度 */
  maxWidth: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  columns: 12,
  maxWidth: 1120,
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
