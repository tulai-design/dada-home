import {Component, Suspense, createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ErrorInfo, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Button, Popover} from '@lobehub/ui'
import ClickSpark from './vendor/ClickSpark'
import {getFx, normalizeParams} from './catalog'
import {getFxCapability, qualityParams} from './capabilities'
import {FX_COMPACT_WIDTH, planPageEffects} from './policy'
import {VIEWS} from './views'
import type {Layer, Page} from '../lib/workspace'
import './runtime.css'

export function useDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify)
      observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
      return () => observer.disconnect()
    },
    () => document.documentElement.dataset.theme === 'dark',
    () => false,
  )
}

function useMedia(query: string) {
  const media = useMemo(() => typeof window === 'undefined' ? undefined : window.matchMedia(query), [query])
  return useSyncExternalStore(
    (notify) => { media?.addEventListener('change', notify); return () => media?.removeEventListener('change', notify) },
    () => media?.matches ?? false,
    () => false,
  )
}

function useDocumentVisible() {
  return useSyncExternalStore(
    (notify) => { document.addEventListener('visibilitychange', notify); return () => document.removeEventListener('visibilitychange', notify) },
    () => !document.hidden,
    () => false,
  )
}

// No animation loop here: unmounting a decorative View invokes its existing resource cleanup.
function useInView(element: HTMLElement | null) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return
    setVisible(true)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return visible
}

function useCompact(element: HTMLElement | null) {
  const [compact, setCompact] = useState(true)
  useEffect(() => {
    if (!element) return
    const measure = () => setCompact(element.getBoundingClientRect().width < FX_COMPACT_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return compact
}

type Plan = ReturnType<typeof planPageEffects>
const FxContext = createContext<{plan: Plan; compact: boolean; report: (key: string, notice?: string) => void} | null>(null)

class Quiet extends Component<{id: string; fallback: ReactNode; children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() { return {failed: true} }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[特效出错] ${this.props.id}`, error, info.componentStack) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Static content is independent of the vendor module: lazy loading and policy fallbacks do not erase text. */
function StaticEffect({id, text, params}: {id: string; text: string; params: Record<string, unknown>}) {
  const def = getFx(id)
  if (!def || def.kind === 'text') {
    const prefix = ['count-up', 'text-type'].includes(id) && typeof params.prefix === 'string' ? params.prefix : ''
    const suffix = id === 'count-up' && typeof params.suffix === 'string' ? params.suffix : ''
    // CountUp's animated view also extracts the numeric target before adding adornments.
    const content = id === 'count-up' ? String(Number.parseFloat(text.replace(/[^0-9.\-]/g, '')) || 0) : text
    return <div className="fx-static-text">{prefix}{content}{suffix}</div>
  }
  if (def?.kind === 'card') {
    const [title, ...body] = text.split('\n')
    return <div className="fx-card-text fx-static-card"><div className="fx-card-title">{title}</div>{body.map((line, index) => <p key={index}>{line}</p>)}</div>
  }
  if (def?.kind === 'background' || def?.kind === 'scene') return <div className="fx-static-backdrop" data-effect={id} />
  return null
}

export function FxEffect({id, text = '', params, effectKey}: {id: string; text?: string; params?: Record<string, unknown>; effectKey?: string}) {
  const dark = useDark()
  const context = useContext(FxContext)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const ownCompact = useCompact(element)
  // A half-width widget can be narrower than its page; enforce both boundaries.
  const compact = Boolean(context?.compact || ownCompact)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const coarse = useMedia('(hover: none), (pointer: coarse)')
  const visible = useDocumentVisible()
  const inView = useInView(element)
  const def = getFx(id)
  const capability = getFxCapability(id)
  const decision = context?.plan.entries.find((entry) => entry.key === effectKey)
  const pointerOnly = def?.kind === 'card'
  const localReason = compact && capability?.compact === 'static' ? '窄容器静态显示' : coarse && pointerOnly ? '触屏静态显示' : !def ? '效果暂不可用，已保留文字' : undefined
  const reason = reduced ? '减少动画' : !visible ? '页面隐藏' : !inView ? '离屏暂停' : localReason ?? (decision?.mode === 'static' ? decision.reason : undefined)
  const report = context?.report
  useEffect(() => {
    if (!effectKey || !report || decision?.mode === 'static') return
    report(effectKey, localReason ? `${def?.name ?? '未知效果'}：${localReason}` : undefined)
    return () => report(effectKey)
  }, [effectKey, report, localReason, def?.name, decision?.mode])
  const View = VIEWS[id]
  const normalized = def ? normalizeParams(def, params) : {}
  const fallback = <StaticEffect id={id} text={text} params={normalized} />
  const runtimeParams = qualityParams(id, normalized, {compact, coarsePointer: coarse})
  return (
    <div ref={setElement} className="fx-runtime" data-kind={def?.kind ?? 'text'} data-fx-id={id} data-fx-state={reason || !View ? 'static' : 'animated'} data-fx-reason={reason}>
      {reason || !View ? fallback : <Quiet key={id} id={id} fallback={fallback}><Suspense fallback={fallback}><View text={text} p={runtimeParams} dark={dark} /></Suspense></Quiet>}
    </div>
  )
}

export function hasBackdrop(layers?: Layer[]): boolean {
  // Static backgrounds still occupy the same decorative surface behind the shell.
  return (layers ?? []).some((layer) => ['background', 'scene'].includes(getFx(layer.effect)?.kind ?? ''))
}

export function FxLayers({layers, page, container, children, portal}: {layers?: Layer[]; page?: Page; container?: HTMLElement | null; children: ReactNode; portal?: HTMLElement | null}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [localNotices, setLocalNotices] = useState<Record<string, string>>({})
  const report = useCallback((key: string, notice?: string) => setLocalNotices((previous) => {
    if (previous[key] === notice) return previous
    const next = {...previous}
    if (notice) next[key] = notice
    else delete next[key]
    return next
  }), [])
  const compact = useCompact(container ?? root)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const coarse = useMedia('(hover: none), (pointer: coarse)')
  const visible = useDocumentVisible()
  const inView = useInView(root)
  const list = page?.layers ?? layers ?? []
  const plan = useMemo(() => planPageEffects(page ?? {id: '', name: '', label: '', components: [], layers: list}, {compact}), [page, list, compact])
  const defs = list.map((layer, index) => ({layer, def: getFx(layer.effect), key: `layer:${index}`})).filter((item) => item.def)
  const behind = defs.filter(({def}) => def!.kind === 'background' || def!.kind === 'scene')
  const above = defs.filter(({def}) => def!.id === 'noise')
  const spark = defs.find(({def}) => def!.id === 'click-spark')
  const sparkDecision = plan.entries.find((entry) => entry.key === spark?.key)
  const sparkDisabled = !spark || reduced || coarse || !visible || !inView || sparkDecision?.mode === 'static'
  const sparkParams = spark ? qualityParams('click-spark', normalizeParams(spark.def!, spark.layer.params), {compact, coarsePointer: coarse}) : {}
  const notices = [...new Set([
    ...plan.entries.filter((entry) => entry.mode === 'static').map((entry) => `${getFx(entry.effect)?.name ?? '未知效果'}：${entry.reason}`),
    ...Object.values(localNotices),
    ...(coarse && spark ? ['触屏已关闭点击火花装饰。'] : []),
    ...(reduced && plan.entries.length ? ['已按系统减少动画偏好显示静态效果。'] : []),
  ])]
  const backdrop = behind.length ? <div className="fx-layers" aria-hidden="true">{behind.map(({layer, key}) => <div className="fx-layer" key={key}><FxEffect id={layer.effect} params={layer.params} effectKey={key} /></div>)}</div> : null
  return (
    <FxContext.Provider value={{plan, compact, report}}>
      {/* Keep this business-content parent stable when spark/policy/media changes. */}
      <div ref={setRoot} style={{height: '100%', minWidth: 0, position: 'relative'}}>
        <ClickSpark {...sparkParams} disabled={sparkDisabled}>
          {backdrop && (portal ? createPortal(backdrop, portal) : backdrop)}
          {children}
          {above.map(({layer, key}) => <div className="fx-overlay" key={key} aria-hidden="true"><FxEffect id={layer.effect} params={layer.params} effectKey={key} /></div>)}
          {notices.length > 0 && <div className="fx-policy-trigger"><Popover trigger="click" placement="topRight" content={
            <div className="fx-policy-notice"><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul><p>原配置已保留，可减少特效或扩大页面区域。</p></div>
          }><Button type="text" size="small">特效已简化</Button></Popover></div>}
        </ClickSpark>
      </div>
    </FxContext.Provider>
  )
}
