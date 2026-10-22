import {useState} from 'react'
import {Check, ChevronDown, CircleAlert, LoaderCircle} from 'lucide-react'
import type {ToolStep} from '../lib/chat'

/**
 * 工具调用行。
 *
 * 成功只显示一行动作说明（「添加组件：待办」），不占地方；
 * 失败的默认展开，把原因摆出来——失败需要被看见，成功不需要。
 */
export function ToolRow({step, pending}: {step: ToolStep; pending?: boolean}) {
  const [open, setOpen] = useState(!step.ok)

  const icon = pending ? (
    <LoaderCircle size={13} className="tool-spin" />
  ) : step.ok ? (
    <Check size={13} className="tool-ok" />
  ) : (
    <CircleAlert size={13} className="tool-fail" />
  )

  return (
    <div className="tool-row" data-ok={step.ok} data-pending={pending ? 'true' : undefined}>
      <button type="button" className="tool-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
        <span className="tool-title">{step.title}</span>
        {!step.ok && <span className="tool-badge">未完成</span>}
        <ChevronDown size={12} className={open ? 'tool-chevron is-open' : 'tool-chevron'} aria-hidden />
      </button>
      {open && step.text && <p className="tool-detail">{step.text}</p>}
    </div>
  )
}
