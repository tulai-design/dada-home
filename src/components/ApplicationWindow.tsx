import {useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {ArrowsInSimple, ArrowsOutSimple, ArrowSquareOut, Minus, X} from '@phosphor-icons/react'
import {applicationWindowRect, maximizeApplicationWindow, moveApplicationWindow, reflowApplicationWindow, restoreApplicationWindow, type WindowBounds, type WindowRect} from '../lib/applicationWindow'
import {useIsMobile} from '../lib/useMedia'

type Props = {
  title: string
  children: ReactNode
  container: HTMLElement | null
  minimized: boolean
  onMinimize: () => void
  onRestore: () => void
  onClose: () => void
}
type Drag = {pointer: number; startX: number; startY: number; rect: WindowRect; target: HTMLElement}
const emptyBounds: WindowBounds = {width: 0, height: 0}

/** A canvas window never captures the rest of the workspace or remounts its application. */
export function ApplicationWindow({title, children, container, minimized, onMinimize, onRestore, onClose}: Props) {
  const mobile = useIsMobile()
  const titleId = useId()
  const boundsRef = useRef<WindowBounds>(emptyBounds)
  const rectRef = useRef<WindowRect | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [bounds, setBounds] = useState<WindowBounds>(emptyBounds)
  const [rect, setRect] = useState<WindowRect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [dragging, setDragging] = useState(false)

  const updateRect = useCallback((value: WindowRect) => {
    rectRef.current = value
    setRect(value)
  }, [])
  const stopDrag = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer)
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!container) return
    const measure = () => {
      const next = {width: container.clientWidth, height: container.clientHeight}
      if (next.width === boundsRef.current.width && next.height === boundsRef.current.height) return
      stopDrag()
      const previous = boundsRef.current
      boundsRef.current = next
      setBounds(next)
      if (next.width > 0 && next.height > 0) updateRect(rectRef.current ? reflowApplicationWindow(previous, next, rectRef.current) : applicationWindowRect(next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [container, stopDrag, updateRect])

  useEffect(() => {
    if (minimized || mobile) stopDrag()
  }, [minimized, mobile, stopDrag])
  useEffect(() => {
    window.addEventListener('blur', stopDrag)
    return () => {
      window.removeEventListener('blur', stopDrag)
      const drag = dragRef.current
      if (drag?.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer)
    }
  }, [stopDrag])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (mobile || maximized || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const current = rectRef.current
    if (!current) return
    event.preventDefault()
    event.currentTarget.focus({preventScroll: true})
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {pointer: event.pointerId, startX: event.clientX, startY: event.clientY, rect: current, target: event.currentTarget}
    setDragging(true)
  }
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointer !== event.pointerId) return
    updateRect(moveApplicationWindow(boundsRef.current, drag.rect, {x: drag.rect.x + event.clientX - drag.startX, y: drag.rect.y + event.clientY - drag.startY}))
  }
  const toggleMaximize = () => {
    stopDrag()
    if (maximized && rectRef.current) updateRect(restoreApplicationWindow(boundsRef.current, rectRef.current))
    setMaximized((value) => !value)
  }
  const visibleRect = mobile ? {x: 0, y: 0, width: bounds.width, height: bounds.height} : maximized ? maximizeApplicationWindow(bounds) : rect
  if (!container) return null

  return createPortal(<div className="application-window-layer" data-mobile={mobile}>
    <section
      className="application-floating-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-maximized={maximized}
      data-dragging={dragging}
      style={{display: minimized ? 'none' : undefined, visibility: visibleRect ? undefined : 'hidden', left: visibleRect?.x, top: visibleRect?.y, width: visibleRect?.width, height: visibleRect?.height}}
    >
      <header
        className="application-floating-titlebar"
        tabIndex={mobile ? -1 : 0}
        aria-label={mobile ? undefined : `${title}，方向键移动窗口`}
        onPointerDown={beginDrag}
        onPointerMove={move}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
        onDoubleClick={(event) => {if (!mobile && !(event.target as HTMLElement).closest('button')) toggleMaximize()}}
        onKeyDown={(event) => {
          if (mobile || maximized || event.target !== event.currentTarget || !rectRef.current) return
          const step = event.shiftKey ? 32 : 12
          const delta = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key]
          if (!delta) return
          event.preventDefault()
          const current = rectRef.current
          updateRect(moveApplicationWindow(boundsRef.current, current, {x: current.x + delta[0], y: current.y + delta[1]}))
        }}
      >
        <div className="application-window-traffic" aria-label="窗口操作" hidden={mobile}>
          <button className="application-traffic-button" data-action="close" type="button" aria-label="关闭应用" title="关闭" onClick={onClose}><X size={10} weight="bold"/></button>
          <button className="application-traffic-button" data-action="minimize" type="button" aria-label="最小化应用" title="最小化" onClick={() => {stopDrag();onMinimize()}}><Minus size={10} weight="bold"/></button>
          <button className="application-traffic-button" data-action="maximize" type="button" aria-label={maximized ? '还原窗口' : '最大化应用'} title={maximized ? '还原' : '最大化'} aria-pressed={maximized} onClick={toggleMaximize}>{maximized ? <ArrowsInSimple size={9} weight="bold"/> : <ArrowsOutSimple size={9} weight="bold"/>}</button>
        </div>
        <span className="application-floating-title" id={titleId}>{title}</span>
        {mobile && <button className="application-mobile-close" type="button" aria-label="关闭应用" title="关闭" onClick={onClose}><X size={18}/></button>}
      </header>
      <div className="application-floating-body">{children}</div>
    </section>
    <div className="application-minimized-window" style={{display: minimized ? undefined : 'none'}}>
      <button className="application-window-restore" type="button" aria-label={`恢复${title}`} title="恢复窗口" onClick={onRestore}><ArrowSquareOut size={15}/><span>{title}</span></button>
      <button className="application-minimized-close" type="button" aria-label={`关闭${title}`} title="关闭" onClick={onClose}><X size={15}/></button>
    </div>
  </div>, container)
}
