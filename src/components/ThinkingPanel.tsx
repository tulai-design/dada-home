import {useEffect, useRef, useState} from 'react'
import {CaretDown as ChevronDown} from '@phosphor-icons/react'
import {Markdown} from '@lobehub/ui'

/**
 * 思考过程面板。
 *
 * 模型返回 reasoning 时，先显示「思考中」并自动展开；
 * 正文开始输出后自动收起，但用户随时可以再点开。
 *
 * 自动展开/收起只在状态真正切换的那一刻做一次，
 * 之后完全交给用户——每次都强制收起会让人没法读。
 */
export function ThinkingPanel({
  reasoning,
  active,
  durationMs,
}: {
  reasoning: string
  /** 模型当前还在思考（还没有正文输出） */
  active: boolean
  durationMs?: number
}) {
  const [open, setOpen] = useState(active)
  const prevActive = useRef(active)

  useEffect(() => {
    const wasActive = prevActive.current
    if (active && !wasActive) setOpen(true)
    if (!active && wasActive) setOpen(false)
    prevActive.current = active
  }, [active])

  if (!reasoning.trim()) return null

  return (
    <div className="thinking">
      <button type="button" className="thinking-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="thinking-title">{thinkingTitle(active, durationMs)}</span>
        <ChevronDown size={14} className={open ? 'thinking-chevron is-open' : 'thinking-chevron'} aria-hidden />
      </button>
      {open && (
        <div className="thinking-body">
          <Markdown variant="chat">{reasoning}</Markdown>
        </div>
      )}
    </div>
  )
}

/** 标题文案：进行中说「思考中」，结束后报时长。 */
export function thinkingTitle(active: boolean, durationMs?: number): string {
  if (active) return '思考中'
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
    return `已思考 ${(durationMs / 1000).toFixed(1)} 秒`
  }
  return '思考过程'
}
