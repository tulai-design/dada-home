import type {ComponentType as ReactComponentType} from 'react'
import type {Article} from './types'
import type {ComponentInstance, ComponentSpan, ComponentType} from './workspace'

/**
 * 组件协议。
 *
 * 一个组件要接入页面、被 AI 发现和编辑，必须提供这份定义。
 * 协议分两半：
 *   - 给 AI 看的：type / name / description / configSchema / defaultConfig
 *   - 给渲染器用的：component / settings / defaultSpan
 *
 * AI 只读前一半就能知道「有哪些组件、各自能配什么」，不需要读源码。
 */

/** 配置项的字段类型。刻意收窄：能被表单渲染，也能被 AI 理解。 */
export type ConfigField =
  | {kind: 'string'; label: string; description?: string; placeholder?: string}
  | {kind: 'number'; label: string; description?: string; min?: number; max?: number}
  | {kind: 'boolean'; label: string; description?: string}
  | {kind: 'select'; label: string; description?: string; options: {value: string; label: string}[]}

export type ConfigSchema = Record<string, ConfigField>

/** 渲染器传给组件的 props：自己的实例，加上应用级能力。 */
export type ComponentProps<Config = Record<string, unknown>> = {
  instance: ComponentInstance
  config: Config
  /** 当前组件改自己的配置，写回工作空间。 */
  updateConfig: (patch: Partial<Config>) => void
  /** 应用级数据与动作，由 Host 提供。 */
  host: ComponentHost
}

/**
 * 组件能触及的应用能力。
 *
 * 注意这里只放「跨组件共享」的数据（订阅、天气、热榜）和动作（开阅读器、跳页）。
 * 组件自己的数据（待办、便签、书签）走 useComponentData，存在各自的命名空间里，
 * 这样导出时每个组件的数据是独立的、可被识别的。
 */
export type ComponentHost = {
  openPage: (pageId: string) => void
  openSettings: () => void
  openMonitor: () => void
  openAssistant: () => void
  /** 打开阅读器看一篇文章。 */
  openArticle: (article: Article) => void
  /** 已读文章的 id 列表（全局共享，用来标灰和算未读数）。 */
  readIds: string[]
  /** 标记一篇为已读。 */
  markRead: (id: string) => void
  /** 取数代理模板，形如 /__proxy?url={url}。 */
  proxy: string
  /** 热榜源站地址。 */
  hotSource: string
  /** 发起一次 AI 对话，结果进助手面板。 */
  ask: (text: string) => void
  /** AI 是否已配置（填了接口地址和模型）。 */
  aiConfigured: boolean
  /** 当前 AI 模型名，用于界面提示。 */
  aiModel: string
  /** AI 正在思考。 */
  aiBusy: boolean
  /** 搜索结果打开方式：直接开网址还是走搜索引擎。 */
  search: (query: string, engine: string) => void
  /** 全局设置里组件需要读的部分。 */
  profile: {name: string; city: string; lat: number; lon: number; showSeconds: boolean; showFavicons: boolean}
}

export type ComponentDefinition<Config = Record<string, unknown>> = {
  type: ComponentType
  /** 给人看的名称 */
  name: string
  /** 给 AI 看的用途描述：它决定 AI 会不会在合适的时候选中这个组件。 */
  description: string
  /** 分类，用于「添加组件」面板分组。 */
  category: 'info' | 'tool' | 'content' | 'system'
  defaultConfig: Config
  /** 配置字段说明。既驱动设置表单，也告诉 AI 能改什么。 */
  configSchema: ConfigSchema
  defaultSpan: ComponentSpan
  /** 渲染入口 */
  component: ReactComponentType<ComponentProps<Config>>
  /**
   * 是否允许同一工作空间放多个实例。
   * 例如便签、待办的数据按实例隔离；而 monitor 依赖全局监控配置，只允许一个。
   */
  multiple: boolean
}

const registry = new Map<ComponentType, ComponentDefinition<never>>()

export function registerComponent<Config>(definition: ComponentDefinition<Config>) {
  registry.set(definition.type, definition as unknown as ComponentDefinition<never>)
}

export function getDefinition(type: ComponentType): ComponentDefinition | undefined {
  return registry.get(type) as unknown as ComponentDefinition | undefined
}

export function listDefinitions(): ComponentDefinition[] {
  return [...registry.values()] as unknown as ComponentDefinition[]
}

/**
 * 校验并规整一份配置：丢弃 schema 里没有的键，类型不对的字段回落到默认值。
 * AI 给的配置不可信，进入工作空间前必须经过这里。
 */
export function normalizeConfig(definition: ComponentDefinition, raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {...definition.defaultConfig}
  for (const [key, field] of Object.entries(definition.configSchema)) {
    if (!(key in source)) continue
    const value = source[key]
    switch (field.kind) {
      case 'string':
        if (typeof value === 'string') result[key] = value
        break
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) {
          const min = field.min ?? -Infinity
          const max = field.max ?? Infinity
          result[key] = Math.min(max, Math.max(min, value))
        }
        break
      case 'boolean':
        if (typeof value === 'boolean') result[key] = value
        break
      case 'select':
        if (typeof value === 'string' && field.options.some((option) => option.value === value)) result[key] = value
        break
    }
  }
  return result
}
