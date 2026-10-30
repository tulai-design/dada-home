import type {ApplicationOpenMode, Workspace} from '../workspace'

export type NavigationTarget =
  | {kind: 'page'; id: string}
  | {kind: 'system'; name: 'settings'; section?: string}
  | {kind: 'system'; name: 'market' | 'monitor'}
  | {kind: 'application'; id: string; mode?: ApplicationOpenMode}

export type NavigationEntry = {
  key: string
  target: NavigationTarget
  label: string
  icon: {kind: 'page'; name?: string} | {kind: 'application'} | {kind: 'system'; name: 'settings' | 'market' | 'monitor'}
  home: boolean
  pinned: boolean
}

export type NavigationActivation = {revision: number; target: NavigationTarget; title: string}
export type ShellIntent =
  | {type: 'navigate'; target: NavigationTarget}
  | {type: 'assistant'; action: 'toggle-preferred' | 'open-panel' | 'stop'}
  | {type: 'command-palette'}
  | {type: 'all-navigation'}
  | {type: 'toggle-color-mode'}
  | {type: 'close-content'}

export function navigationKey(target: NavigationTarget): string {
  return target.kind === 'system' ? `system:${target.name}` : `${target.kind}:${target.id}`
}

/** 一个目录投影，外壳只选择展示位置，不再重新读取业务记录。 */
export function projectNavigation(workspace: Workspace, monitorInstalled: boolean): NavigationEntry[] {
  return [
    ...workspace.pages.map((page) => ({
      key: `page:${page.id}`, target: {kind: 'page' as const, id: page.id},
      label: page.id === 'home' ? '我的主页' : page.label || page.name,
      icon: {kind: 'page' as const, name: page.icon}, home: page.id === 'home', pinned: page.id === 'home' || page.dock !== false,
    })),
    ...(workspace.applications ?? []).map((application) => ({
      key: `application:${application.id}`, target: {kind: 'application' as const, id: application.id},
      label: application.instance.title || '应用', icon: {kind: 'application' as const}, home: false, pinned: application.dock === true,
    })),
    {key: 'system:market', target: {kind: 'system' as const, name: 'market' as const}, label: '组件市场', icon: {kind: 'system' as const, name: 'market' as const}, home: false, pinned: true},
    ...(monitorInstalled ? [{key: 'system:monitor', target: {kind: 'system' as const, name: 'monitor' as const}, label: '服务监控', icon: {kind: 'system' as const, name: 'monitor' as const}, home: false, pinned: true}] : []),
    {key: 'system:settings', target: {kind: 'system' as const, name: 'settings' as const}, label: '设置', icon: {kind: 'system' as const, name: 'settings' as const}, home: false, pinned: true},
  ]
}

export type NavigationResolution = {ok: true; target: NavigationTarget; entry: NavigationEntry} | {ok: false; reason: string}

/** 每次执行时从最新 Workspace 验证；不发布 revision、不执行业务副作用。 */
export function resolveNavigationTarget(workspace: Workspace, target: NavigationTarget, monitorInstalled: boolean): NavigationResolution {
  if (target.kind === 'application' && target.mode !== undefined && !(['modal', 'drawer', 'page'] as const).includes(target.mode)) return {ok: false, reason: '应用打开方式不受支持'}
  const entry = projectNavigation(workspace, monitorInstalled).find((item) => item.key === navigationKey(target))
  if (!entry) return {ok: false, reason: '导航目标不存在或已停用'}
  if (target.kind === 'system' && target.name === 'settings' && target.section !== undefined && !target.section.trim()) return {ok: false, reason: '设置分区不能为空'}
  return {ok: true, target, entry}
}
