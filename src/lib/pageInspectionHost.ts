import {inspectPageElement, unavailablePageInspection, type PageInspectionReport, type PageInspectionRequest} from './pageInspector'
import type {Workspace} from './workspace'

export type MountedInspectionPage = {root: HTMLElement; pageId: string; workspace: Workspace; revision: string; draftId?: string}

/** 等两帧让 React 提交与布局生效；后台页不等待被节流的 rAF，取消和超时都会清理资源。 */
function waitForLayout(signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve(false)
  return new Promise((resolve, reject) => {
    let frame = 0
    let frames = 0
    const clear = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {clear(); reject(signal?.reason ?? new DOMException('页面检查已取消', 'AbortError'))}
    const timeout = setTimeout(() => {clear(); resolve(false)}, 250)
    const next = () => {
      frames += 1
      if (frames >= 2) {clear(); resolve(true)}
      else frame = requestAnimationFrame(next)
    }
    signal?.addEventListener('abort', abort, {once: true})
    frame = requestAnimationFrame(next)
  })
}

/** 宿主桥接只读取实际挂载信息，不导航，不提交数据，也不把未提交的配置当成已渲染。 */
export function createPageInspectionHost(host: {
  getWorkspace: () => Workspace
  getMounted: () => MountedInspectionPage | null
}): (request: PageInspectionRequest, signal?: AbortSignal) => Promise<PageInspectionReport> {
  return async ({pageId}, signal) => {
    signal?.throwIfAborted()
    const unknownPage = () => pageId && !host.getWorkspace().pages.some((page) => page.id === pageId)
    if (unknownPage()) return unavailablePageInspection({pageId, code: 'unknown-page', reason: '工作空间中没有这个页面。'})
    const settled = await waitForLayout(signal)
    signal?.throwIfAborted()
    if (unknownPage()) return unavailablePageInspection({pageId, code: 'unknown-page', reason: '等待布局时页面已被移除。'})
    const workspace = host.getWorkspace()
    const mounted = host.getMounted()
    const page = workspace.pages.find((item) => item.id === (pageId ?? mounted?.pageId))
    if (!mounted || !page || mounted.pageId !== page.id || !mounted.root.isConnected) {
      return unavailablePageInspection({pageId: pageId ?? page?.id, pageName: page?.name, code: 'not-mounted', reason: '目标页面当前没有挂载在页面画布中；检查不会自动打开页面。'})
    }
    if (mounted.workspace !== workspace) {
      return unavailablePageInspection({pageId: page.id, pageName: page.name, revision: mounted.revision, status: 'unknown', code: 'stale-render', reason: '最新工作空间尚未提交到当前页面，请在页面更新后再次检查。'})
    }
    const document = mounted.root.ownerDocument
    return inspectPageElement(mounted.root, {
      pageId: page.id, pageName: page.name, draftId: mounted.draftId,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      reducedMotion: document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false,
      revision: mounted.revision, now: Date.now(),
    }, {settled})
  }
}
