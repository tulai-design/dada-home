import {useCallback, useRef, useState} from 'react'
import {isInstalled} from './market'
import {getWorkspace} from './workspaceStore'
import {resolveNavigationTarget, type NavigationActivation, type NavigationTarget} from './shell/navigation'
import type {ApplicationOpenMode, Workspace} from './workspace'

export type HostView = 'page' | 'settings' | 'monitor' | 'market' | 'application'
export type HostNavigationState = {
  pageId: string
  view: HostView
  applicationView: {id: string; mode: ApplicationOpenMode} | null
  applicationMinimized: boolean
  applicationReturnView: Exclude<HostView, 'application'>
  section: string
  settingsRequest: number
  activation: NavigationActivation
}

export function initialNavigation(pageId: string): HostNavigationState {
  return {pageId, view: 'page', applicationView: null, applicationMinimized: false, applicationReturnView: 'market', section: 'profile', settingsRequest: 0, activation: {revision: 0, target: {kind: 'page', id: pageId}, title: '我的主页'}}
}

/** 所有入口共用的业务执行器：先验证，失败不产生状态或副作用。 */
export function executeNavigation(state: HostNavigationState, workspace: Workspace, target: NavigationTarget, options: {monitorInstalled: boolean; splitActive: boolean}) {
  const resolved = resolveNavigationTarget(workspace, target, options.monitorInstalled)
  if (!resolved.ok) return resolved
  const next = {...state, activation: {revision: state.activation.revision + 1, target: resolved.target, title: resolved.entry.label}}
  let clearReader = false
  let closeAssistant = false
  if (target.kind === 'application') {
    const application = workspace.applications!.find(item => item.id === target.id)!
    const mode = target.mode ?? (state.applicationMinimized && state.applicationView?.id === application.id ? state.applicationView.mode : application.openMode)
    if (state.view !== 'application') next.applicationReturnView = state.view
    next.applicationView = {id: application.id, mode}
    next.applicationMinimized = false
    next.view = mode === 'page' ? 'application' : next.applicationReturnView
    clearReader = true
    closeAssistant = !options.splitActive
  } else {
    if (!state.applicationMinimized) next.applicationView = null
    if (target.kind === 'page') {
      next.pageId = target.id
      next.view = 'page'
    } else {
      next.view = target.name
      closeAssistant = !options.splitActive
      if (target.name === 'settings') {
        clearReader = true
        if (target.section) {
          next.section = target.section
          next.settingsRequest += 1
        }
      }
    }
  }
  return {ok: true as const, state: next, clearReader, closeAssistant}
}

/** 后台页面引用失效只修引用；当前确实显示该页面时才执行导航回退。 */
export function reconcileNavigationPage(state: HostNavigationState, workspace: Workspace, options: {monitorInstalled: boolean; splitActive: boolean}) {
  if (workspace.pages.some(page => page.id === state.pageId) || !workspace.pages[0]) return state
  const pageId = workspace.pages[0].id
  if (state.view === 'page' && (!state.applicationView || state.applicationMinimized)) {
    const result = executeNavigation(state, workspace, {kind: 'page', id: pageId}, options)
    if (result.ok) return result.state
  }
  return {...state, pageId}
}

/** 同一帧内的连续入口也读取最近已接受状态，不依赖下一次 React 渲染。 */
export function useNavigation(options: {pageId: string; setPageId: (id: string) => void; clearReader: () => void; closeAssistant: () => void; splitActive: boolean}) {
  const [state, setState] = useState(() => initialNavigation(options.pageId))
  const stateRef = useRef(state)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const update = useCallback((next: HostNavigationState) => {stateRef.current = next; setState(next)}, [])
  const navigate = useCallback((target: NavigationTarget) => {
    const workspace = getWorkspace()
    const result = executeNavigation(stateRef.current, workspace, target, {monitorInstalled: isInstalled(workspace, 'monitor'), splitActive: optionsRef.current.splitActive})
    if (!result.ok) return result
    update(result.state)
    if (target.kind === 'page') optionsRef.current.setPageId(result.state.pageId)
    if (result.clearReader) optionsRef.current.clearReader()
    if (result.closeAssistant) optionsRef.current.closeAssistant()
    return {ok: true as const}
  }, [update])
  const minimizeApplication = useCallback(() => update({...stateRef.current, applicationMinimized: true}), [update])
  const restoreApplication = useCallback(() => update({...stateRef.current, applicationMinimized: false}), [update])
  const closeApplication = useCallback(() => {
    const current = stateRef.current
    update({...current, applicationView: null, applicationMinimized: false, view: current.view === 'application' ? current.applicationReturnView : current.view})
  }, [update])
  const setSection = useCallback((section: string) => update({...stateRef.current, section}), [update])
  const reconcilePages = useCallback(() => {
    const workspace = getWorkspace()
    const current = stateRef.current
    const next = reconcileNavigationPage(current, workspace, {monitorInstalled: isInstalled(workspace, 'monitor'), splitActive: optionsRef.current.splitActive})
    if (next === current) return
    update(next)
    optionsRef.current.setPageId(next.pageId)
  }, [update])
  return {...state, navigate, minimizeApplication, restoreApplication, closeApplication, setSection, reconcilePages}
}
