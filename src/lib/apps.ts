import {createContext, useContext, type ComponentType} from 'react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import type {BookmarkGroup, Feed, Settings} from './types'
import type {ApplicationOpenMode, Workspace} from './workspace'

/**
 * 「应用」：一个组件（或一组组件）自带的设置面板。
 *
 * 设计原则：组件的样式、数据、配置项、给 AI 的能力都属于组件本身，
 * 它的设置也应该由组件自己提供，而不是堆进全局设置里。
 * 组件在自己的文件里 registerApp 一次，设置页的「应用」分组就会自动多出一行。
 * 全局设置因此只剩真正全局的东西：个人、外观、AI、网络、数据。
 */
export type AppSettingsContext = {
  settings: Settings
  patch: (part: Partial<Settings>) => void
  feeds: Feed[]
  setFeeds: (next: Feed[]) => void
  groups: BookmarkGroup[]
  setGroups: (next: BookmarkGroup[]) => void
  /** 工作空间里某类组件的所有实例，用来改它们自己的配置。 */
  instances: (type: string) => {id: string; pageLabel: string; config: Record<string, unknown>}[]
  updateConfig: (instanceId: string, patch: Record<string, unknown>) => void
  /** 工作空间本身（页面、状态条…），以及改它的入口。侧栏、状态条的设置用。 */
  workspace: Workspace
  edit: (fn: (workspace: Workspace) => Workspace) => void
  /** 打开已安装的 AI 应用；不传 mode 时采用应用的默认打开方式。 */
  openApplication?: (id: string, mode?: ApplicationOpenMode) => void
}

export type AppDefinition = {
  id: string
  name: string
  icon: PhosphorIcon
  /** 图标底色，取 iOS 系统色 */
  color: string
  /** 一句话说明，显示在详情页顶部 */
  description: string
  /** 列表右侧的简短现状，例如「3 个源」 */
  summary?: (ctx: AppSettingsContext) => string
  Panel: ComponentType
}

const apps = new Map<string, AppDefinition>()

export function registerApp(definition: AppDefinition) {
  apps.set(definition.id, definition)
}

export function listApps(): AppDefinition[] {
  return [...apps.values()]
}

export const AppSettingsCtx = createContext<AppSettingsContext | null>(null)

/** 在应用的设置面板里取全局设置、共享数据和组件实例。 */
export function useAppSettings(): AppSettingsContext {
  const ctx = useContext(AppSettingsCtx)
  if (!ctx) throw new Error('useAppSettings 只能在设置页里使用')
  return ctx
}
