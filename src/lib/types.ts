export type Bookmark = {
  id: string
  name: string
  url: string
  note?: string
}

export type BookmarkGroup = {
  id: string
  name: string
  items: Bookmark[]
}

export type Feed = {
  id: string
  title: string
  url: string
  enabled?: boolean
}

export type Article = {
  id: string
  title: string
  link: string
  source: string
  date: number
  excerpt: string
  content: string
  /** 正文是否只有链接元信息（HN 常见），阅读器据此提示去原文 */
  linkOnly?: boolean
}

export type Todo = {
  id: string
  text: string
  done: boolean
  createdAt: number
}

export type AiConfig = {
  baseUrl: string
  apiKey: string
  model: string
  /** 以下都是高级项：留空就不发给接口，用模型自己的默认值。 */
  temperature?: number
  topP?: number
  /** 单次回答最多输出多少 token */
  maxTokens?: number
  presencePenalty?: number
  frequencyPenalty?: number
  /** 推理强度，只有推理模型认；不填则不发 */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** 用户自己的长期指令，附在搭搭的系统提示后面 */
  systemPrompt?: string
  /** 带给模型的历史轮数 */
  contextTurns?: number
  /** 一次回答里最多连续调用几轮工具 */
  maxRounds?: number
  /** 额外请求参数，JSON 对象的文本；不会覆盖 model、messages、tools、stream */
  extraBody?: string
}

export type MonitorKind = 'coolify' | 'beszel' | 'http'

export type MonitorConfig = {
  id: string
  name: string
  kind: MonitorKind
  baseUrl: string
  token?: string
  identity?: string
  password?: string
  url?: string
}

export type Settings = {
  name: string
  city: string
  lat: number
  lon: number
  theme: 'dark' | 'light'
  proxy: string
  showFavicons: boolean
  showSeconds: boolean
  wallpaper: 'unsplash' | 'custom' | 'off'
  wallpaperIndex: number
  wallpaperUrl: string
  ai: AiConfig
  monitor: MonitorConfig[]
  /** NewsHub 源站，例如 https://newshub.shenzjd.com */
  hotSource: string
  /** 要展示的榜单 id，对应 /api/v1/sources */
  hotBoards: string[]
}

export type Weather = {
  temp: number
  max: number
  min: number
  code: number
  label: string
  wind: number
  humidity: number
  place: string
}
