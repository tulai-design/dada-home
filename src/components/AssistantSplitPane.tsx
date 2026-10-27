import {useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react'
import {assistantRatioAt, assistantRatioForKey, DEFAULT_ASSISTANT_RATIO, splitGeometry} from '../lib/assistantLayout'
import '../assistant-split.css'

type Props = {
  enabled: boolean
  /** 右侧面板占可分配宽度的比例。这里只回报主动调整，收窄窗口不会覆盖用户偏好。 */
  ratio: number
  onRatioChange: (ratio: number) => void
  children: ReactNode
  assistant: ReactNode
  className?: string
  onAvailableChange?: (available: boolean) => void
}

/** 固定两侧挂载位置；调整宽度或切换展示模式不会重挂页面和对话草稿。 */
export function AssistantSplitPane({enabled, ratio, onRatioChange, children, assistant, className = '', onAvailableChange}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  const pointer = useRef<number | null>(null)
  const geometry = splitGeometry(width, ratio)
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const changeRef = useRef(onRatioChange)
  changeRef.current = onRatioChange
  const split = enabled && geometry.available

  useLayoutEffect(() => {
    const node = container.current
    if (!node) return
    const measure = () => setWidth(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {onAvailableChange?.(geometry.available)}, [geometry.available, onAvailableChange])
  useLayoutEffect(() => {
    if (!split) {
      pointer.current = null
      setDragging(false)
    }
  }, [split])

  const resize = (clientX: number) => {
    const box = container.current?.getBoundingClientRect()
    if (!box) return
    changeRef.current(assistantRatioAt(geometryRef.current, clientX - box.left))
  }
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!split || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current = event.pointerId
    setDragging(true)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return
    event.preventDefault()
    resize(event.clientX)
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return
    if (event.type === 'pointerup') resize(event.clientX)
    pointer.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    const next = assistantRatioForKey(geometryRef.current, event.key, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    changeRef.current(next)
  }
  const style = {'--assistant-split-right': `${geometry.right}px`} as CSSProperties
  const leftPercent = geometry.usable ? geometry.left / geometry.usable * 100 : 0

  return (
    <div ref={container} className={`assistant-workspace ${className}`.trim()} data-split={split ? 'true' : 'false'} data-dragging={dragging ? 'true' : undefined} style={style}>
      <div className="assistant-workspace-page">{children}</div>
      <div
        className="assistant-split-handle"
        role="separator"
        tabIndex={split ? 0 : -1}
        aria-label="调整页面与 AI 面板宽度"
        aria-orientation="vertical"
        aria-valuemin={Math.floor((1 - geometry.maxRatio) * 100)}
        aria-valuemax={Math.ceil((1 - geometry.minRatio) * 100)}
        aria-valuenow={Math.round(leftPercent)}
        aria-valuetext={`页面 ${Math.round(geometry.left)} 像素，AI 面板 ${Math.round(geometry.right)} 像素`}
        title="拖动调整宽度；左右方向键微调，Home / End 到边界"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {pointer.current = null; setDragging(false)}}
        onKeyDown={key}
        onDoubleClick={() => changeRef.current(splitGeometry(width, DEFAULT_ASSISTANT_RATIO).ratio)}
      ><span /></div>
      <div className="assistant-workspace-panel">{assistant}</div>
      {dragging && <div className="assistant-split-shield" aria-hidden="true" />}
    </div>
  )
}
