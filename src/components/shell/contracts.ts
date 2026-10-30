import type {ComponentType} from 'react'
import type {DockStyle} from '../../lib/dock'
import type {ThemeSkin} from '../../lib/workspace'
import type {NavigationActivation, NavigationEntry, ShellIntent} from '../../lib/shell/navigation'

export type ShellModel = {
  entries: readonly NavigationEntry[]
  activation: NavigationActivation
  mode: 'light' | 'dark'
  profile: {name: string; avatarSeed: string}
  assistant: {open: boolean; busy: boolean}
  dock?: DockStyle
  badges?: Record<string, number>
}
export type ShellPresentation = {
  content: 'visible' | 'launcher' | 'minimized' | 'closed'
  maximized: boolean
  reserves: {top: number; right: number; bottom: number; left: number}
  backdrop: 'page' | 'shell'
}
export type ShellCapabilities = {
  settings: {header: 'sidebar' | 'wide'; avatar: boolean}
  navigation: 'dock' | 'launcher' | 'taskbar'
}
export type ShellFault = {requestedShell: string; reason: string}
export type ShellSnapshot = ShellPresentation & {
  activeShell: string
  activeSkin: ThemeSkin
  capabilities: ShellCapabilities
  fault: ShellFault | null
}
export type ShellAdapterProps = {
  model: ShellModel
  dispatch: (intent: ShellIntent) => void
  publish: (presentation: ShellPresentation) => void
  reportError: (error: unknown) => void
}
export type ShellAdapter = {id: string; capabilities: ShellCapabilities; Chrome: ComponentType<ShellAdapterProps>}
export const STANDARD_CAPABILITIES: ShellCapabilities = {settings: {header: 'sidebar', avatar: false}, navigation: 'dock'}
export const VISIBLE_PRESENTATION: ShellPresentation = {content: 'visible', maximized: false, reserves: {top: 0, right: 0, bottom: 0, left: 0}, backdrop: 'page'}
