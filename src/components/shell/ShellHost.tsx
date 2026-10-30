import {Component, createContext, forwardRef, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode} from 'react'
import {ShellPorts} from './ports'
import {BUILTIN_SHELL_ADAPTERS} from './adapters'
import {createShellRegistry, equalPresentation, validateShellPresentation} from './registry'
import {VISIBLE_PRESENTATION, type ShellAdapter, type ShellModel, type ShellPresentation, type ShellSnapshot} from './contracts'
import type {ShellIntent} from '../../lib/shell/navigation'
import type {ThemeSkin} from '../../lib/workspace'
import '../../shell-host.css'

type HostContext = {snapshot: ShellSnapshot; setNavigation: (el: HTMLDivElement | null) => void; setCanvas: (el: HTMLDivElement | null) => void; fail: (error: unknown) => void}
const ActivationContext = createContext(0)
const Context = createContext<HostContext | null>(null)
function useHost() {const value = useContext(Context); if (!value) throw new Error('ShellHost 未挂载'); return value}
export function useShellPresentation() {return useHost().snapshot}

class AdapterBoundary extends Component<{onError: (error: unknown) => void; children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() {return {failed: true}}
  componentDidCatch(error: unknown) {this.props.onError(error)}
  render() {return this.state.failed ? null : this.props.children}
}
export type ShellHostProps = {
  requestedShell: string
  requestedSkin: ThemeSkin
  model: ShellModel
  dispatch: (intent: ShellIntent) => void
  onPresentationChange?: (snapshot: ShellSnapshot) => void
  registry?: readonly ShellAdapter[]
  children: ReactNode
}
export function ShellHost({requestedShell, requestedSkin, model, dispatch, onPresentationChange, registry = BUILTIN_SHELL_ADAPTERS, children}: ShellHostProps) {
  const catalog = useMemo(() => createShellRegistry(registry), [registry])
  const [fault, setFault] = useState<{request: string; reason: string} | null>(null)
  const [retry, setRetry] = useState(0)
  const request = `${requestedShell}:${retry}`
  const requested = catalog.get(requestedShell)
  const failed = fault?.request === request
  const fallback = !requested || failed
  const adapter = fallback ? BUILTIN_SHELL_ADAPTERS[0] : requested
  const signature = `${request}:${adapter.id}`
  const generation = useRef({signature, adapter, value: 0})
  if (generation.current.signature !== signature || generation.current.adapter !== adapter) generation.current = {signature, adapter, value: generation.current.value + 1}
  const session = `${signature}:${generation.current.value}`
  const currentSession = useRef(session)
  currentSession.current = session
  const [layout, setLayout] = useState<{session: string; value: ShellPresentation}>({session, value: VISIBLE_PRESENTATION})
  const presentation = layout.session === session ? layout.value : VISIBLE_PRESENTATION
  const [navigation, setNavigation] = useState<HTMLDivElement | null>(null)
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null)
  const fail = useCallback((error: unknown) => {
    if (currentSession.current !== session) return
    setFault({request, reason: error instanceof Error ? error.message : String(error)})
  }, [session, request])
  const publish = useCallback((value: ShellPresentation) => {
    if (currentSession.current !== session) return
    if (!validateShellPresentation(value)) {fail(new Error('外壳布局不符合合同')); return}
    setLayout((previous) => previous.session === session && equalPresentation(previous.value, value) ? previous : {session, value})
  }, [session, fail])
  const safeDispatch = useCallback((intent: ShellIntent) => {try {dispatch(intent)} catch (error) {fail(error)}}, [dispatch, fail])
  const snapshot = useMemo<ShellSnapshot>(() => ({...presentation, activeShell: adapter.id, activeSkin: fallback ? 'paper' : requestedSkin, capabilities: adapter.capabilities, fault: fallback ? {requestedShell, reason: failed ? fault!.reason : '请求的外壳未登记'} : null}), [presentation, adapter, fallback, requestedSkin, requestedShell, failed, fault])
  const notification = useRef(onPresentationChange)
  notification.current = onPresentationChange
  useLayoutEffect(() => notification.current?.(snapshot), [snapshot])
  const context = useMemo(() => ({snapshot, setNavigation, setCanvas, fail}), [snapshot, fail])
  const ports = useMemo(() => ({navigation, canvas}), [navigation, canvas])
  return <Context.Provider value={context}><ActivationContext.Provider value={model.activation.revision}><ShellPorts.Provider value={ports}>
    {children}
    <AdapterBoundary key={session} onError={fail}><adapter.Chrome model={model} dispatch={safeDispatch} publish={publish} reportError={fail} /></AdapterBoundary>
    {snapshot.fault && <aside className="shell-recovery" role="status" aria-label="外壳恢复">
      <span>桌面已安全恢复：{snapshot.fault.reason}</span>
      <button type="button" onClick={() => dispatch({type: 'navigate', target: {kind: 'system', name: 'settings'}})}>打开设置</button>
      <button type="button" onClick={() => dispatch({type: 'assistant', action: 'open-panel'})}>搭搭助手</button>
      {model.assistant.busy && <button type="button" onClick={() => dispatch({type: 'assistant', action: 'stop'})}>停止</button>}
      <button type="button" onClick={() => setRetry((value) => value + 1)}>重试桌面</button>
    </aside>}
  </ShellPorts.Provider></ActivationContext.Provider></Context.Provider>
}
export function ShellNavigation() {const {setNavigation} = useHost(); return <div className="shell-navigation" ref={setNavigation} />}
export const ShellCanvas = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ShellCanvas({children, className = '', style, ...props}, forwardedRef) {
  const {snapshot, setCanvas, fail} = useHost()
  const stage = useRef<HTMLDivElement | null>(null)
  const chrome = useRef<HTMLDivElement | null>(null)
  const focus = useRef<{element: HTMLElement; revision: number} | null>(null)
  const activation = useContext(ActivationContext)
  const visible = snapshot.content === 'visible'
  useLayoutEffect(() => {
    if (!visible) {
      if (document.activeElement instanceof HTMLElement && stage.current?.contains(document.activeElement)) focus.current = {element: document.activeElement, revision: activation}
      chrome.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true})
    } else if (focus.current) {
      const restore = focus.current; focus.current = null
      if (restore.revision === activation && restore.element.isConnected && (document.activeElement === document.body || chrome.current?.contains(document.activeElement))) restore.element.focus({preventScroll: true})
    }
  }, [visible, activation])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el || !visible) return
    const check = () => {const {width, height} = el.getBoundingClientRect(); const r = snapshot.reserves; if (width && height && (r.left + r.right >= width || r.top + r.bottom >= height)) fail(new Error('外壳保留区超出画布'))}
    check(); const observer = new ResizeObserver(check); observer.observe(el); return () => observer.disconnect()
  }, [snapshot.reserves, fail, visible])
  const setCanvasRef = useCallback((element: HTMLDivElement | null) => {
    canvasRef.current = element
    if (typeof forwardedRef === 'function') forwardedRef(element)
    else if (forwardedRef) forwardedRef.current = element
  }, [forwardedRef])
  const setChromeRef = useCallback((element: HTMLDivElement | null) => {chrome.current = element; setCanvas(element)}, [setCanvas])
  const reserves = snapshot.reserves
  const layoutStyle = {...style, '--shell-top': `${reserves.top}px`, '--shell-right': `${reserves.right}px`, '--shell-bottom': `${reserves.bottom}px`, '--shell-left': `${reserves.left}px`} as CSSProperties
  return <div {...props} style={layoutStyle} className={`canvas ${className}`.trim()} ref={setCanvasRef} data-shell={snapshot.activeShell} data-shell-content={snapshot.content} data-switch-board={snapshot.content === 'launcher' || undefined} data-win98-desktop={snapshot.activeShell === 'win98' ? !visible : undefined} data-win98-maximized={snapshot.activeShell === 'win98' ? snapshot.maximized : undefined}>
    <div className="shell-canvas-chrome" ref={setChromeRef} />
    <div className="shell-content-stage" onFocusCapture={(event) => {if (event.target instanceof HTMLElement) focus.current = {element: event.target, revision: activation}}} ref={stage} hidden={!visible} inert={!visible || undefined} aria-hidden={!visible || undefined}>{children}</div>
  </div>
})
