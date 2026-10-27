import {Component, Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ErrorInfo, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Button, Popover} from '@lobehub/ui'
import ClickSpark from './vendor/ClickSpark'
import {getFx} from './catalog'
import {getFxCapability, qualityParams} from './capabilities'
import {FX_COMPACT_WIDTH, planPageEffects} from './policy'
import {createFxView} from './views'
import {useFxThemeParams} from './useFxTheme'
import {FX_RUNTIME_ERROR_EVENT} from './runtimeErrors'
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
type RuntimeNotice = {message: string; retry?: () => void}
const FxContext = createContext<{plan: Plan; compact: boolean; report: (key: string, notice?: RuntimeNotice) => void} | null>(null)

class Quiet extends Component<{id: string; fallback: ReactNode; onFailure: () => void; children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() { return {failed: true} }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[特效出错] ${this.props.id}`, error, info.componentStack)
    this.props.onFailure()
  }
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
    return <div className="fx-static-text" style={{color: typeof params.color === 'string' ? params.color : undefined}}>{prefix}{content}{suffix}</div>
  }
  if (def?.kind === 'card') {
    const [title, ...body] = text.split('\n')
    return <div className="fx-card-text fx-static-card" style={{color: typeof params.color === 'string' ? params.color : undefined, background: typeof params.background === 'string' ? params.background : undefined}}><div className="fx-card-title">{title}</div>{body.map((line, index) => <p key={index}>{line}</p>)}</div>
  }
  if (def?.kind === 'background' || def?.kind === 'scene') return <div className="fx-static-backdrop" data-effect={id} style={{backgroundColor: typeof params.backgroundColor === 'string' ? params.backgroundColor : undefined}} />
  return null
}

type EffectProps = {id: string; text?: string; params?: Record<string, unknown>; effectKey?: string}
export function FxEffect(props: EffectProps) {
  // Configuration edits reset a failed decoration; theme and unrelated business renders do not.
  return <EffectInstance key={`${props.id}:${JSON.stringify(props.params ?? {})}`} {...props} />
}

function EffectInstance({id, text = '', params, effectKey}: EffectProps) {
  const context = useContext(FxContext)
  const [failure, setFailure] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setFailure(undefined); setAttempt((value) => value + 1) }, [])
  const failLoad = useCallback(() => setFailure('效果加载失败，已显示静态内容'), [])
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const fail = (event: Event) => {
      const code: unknown = (event as CustomEvent<{code?: unknown}>).detail?.code
      if (code === 'webgl-unavailable') setFailure('当前环境不支持图形效果，已静态显示')
      if (code === 'shader-failed') setFailure('图形效果初始化失败，已静态显示')
    }
    const lost = (event: Event) => { event.preventDefault(); setFailure('图形连接已中断，已静态显示') }
    element.addEventListener(FX_RUNTIME_ERROR_EVENT, fail)
    element.addEventListener('webglcontextlost', lost, true)
    return () => {
      element.removeEventListener(FX_RUNTIME_ERROR_EVENT, fail)
      element.removeEventListener('webglcontextlost', lost, true)
    }
  }, [element])
  const ownCompact = useCompact(element)
  // A half-width widget can be narrower than its page; enforce both boundaries.
  const compact = Boolean(context?.compact || ownCompact)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const coarse = useMedia('(hover: none), (pointer: coarse)')
  const visible = useDocumentVisible()
  const inView = useInView(element)
  const def = getFx(id)
  const {params: normalized, dark, palette, colorOverrides} = useFxThemeParams(def, params)
  const capability = getFxCapability(id)
  const decision = context?.plan.entries.find((entry) => entry.key === effectKey)
  const pointerOnly = def?.kind === 'card'
  const localReason = compact && capability?.compact === 'static' ? '窄容器静态显示' : coarse && pointerOnly ? '触屏静态显示' : !def ? '效果暂不可用，已保留文字' : undefined
  const reason = reduced ? '减少动画' : !visible ? '页面隐藏' : !inView ? '离屏暂停' : localReason ?? (decision?.mode === 'static' ? decision.reason : undefined)
  const report = context?.report
  useEffect(() => {
    if (!effectKey || !report) return
    const message = decision?.mode === 'static' ? undefined : localReason ?? (!reason ? failure : undefined)
    report(effectKey, message ? {message: `${def?.name ?? '未知效果'}：${message}`, retry: !reason && failure ? retry : undefined} : undefined)
    return () => report(effectKey)
  }, [effectKey, report, localReason, def?.name, decision?.mode, reason, failure, retry])
  const View = useMemo(() => createFxView(id), [id, attempt])
  const fallback = <StaticEffect id={id} text={text} params={normalized} />
  const runtimeParams = qualityParams(id, normalized, {compact, coarsePointer: coarse})
  const failed = !reason && failure
  return (
    <div ref={setElement} className="fx-runtime" data-kind={def?.kind ?? 'text'} data-fx-id={id} data-fx-state={failed ? 'failed' : reason || !View ? 'static' : 'animated'} data-fx-reason={reason ?? failure} style={{color: typeof normalized.color === 'string' ? normalized.color : undefined}}>
      {reason || failure || !View ? fallback : <Quiet key={attempt} id={id} fallback={fallback} onFailure={failLoad}><Suspense fallback={fallback}><View text={text} p={runtimeParams} dark={dark} palette={palette} colorOverrides={colorOverrides} /></Suspense></Quiet>}
      {failed && !effectKey?.startsWith('layer:') && <div className="fx-failure"><span role="status">{failure}</span><Button size="small" type="text" onClick={retry}>重试</Button>{attempt > 0 && <span>仍无法加载时，可刷新页面再试。</span>}</div>}
    </div>
  )
}

export function hasBackdrop(layers?: Layer[]): boolean {
  // Static backgrounds still occupy the same decorative surface behind the shell.
  return (layers ?? []).some((layer) => ['background', 'scene'].includes(getFx(layer.effect)?.kind ?? ''))
}

export function FxLayers({layers, page, container, children, portal}: {layers?: Layer[]; page?: Page; container?: HTMLElement | null; children: ReactNode; portal?: HTMLElement | null}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [localNotices, setLocalNotices] = useState<Record<string, RuntimeNotice>>({})
  const report = useCallback((key: string, notice?: RuntimeNotice) => setLocalNotices((previous) => {
    if (previous[key]?.message === notice?.message && previous[key]?.retry === notice?.retry) return previous
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
  const sparkTheme = useFxThemeParams(spark?.def, spark?.layer.params)
  const sparkDecision = plan.entries.find((entry) => entry.key === spark?.key)
  const sparkDisabled = !spark || reduced || coarse || !visible || !inView || sparkDecision?.mode === 'static'
  const sparkParams = spark ? qualityParams('click-spark', sparkTheme.params, {compact, coarsePointer: coarse}) : {}
  const notices = [...new Set([
    ...plan.entries.filter((entry) => entry.mode === 'static').map((entry) => `${getFx(entry.effect)?.name ?? '未知效果'}：${entry.reason}`),
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
          {(notices.length > 0 || Object.keys(localNotices).length > 0) && <div className="fx-policy-trigger"><Popover trigger="click" placement="topRight" content={
            <div className="fx-policy-notice"><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}{Object.entries(localNotices).map(([key, notice]) => <li key={key}>{notice.message}{notice.retry && <Button size="small" type="text" onClick={notice.retry} aria-label={`重试${notice.message.split('：')[0]}`}>重试</Button>}</li>)}</ul><p>原配置已保留。可调整特效或重试，加载仍失败时刷新页面再试。</p></div>
          }><Button type="text" size="small">特效已简化</Button></Popover></div>}
        </ClickSpark>
      </div>
    </FxContext.Provider>
  )
}
