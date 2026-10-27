/** Read-only DOM measurements. No text, form values, storage, frame documents or canvas pixels are read. */
export type PageInspectionRequest = {pageId?: string}
export type InspectionIssue = {
  id: string
  code: 'horizontal-overflow' | 'component-clipped' | 'zero-size'
  severity: 'warning' | 'error'
  componentId?: string
  componentType?: string
  selector: string
  measurement: Record<string, number | string | boolean>
  fix: string
}
export type InspectionUnknown = {code: string; componentId?: string; selector?: string; reason: string}
export type PageInspectionReport = {
  schemaVersion: '1'
  status: 'ok' | 'unknown' | 'unavailable'
  page: {id: string; name: string; visible: boolean; viewport: {width: number; height: number}; content: {width: number; height: number}}
  theme: 'light' | 'dark' | null
  reducedMotion: boolean | null
  revision: string
  measuredAt: number
  settled: boolean
  issues: InspectionIssue[]
  unknown: InspectionUnknown[]
  effects?: Array<{id: string; state: string; reason?: string; selector: string; componentId?: string}>
}
export type PageInspectionMetadata = {
  /** 草稿与正式页面可有相同 ID，限定报告 selector 的测量根。 */
  draftId?: string
  pageId: string
  pageName: string
  theme: 'light' | 'dark'
  reducedMotion: boolean
  revision: string
  now: number
}

export function unavailablePageInspection(options: {
  pageId?: string
  pageName?: string
  code: string
  reason: string
  status?: 'unknown' | 'unavailable'
  revision?: string
}): PageInspectionReport {
  return {
    schemaVersion: '1', status: options.status ?? 'unavailable',
    page: {id: options.pageId ?? '', name: options.pageName ?? '', visible: false, viewport: {width: 0, height: 0}, content: {width: 0, height: 0}},
    theme: null, reducedMotion: null, revision: options.revision ?? '', measuredAt: Date.now(), settled: false,
    issues: [], unknown: [{code: options.code, reason: options.reason}], effects: [],
  }
}

const TOLERANCE = 1
const ignoredSelector = '.applet-runner, .ap-table-wrap'
const number = (value: number) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
const cssString = (value: string) => value.replace(/[\0-\x1f\x7f"\\]/g, (character) => character === '\0' ? '\ufffd' : `\\${character.charCodeAt(0).toString(16)} `)

export function pageInspectionSelector(pageId: string, draftId?: string, componentId?: string): string {
  const root = `${draftId === undefined ? '' : `[data-homepage-draft="${cssString(draftId)}"]`}[data-page-id="${cssString(pageId)}"]`
  return componentId === undefined ? root : `${root} .widget[data-id="${cssString(componentId)}"]`
}

/** The registered page is the only traversal boundary. Selectors never include text, input values or arbitrary attributes. */
export function inspectPageElement(root: HTMLElement | null, metadata: PageInspectionMetadata, options: {settled?: boolean; maxElements?: number} = {}): PageInspectionReport {
  const report: PageInspectionReport = {
    schemaVersion: '1', status: 'ok',
    page: {id: metadata.pageId, name: metadata.pageName, visible: false, viewport: {width: 0, height: 0}, content: {width: 0, height: 0}},
    theme: metadata.theme, reducedMotion: metadata.reducedMotion, revision: metadata.revision, measuredAt: number(metadata.now), settled: options.settled ?? true,
    issues: [], unknown: [], effects: [],
  }
  if (!root?.isConnected) {
    report.status = 'unavailable'
    report.unknown.push({code: 'page-not-mounted', reason: '页面没有挂载，无法测量实际布局。'})
    return report
  }
  const view = root.ownerDocument.defaultView
  if (!view) {
    report.status = 'unknown'
    report.unknown.push({code: 'layout-unavailable', reason: '页面没有可用的布局环境。'})
    return report
  }
  const style = (element: Element) => view.getComputedStyle(element)
  const hidden = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const computed = style(current)
      if (computed.display === 'none' || computed.visibility === 'hidden' || computed.visibility === 'collapse' || computed.contentVisibility === 'hidden') return true
    }
    return false
  }
  if (root.ownerDocument.visibilityState === 'hidden' || hidden(root)) {
    report.status = 'unknown'
    report.unknown.push({code: 'page-hidden', reason: '页面或祖先容器隐藏，当前不能判断可见布局。'})
    return report
  }
  const rect = root.getBoundingClientRect()
  report.page.viewport = {width: number(root.clientWidth), height: number(root.clientHeight)}
  report.page.content = {width: number(root.scrollWidth), height: number(root.scrollHeight)}
  report.page.visible = root.getClientRects().length > 0 && rect.width > 0 && rect.height > 0
  if (!report.page.visible || root.clientWidth <= 0 || root.clientHeight <= 0) {
    report.status = 'unknown'
    report.unknown.push({code: 'page-no-layout-box', reason: '页面没有可测量的布局盒，不能把零尺寸当作检查通过。'})
    return report
  }
  if (!report.settled) {
    report.status = 'unknown'
    report.unknown.push({code: 'layout-unsettled', reason: '等待布局稳定已超时；数值是当前采样，页面更新后需要重新检查。'})
  }

  const pageSelector = pageInspectionSelector(metadata.pageId, metadata.draftId)
  const widgetOf = (element: Element) => {
    const widget = element.closest<HTMLElement>('.widget[data-id]')
    return widget && root.contains(widget) ? widget : undefined
  }
  const selectorOf = (element: Element) => {
    const widget = widgetOf(element)
    const base = widget ? pageInspectionSelector(metadata.pageId, metadata.draftId, widget.dataset.id ?? '') : pageSelector
    const boundary = widget ?? root
    const parts: string[] = []
    for (let current: Element | null = element; current && current !== boundary; current = current.parentElement) {
      let index = 1
      for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === current.tagName) index += 1
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`)
    }
    return parts.length ? `${base} > ${parts.join(' > ')}` : base
  }
  const component = (element: Element) => {
    const widget = widgetOf(element)
    return widget ? {componentId: widget.dataset.id, componentType: widget.dataset.type} : {}
  }
  const scrollsBeforeRoot = (element: Element, axis: 'x' | 'y') => {
    for (let current = element.parentElement; current && current !== root; current = current.parentElement) {
      const overflow = axis === 'x' ? style(current).overflowX : style(current).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
    return false
  }
  const clippingBoundary = (element: Element, axis: 'x' | 'y') => {
    const box = element.getBoundingClientRect()
    const ancestors: HTMLElement[] = []
    for (let current = element.parentElement; current; current = current.parentElement) {
      ancestors.unshift(current)
      if (current === root) break
    }
    let accessibleStart = -Infinity
    let accessibleEnd = Infinity
    for (const current of ancestors) {
      const overflow = axis === 'x' ? style(current).overflowX : style(current).overflowY
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden' || overflow === 'clip') {
        const boundary = current.getBoundingClientRect()
        const start = axis === 'x' ? boundary.left + current.clientLeft : boundary.top + current.clientTop
        const viewport = axis === 'x' ? current.clientWidth : current.clientHeight
        const end = start + viewport
        accessibleStart = Math.max(accessibleStart, start)
        accessibleEnd = Math.min(accessibleEnd, end)
        if (accessibleEnd < accessibleStart) return {start, end}
        if (overflow === 'auto' || overflow === 'scroll') {
          // Expand only by real scroll travel; a clipped ancestor's empty space never enlarges a component.
          const offset = axis === 'x' ? current.scrollLeft : current.scrollTop
          const range = Math.max(0, (axis === 'x' ? current.scrollWidth : current.scrollHeight) - viewport)
          accessibleStart -= offset
          accessibleEnd += range - offset
        }
      }
    }
    if ((axis === 'x' ? box.left : box.top) < accessibleStart - TOLERANCE || (axis === 'x' ? box.right : box.bottom) > accessibleEnd + TOLERANCE) return {start: accessibleStart, end: accessibleEnd}
    return undefined
  }
  const addIssue = (element: Element | undefined, code: InspectionIssue['code'], measurement: InspectionIssue['measurement'], fix: string) => {
    const owner = element ? component(element) : {}
    const selector = element ? selectorOf(element) : pageSelector
    const id = `${metadata.pageId}:${owner.componentId ?? 'page'}:${code}`
    if (report.issues.some((issue) => issue.id === id)) return
    report.issues.push({id, code, severity: code === 'zero-size' ? 'error' : 'warning', ...owner, selector, measurement, fix})
  }
  const limit = Math.max(1, Math.min(5000, Math.floor(Number.isFinite(options.maxElements) ? options.maxElements! : 2000)))
  const candidates = root.querySelectorAll<HTMLElement>('.widget[data-id], iframe, canvas, [data-fx-id]')
  if (candidates.length > limit) report.unknown.push({code: 'inspection-truncated', reason: `候选元素超过采样上限 ${limit}，未检查全部元素。`})
  const sampled = Array.from(candidates).slice(0, limit)
  const contentLeft = rect.left + root.clientLeft
  const contentTop = rect.top + root.clientTop
  const rootOverflow = root.scrollWidth > root.clientWidth + TOLERANCE
  let locatedOverflow = false

  for (const element of sampled) {
    if (element.closest(ignoredSelector) || hidden(element)) continue
    const elementRect = element.getBoundingClientRect()
    const isWidget = element.matches('.widget[data-id]')
    if (isWidget && !widgetOf(element.parentElement ?? root)) {
      // The outer widget box is measurable; local scrollable content is intentionally not inspected.
      const left = number(elementRect.left - contentLeft)
      const top = number(elementRect.top - contentTop)
      const right = number(elementRect.right - contentLeft)
      const bottom = number(elementRect.bottom - contentTop)
      const measurement = {left, top, right, bottom, width: number(elementRect.width), height: number(elementRect.height), containerWidth: root.clientWidth, containerHeight: root.clientHeight}
      if (elementRect.width <= 0 || elementRect.height <= 0) {
        addIssue(element, 'zero-size', measurement, '为可见组件提供非零宽高，并检查网格尺寸、min-width 和父容器约束。')
      } else {
        const outX = (left < -TOLERANCE || right > root.clientWidth + TOLERANCE) && !scrollsBeforeRoot(element, 'x')
        const clipX = clippingBoundary(element, 'x')
        const clipY = clippingBoundary(element, 'y')
        if (outX && rootOverflow) {
          locatedOverflow = true
          addIssue(element, 'horizontal-overflow', {...measurement, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, overflowPixels: number(Math.max(right - root.clientWidth, -left))}, '约束组件宽度为容器可用宽度，使用 max-width: 100%、min-width: 0 或让内部内容局部横向滚动。')
        } else if (clipX || clipY) {
          addIssue(element, 'component-clipped', {...measurement, clippedX: Boolean(clipX), clippedY: Boolean(clipY), ...(clipX ? {clippingContainerLeft: number(clipX.start - contentLeft), clippingContainerRight: number(clipX.end - contentLeft)} : {}), ...(clipY ? {clippingContainerTop: number(clipY.start - contentTop), clippingContainerBottom: number(clipY.end - contentTop)} : {})}, '调整组件位置和尺寸；需要长内容时，为组件内层设置适当的滚动容器。')
        }
      }
    }
    if (elementRect.width <= 0 || elementRect.height <= 0 || element.getClientRects().length === 0) continue
    if (element.tagName === 'IFRAME' || element.tagName === 'CANVAS') {
      const code = element.tagName === 'IFRAME' ? 'iframe-content' : 'canvas-content'
      report.unknown.push({code, componentId: component(element).componentId, selector: selectorOf(element), reason: element.tagName === 'IFRAME' ? '仅测量 iframe 外框，不读取其文档；内部布局和内容需要应用自身验证。' : '仅测量 Canvas 外框，不读取像素；内部布局、内容和渲染结果无法判断。'})
    }
    if (element.hasAttribute('data-fx-id')) {
      const reason = element.getAttribute('data-fx-reason')
      report.effects!.push({id: element.getAttribute('data-fx-id') ?? '', state: element.getAttribute('data-fx-state') ?? 'unknown', ...(reason ? {reason} : {}), selector: selectorOf(element), componentId: component(element).componentId})
    }
  }
  if (rootOverflow && !locatedOverflow) addIssue(undefined, 'horizontal-overflow', {scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, overflowPixels: number(root.scrollWidth - root.clientWidth)}, '检查页面网格和组件宽度约束，避免固定宽度内容撑开页面；长内容使用组件内的局部滚动容器。')
  report.unknown.push(
    {code: 'contrast-not-measured', reason: '没有读取像素、背景合成和文字内容，无法判断实际对比度。'},
    {code: 'appearance-not-evaluated', reason: '报告只包含宿主 DOM 的几何测量，不代表审美、内容质量或完整无障碍验收。'},
  )
  return report
}
