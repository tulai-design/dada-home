import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react'
import {
  ActionIcon,
  Block,
  Button,
  Checkbox,
  DatePicker,
  datePickerLocaleZhCN,
  Empty,
  Flexbox,
  Input,
  InputNumber,
  InputPassword,
  Progress,
  Segmented,
  Select,
  Slider,
  Statistic,
  Switch,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui'
import {iconOf} from './icons'

/**
 * 小程序的渲染器：把沙盒送来的积木树（纯 JSON）画成 Lobe UI 的真控件。
 *
 * 安全上这里是关键的一道闸：
 *   - 只认目录里的组件名，未知的显示成提示框；
 *   - 所有属性都按类型取值、限定范围，不信任来路；
 *   - 只用 React 的正常渲染，没有 dangerouslySetInnerHTML，也不会把字符串当 HTML 或 CSS；
 *   - 事件只传一个函数编号和一个值，真正的函数留在沙盒里。
 */

export type UiNode = {t: string; p: Record<string, unknown>; c: UiNode[]}
export type Fire = (fn: number, payload?: unknown) => void

/* ───────────── 取值工具 ───────────── */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)
const num = (v: unknown, fallback: number, min = -1e9, max = 1e9): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}
const bool = (v: unknown): boolean => v === true
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)

type Handler = {$fn: number}
const isHandler = (v: unknown): v is Handler => !!v && typeof v === 'object' && typeof (v as Handler).$fn === 'number'

type Option = {label: string; value: string}
const options = (v: unknown): Option[] =>
  Array.isArray(v)
    ? v.slice(0, 200).map((item) =>
        item && typeof item === 'object'
          ? {label: str((item as Option).label, str((item as Option).value)), value: str((item as Option).value, str((item as Option).label))}
          : {label: str(item), value: str(item)},
      )
    : []

/* ───────────── 输入的回声处理 ─────────────
 * 输入框的值要绕沙盒一圈才回来。直接受控会在打字时被「旧值的回声」顶回去，光标乱跳。
 * 做法：本地先改、立刻显示；沙盒送回来的值，如果是我们刚发出去的，就当回声忽略；
 * 如果是别的值（比如点了「清空」），才采纳。 */

function useEcho<T>(prop: T, send: (value: T) => void) {
  const [local, setLocal] = useState(prop)
  const sent = useRef<T[]>([])
  useEffect(() => {
    if (Object.is(prop, local)) {
      sent.current = []
      return
    }
    if (sent.current.some((value) => Object.is(value, prop))) return
    setLocal(prop)
    // 只在沙盒送来新值时判断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prop])
  const set = (value: T) => {
    sent.current = [...sent.current.slice(-30), value]
    setLocal(value)
    send(value)
  }
  return [local, set] as const
}

/* ───────────── 样式表 ───────────── */

const ALIGN = {start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch'} as const
const JUSTIFY = {start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between'} as const
const SIZE = {xs: 11, sm: 12, md: 14, lg: 18, xl: 24, display: 64} as const
const TONE_COLOR: Record<string, string | undefined> = {
  default: undefined,
  secondary: 'var(--text2)',
  tertiary: 'var(--text3)',
  accent: 'var(--main)',
  danger: 'var(--c-red)',
  success: 'var(--c-green)',
}

/* ───────────── 输入类，单独成组件好用 hooks ───────────── */

function InputField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [value, set] = useEcho(str(p.value), (text) => fire(p.onChange, text))
  const common = {
    value,
    placeholder: str(p.placeholder),
    maxLength: num(p.maxLength, 0, 0, 10000) || undefined,
    onValueChange: set,
    onPressEnter: isHandler(p.onEnter) ? () => fire(p.onEnter) : undefined,
  }
  return p.type === 'password' ? <InputPassword {...common} /> : <Input {...common} />
}

function TextAreaField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [value, set] = useEcho(str(p.value), (text) => fire(p.onChange, text))
  return (
    <TextArea
      value={value}
      placeholder={str(p.placeholder)}
      maxLength={num(p.maxLength, 0, 0, 20000) || undefined}
      autoSize={{minRows: num(p.rows, 3, 2, 12), maxRows: 12}}
      onChange={(event) => set(event.target.value)}
    />
  )
}

function NumberField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [value, set] = useEcho<number | null>(typeof p.value === 'number' ? p.value : null, (n) => fire(p.onChange, n))
  return (
    <InputNumber
      value={value}
      min={typeof p.min === 'number' ? p.min : undefined}
      max={typeof p.max === 'number' ? p.max : undefined}
      step={num(p.step, 1)}
      onChange={(n) => set(typeof n === 'number' ? n : null)}
      style={{width: '100%'}}
    />
  )
}

function SliderField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [value, set] = useEcho(num(p.value, 0), (n) => fire(p.onChange, n))
  return <Slider min={num(p.min, 0)} max={num(p.max, 100)} step={num(p.step, 1, 0.0001)} value={value} onChange={(n) => set(n as number)} />
}

function SwitchField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [checked, set] = useEcho(bool(p.checked), (value) => fire(p.onChange, value))
  const label = str(p.label)
  return (
    <Flexbox horizontal align="center" gap={8}>
      <Switch checked={checked} onChange={set} />
      {label && <Text fontSize={14}>{label}</Text>}
    </Flexbox>
  )
}

function ChoiceField({p, fire, kind}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void; kind: 'select' | 'segmented'}) {
  const list = options(p.options)
  const [value, set] = useEcho(str(p.value), (v) => fire(p.onChange, v))
  return kind === 'select' ? (
    <Select value={value || undefined} options={list} placeholder={str(p.placeholder)} onChange={(v) => set(String(v))} style={{width: '100%'}} />
  ) : (
    <Segmented value={value} options={list} block={bool(p.block)} onChange={(v) => set(String(v))} />
  )
}

const toDate = (text: string, time: boolean): Date | null => {
  if (!text) return null
  const date = new Date(time ? `2000-01-01T${text}:00` : `${text}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}
const pad = (n: number) => String(n).padStart(2, '0')

function DateField({p, fire, time}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void; time: boolean}) {
  const [value, set] = useEcho(str(p.value), (v) => fire(p.onChange, v))
  const Picker = time ? DatePicker.TimePicker : DatePicker
  return (
    <Picker
      locale={datePickerLocaleZhCN}
      style={{width: '100%'}}
      placeholder={str(p.placeholder, time ? '选择时间' : '选择日期')}
      {...(time ? {format: 'HH:mm', needConfirm: false} : {})}
      value={toDate(value, time)}
      onChange={(d: unknown) => {
        const date = d as Date | null
        set(date ? (time ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`) : '')
      }}
    />
  )
}

/* ───────────── 渲染 ───────────── */

function Bars({p}: {p: Record<string, unknown>}) {
  const values = Array.isArray(p.values) ? p.values.slice(0, 60).map((v) => num(v, 0, 0)) : []
  const labels = Array.isArray(p.labels) ? p.labels.map((v) => str(v)) : []
  const peak = Math.max(1, ...values)
  const highlight = typeof p.highlight === 'number' ? p.highlight : -1
  const height = num(p.height, 96, 40, 240)
  return (
    <div className="ap-bars" style={{height}} role="img" aria-label="柱状图">
      {values.map((v, i) => (
        <div key={i} className="ap-bar" data-hot={i === highlight} title={`${labels[i] ?? i + 1}：${v}`}>
          <i style={{height: `${Math.max(3, (v / peak) * 100)}%`}} />
          {labels[i] && <span>{labels[i]}</span>}
        </div>
      ))}
    </div>
  )
}

function Table({p}: {p: Record<string, unknown>}) {
  const columns = Array.isArray(p.columns) ? p.columns.slice(0, 12).map((v) => str(v)) : []
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 200) : []
  return (
    <div className="ap-table-wrap">
      <table className="ap-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {(Array.isArray(row) ? row : []).slice(0, 12).map((cell, c) => (
                <td key={c}>{str(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UiTree({node, fire}: {node: UiNode; fire: Fire}) {
  const send = (handler: unknown, payload?: unknown) => {
    if (isHandler(handler)) fire(handler.$fn, payload)
  }
  const kids = (): ReactNode => node.c.map((child, i) => <UiTree key={str(child.p?.key, String(i))} node={child} fire={fire} />)
  const p = node.p ?? {}

  switch (node.t) {
    case 'Stack': {
      const row = p.direction === 'row'
      return (
        <Flexbox
          horizontal={row}
          gap={num(p.gap, 8, 0, 48)}
          align={ALIGN[pick(p.align, ['start', 'center', 'end', 'stretch'] as const, row ? 'start' : 'stretch')]}
          justify={JUSTIFY[pick(p.justify, ['start', 'center', 'end', 'between'] as const, 'start')]}
          wrap={bool(p.wrap) ? 'wrap' : undefined}
          flex={bool(p.grow) ? 1 : undefined}
          padding={typeof p.padding === 'number' ? num(p.padding, 0, 0, 48) : undefined}
          width={typeof p.width === 'number' ? num(p.width, 0, 0, 2000) : undefined}
          height={typeof p.height === 'number' ? num(p.height, 0, 0, 2000) : undefined}
          style={{minWidth: 0}}
        >
          {kids()}
        </Flexbox>
      )
    }
    case 'Card': {
      const title = str(p.title)
      return (
        <Block
          variant={pick(p.variant, ['outlined', 'filled', 'borderless'] as const, 'outlined')}
          padding={num(p.padding, 16, 0, 32)}
          gap={12}
          clickable={isHandler(p.onClick)}
          onClick={isHandler(p.onClick) ? () => send(p.onClick) : undefined}
        >
          {title && (
            <Text strong fontSize={14}>
              {title}
            </Text>
          )}
          {kids()}
        </Block>
      )
    }
    case 'Grid':
      return (
        <div className="ap-grid" style={{gridTemplateColumns: `repeat(${num(p.columns, 2, 1, 6)}, minmax(0, 1fr))`, gap: num(p.gap, 12, 0, 32)}}>
          {kids()}
        </div>
      )
    case 'Divider':
      return <div className="ap-rule" role="separator" />
    case 'Spacer':
      return <div style={{flex: 1}} />

    case 'Text': {
      const size = pick(p.size, ['xs', 'sm', 'md', 'lg', 'xl', 'display'] as const, 'md')
      const display = size === 'display'
      const style: CSSProperties = {color: TONE_COLOR[str(p.tone, 'default')], minWidth: 0}
      if (bool(p.serif) || display) Object.assign(style, {fontFamily: 'var(--font-serif)', fontVariantNumeric: 'tabular-nums'})
      if (display) Object.assign(style, {lineHeight: 1.05, letterSpacing: '-0.02em'})
      if (bool(p.mono)) style.fontFamily = 'var(--font-mono)'
      const body = str(p.text) || node.c.map((child) => str(child.p?.text)).join('')
      return (
        <Text fontSize={SIZE[size]} strong={bool(p.strong)} ellipsis={bool(p.ellipsis)} align={pick(p.align, ['left', 'center', 'right'] as const, 'left')} style={style}>
          {body}
        </Text>
      )
    }
    case 'Kicker':
      return <span className="ap-kicker">{str(p.text) || node.c.map((child) => str(child.p?.text)).join('')}</span>
    case 'Tag': {
      const Ic = iconOf(p.icon)
      const tone = pick(p.tone, ['default', 'red', 'green', 'blue', 'orange', 'purple'] as const, 'default')
      return (
        <Tag color={tone === 'default' ? undefined : tone} icon={Ic ? <Ic size={12} /> : undefined} variant="borderless">
          {str(p.text)}
        </Tag>
      )
    }
    case 'Statistic':
      return <Statistic title={str(p.title)} value={typeof p.value === 'number' ? p.value : str(p.value)} suffix={str(p.suffix) || undefined} />
    case 'Progress': {
      const tone = pick(p.tone, ['default', 'accent', 'success', 'danger'] as const, 'default')
      return <Progress percent={num(p.percent, 0, 0, 100)} strokeColor={tone === 'default' ? undefined : TONE_COLOR[tone]} />
    }
    case 'Empty':
      return <Empty title={str(p.title, '这里还是空的')} description={str(p.description) || undefined} />
    case 'Icon': {
      const Ic = iconOf(p.name)
      return Ic ? <Ic size={num(p.size, 16, 12, 48)} color={TONE_COLOR[str(p.tone, 'default')]} aria-hidden /> : null
    }
    case 'Bars':
      return <Bars p={p} />
    case 'Table':
      return <Table p={p} />

    case 'Button': {
      const variant = pick(p.variant, ['default', 'primary', 'text', 'dashed'] as const, 'default')
      const Ic = iconOf(p.icon)
      return (
        <Button
          className={variant === 'primary' ? 'ink-button' : undefined}
          type={variant === 'default' ? undefined : variant}
          size={pick(p.size, ['small', 'middle', 'large'] as const, 'middle')}
          danger={bool(p.danger)}
          disabled={bool(p.disabled)}
          block={bool(p.block)}
          icon={Ic ? <Ic size={14} /> : undefined}
          onClick={() => send(p.onClick)}
        >
          {str(p.label)}
        </Button>
      )
    }
    case 'IconButton': {
      const Ic = iconOf(p.icon)
      return Ic ? (
        <ActionIcon icon={Ic} size={pick(p.size, ['small', 'middle', 'large'] as const, 'middle')} active={bool(p.active)} disabled={bool(p.disabled)} aria-label={str(p.label)} title={str(p.label)} onClick={() => send(p.onClick)} />
      ) : null
    }
    case 'Input':
      return <InputField p={p} fire={send} />
    case 'TextArea':
      return <TextAreaField p={p} fire={send} />
    case 'NumberInput':
      return <NumberField p={p} fire={send} />
    case 'Switch':
      return <SwitchField p={p} fire={send} />
    case 'Checkbox':
      return <CheckField p={p} fire={send} />
    case 'Slider':
      return <SliderField p={p} fire={send} />
    case 'Select':
      return <ChoiceField p={p} fire={send} kind="select" />
    case 'Segmented':
      return <ChoiceField p={p} fire={send} kind="segmented" />
    case 'DatePicker':
      return <DateField p={p} fire={send} time={false} />
    case 'TimePicker':
      return <DateField p={p} fire={send} time />

    default:
      return (
        <Text type="danger" fontSize={12}>
          不支持的积木「{node.t}」
        </Text>
      )
  }
}

function CheckField({p, fire}: {p: Record<string, unknown>; fire: (v: unknown, payload?: unknown) => void}) {
  const [checked, set] = useEcho(bool(p.checked), (value) => fire(p.onChange, value))
  return (
    <Checkbox checked={checked} onChange={set}>
      {str(p.label)}
    </Checkbox>
  )
}
