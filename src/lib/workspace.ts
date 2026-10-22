/**
 * 工作空间数据模型。
 *
 * 整个产品的地基：页面不是写死的 JSX，而是「组件实例」的有序集合。
 * AI 编辑的永远是这份数据，不是代码。改完之后由渲染器重新渲染。
 *
 * 三条约束：
 * 1. 每份数据都能 JSON 序列化，能导出、能导入、能迁移。
 * 2. 组件实例只保存 type + config，不保存函数、DOM 或任何运行时对象。
 * 3. 版本号随结构演进，读取旧数据时按版本迁移。
 */

/** 当前工作空间结构版本。改结构就加一，并在 migrate 里补一条迁移。 */
export const WORKSPACE_VERSION = 1

/** 内置组件类型。新增组件要在 registry 里注册，并在这里加一个值。 */
export type ComponentType =
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

/** 组件在页面中的尺寸档位，由布局渲染器翻译成 CSS grid 跨度。 */
export type ComponentSpan = 'full' | 'half' | 'third' | 'two-thirds'

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
  /** 页面 id → 该页的布局列数 */
  layout: LayoutConfig
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

let counter = 0

/** 生成实例 id。带时间戳前缀，方便阅读导出数据时看懂先后顺序。 */
export function instanceId(type: ComponentType): string {
  counter += 1
  return `${type}-${Date.now().toString(36)}-${counter.toString(36)}`
}
