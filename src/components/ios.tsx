import type {CSSProperties, KeyboardEvent, ReactNode} from 'react'
import {Input, InputPassword} from '@lobehub/ui'
import {Check, ChevronRight} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'

/**
 * iOS 设置风格的基础件：圆角分组卡片 + 左标签右控件的行。
 * 设置页和各应用自己的设置面板共用，保证风格一致。
 */

/** 彩色圆角图标块，iOS 设置里每个入口前面那个。 */
export function Tile({icon: Icon, color, size = 28}: {icon: LucideIcon; color: string; size?: number}) {
  const style: CSSProperties = {background: color, width: size, height: size}
  return (
    <span className="ios-tile" style={style}>
      <Icon size={Math.round(size * 0.58)} />
    </span>
  )
}

/** 一组行，白色圆角卡片，上方可有小标题，下方可有说明。 */
export function Group({title, footer, children}: {title?: ReactNode; footer?: ReactNode; children: ReactNode}) {
  return (
    <section className="ios-group">
      {title && <div className="ios-group-title">{title}</div>}
      <div className="ios-card">{children}</div>
      {footer && <div className="ios-group-footer">{footer}</div>}
    </section>
  )
}

type RowProps = {
  label?: ReactNode
  /** 标签下面的次要说明 */
  hint?: ReactNode
  icon?: ReactNode
  /** 右侧控件或文字 */
  children?: ReactNode
  onClick?: () => void
  /** 可点的行右侧显示 > */
  chevron?: boolean
  /** 当前选中（侧栏、单选列表） */
  selected?: boolean
  /** 勾选标记（单选列表） */
  checked?: boolean
  danger?: boolean
  /** 控件很宽（地址、密钥）时放到标签下面一整行 */
  stack?: boolean
}

export function Row({label, hint, icon, children, onClick, chevron, selected, checked, danger, stack}: RowProps) {
  const clickable = Boolean(onClick)
  const onKey = (event: KeyboardEvent) => {
    if (clickable && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick?.()
    }
  }
  return (
    <div
      className="ios-row"
      data-clickable={clickable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-danger={danger ? 'true' : undefined}
      data-stack={stack ? 'true' : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKey}
    >
      {icon && <span className="ios-row-icon">{icon}</span>}
      <span className="ios-row-text">
        {label && <span className="ios-row-label">{label}</span>}
        {hint && <span className="ios-row-hint">{hint}</span>}
      </span>
      {children !== undefined && <span className="ios-row-value">{children}</span>}
      {checked && <Check size={16} className="ios-row-check" />}
      {chevron && <ChevronRight size={16} className="ios-row-chevron" />}
    </div>
  )
}

/** 一行文本输入：标签在左，输入在右，无描边。 */
export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  secret,
  stack,
  hint,
  onEnter,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  secret?: boolean
  stack?: boolean
  hint?: ReactNode
  onEnter?: () => void
}) {
  const Field = secret ? InputPassword : Input
  return (
    <Row label={label} hint={hint} stack={stack}>
      <Field className="ios-input" variant="borderless" value={value} placeholder={placeholder} onValueChange={onChange} onPressEnter={onEnter} />
    </Row>
  )
}
