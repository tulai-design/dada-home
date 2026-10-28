import {useEffect, useRef, useState} from 'react'
import {Button, Text} from '@lobehub/ui'
import {Check, CaretDown as ChevronDown, WarningCircle as CircleAlert, CircleNotch as LoaderCircle} from '@phosphor-icons/react'
import {readToolDetail, type StoredTool} from '../lib/chat'

/** 历史工具只展示元数据；用户展开后才读取正文，缓存随行卸载释放。 */
export function ToolRow({step, active = false}: {step: StoredTool; active?: boolean}) {
  const [open, setOpen] = useState(active && !step.ok)
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const request = useRef<{id: string; promise: Promise<string>} | null>(null)

  useEffect(() => {
    if (!open || detail !== null) return
    let current = true
    setLoading(true)
    setError('')
    if (request.current?.id !== step.detailId) request.current = {id: step.detailId, promise: readToolDetail(step.detailId)}
    const pending = request.current
    pending.promise.then(text => {
      if (current) {setDetail(text); setLoading(false)}
    }, cause => {
      if (request.current === pending) request.current = null
      if (current) {setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false)}
    })
    return () => {current = false}
  }, [open, detail, step.detailId, retry])

  return (
    <div className="tool-row" data-ok={step.ok} data-detail-id={step.detailId}>
      <button type="button" className="tool-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {loading && open ? <LoaderCircle size={13} className="tool-spin" /> : step.ok ? <Check size={13} className="tool-ok" /> : <CircleAlert size={13} className="tool-fail" />}
        <span className="tool-title">{step.title}</span>
        {!step.ok && <span className="tool-badge">未完成</span>}
        <ChevronDown size={12} className={open ? 'tool-chevron is-open' : 'tool-chevron'} aria-hidden />
      </button>
      {open && <div className="tool-detail-content">
        {loading && <Text type="secondary" fontSize={12} role="status">正在读取工具结果…</Text>}
        {error && <div className="chat-load-error" role="alert"><Text fontSize={12}>{error}</Text><Button size="small" type="text" onClick={() => setRetry(value => value + 1)}>重新读取</Button></div>}
        {detail !== null && <p className="tool-detail">{detail || '没有返回内容'}</p>}
      </div>}
    </div>
  )
}
