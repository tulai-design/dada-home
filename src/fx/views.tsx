/**
 * 素材库渲染层：把目录里的 id 映射到真实组件。
 *
 * 每个效果都是 React.lazy —— 只有页面真的用到它时才下载代码，
 * 所以素材库再大，首屏也不会变重。
 *
 * 约定：传给这里的 params 已经过 catalog.normalizeParams 校验，可以直接展开。
 */

import {lazy, type ComponentType, type CSSProperties, type LazyExoticComponent, type ReactNode} from 'react'

export type FxViewProps = {
  /** 文字内容（文字/卡片/轮播类使用） */
  text: string
  /** 已校验的参数 */
  p: Record<string, unknown>
  /** 当前是否暗色主题，用来选 lightMode 等 */
  dark: boolean
}

type Any = ComponentType<Record<string, unknown>>

/** 排版类参数由外层容器处理，不应再传进组件。 */
const TYPE_KEYS = new Set(['size', 'weight', 'font', 'align', 'color'])

function rest(p: Record<string, unknown>, ...also: string[]): Record<string, unknown> {
  const skip = new Set([...TYPE_KEYS, ...also])
  return Object.fromEntries(Object.entries(p).filter(([key]) => !skip.has(key)))
}

/** 背景类：去掉只属于外层横幅的参数。 */
const bg = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'textColor' && key !== 'textSize'))

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** #rgb / #rrggbb → [0..1, 0..1, 0..1]，供要求数组颜色的组件使用。 */
function rgb(hex: unknown, fallback: [number, number, number] = [1, 1, 1]): [number, number, number] {
  if (typeof hex !== 'string') return fallback
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return fallback
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

/** 画布类组件要真实的字体名，读 CSS 变量取值。 */
export function fontStack(font: unknown): string {
  const name = font === 'mono' ? '--font-mono' : font === 'sans' ? '--font-sans' : '--font-serif'
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'serif'
}

function view(load: () => Promise<{default: unknown}>, render: (C: Any, props: FxViewProps) => ReactNode): LazyExoticComponent<ComponentType<FxViewProps>> {
  return lazy(async () => {
    const mod = await load()
    const C = mod.default as unknown as Any
    return {default: (props: FxViewProps) => <>{render(C, props)}</>}
  })
}

/** 带 lightMode 的背景：亮色主题自动开启，除非 AI 明确指定。 */
const light = (dark: boolean) => ({lightMode: !dark})

export const VIEWS: Record<string, LazyExoticComponent<ComponentType<FxViewProps>>> = {
  // ───── 背景 ─────
  aurora: view(() => import('./vendor/Aurora'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  silk: view(() => import('./vendor/Silk'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  beams: view(() => import('./vendor/Beams'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  galaxy: view(() => import('./vendor/Galaxy'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  iridescence: view(() => import('./vendor/Iridescence'), (C, {p}) => <C {...bg(p)} color={rgb(p.color)} />),
  'liquid-chrome': view(() => import('./vendor/LiquidChrome'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  orb: view(() => import('./vendor/Orb'), (C, {p}) => <C {...bg(p)} />),
  particles: view(() => import('./vendor/Particles'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  threads: view(
    () => import('./vendor/Threads'),
    (C, {p}) => <C {...bg(p)} color={rgb(p.color)} accentColor={p.accentColor ? rgb(p.accentColor) : undefined} />,
  ),
  waves: view(() => import('./vendor/Waves'), (C, {p, dark}) => <C {...light(dark)} {...bg(p)} />),
  'dot-grid': view(() => import('./vendor/DotGrid'), (C, {p}) => <C {...bg(p)} />),

  // ───── 文字 ─────
  'split-text': view(
    () => import('./vendor/SplitText'),
    (C, {p, text}) => <C {...rest(p, 'color')} color={p.color} text={text} tag="div" textAlign={p.align} />,
  ),
  'blur-text': view(() => import('./vendor/BlurText'), (C, {p, text}) => <C {...rest(p, 'color')} color={p.color} text={text} />),
  'shiny-text': view(() => import('./vendor/ShinyText'), (C, {p, text}) => <C {...rest(p, 'color')} color={p.color} text={text} />),
  'gradient-text': view(() => import('./vendor/GradientText'), (C, {p, text}) => <C {...rest(p)}>{text}</C>),
  'decrypted-text': view(() => import('./vendor/DecryptedText'), (C, {p, text}) => <C {...rest(p)} text={text} />),
  'text-type': view(
    () => import('./vendor/TextType'),
    (C, {p, text}) => <C {...rest(p)} text={lines(text).length ? lines(text) : [text]} as="div" />,
  ),
  'rotating-text': view(() => import('./vendor/RotatingText'), (C, {p, text}) => <C {...rest(p)} texts={lines(text)} />),
  'count-up': view(
    () => import('./vendor/CountUp'),
    (C, {p, text}) => <C {...rest(p)} to={Number.parseFloat(text.replace(/[^0-9.\-]/g, '')) || 0} />,
  ),
  'fuzzy-text': view(
    () => import('./vendor/FuzzyText'),
    (C, {p, text}) => (
      <C
        {...rest(p, 'gradient')}
        gradient={Array.isArray(p.gradient) ? p.gradient : null}
        color={p.color ?? 'currentColor'}
        fontSize={Number(p.size) || 96}
        fontWeight={Number(p.weight) || 900}
        fontFamily={fontStack(p.font)}
      >
        {text}
      </C>
    ),
  ),
  'scroll-velocity': view(
    () => import('./vendor/ScrollVelocity'),
    (C, {p, text}) => (
      <C
        {...rest(p, 'separator')}
        separator={p.separator ? <span style={{padding: '0 0.4em', opacity: 0.5}}>{String(p.separator)}</span> : undefined}
        texts={lines(text)}
        color={p.color}
        fontSize={Number(p.size) || 72}
        fontWeight={Number(p.weight) || 800}
      />
    ),
  ),

  // ───── 卡片 ─────
  'spotlight-card': view(
    () => import('./vendor/SpotlightCard'),
    (C, {p, text, dark}) => {
      const [title, ...body] = lines(text)
      return (
        <C {...rest(p)} theme={dark ? 'dark' : 'light'} style={{height: '100%'}}>
          <CardText title={title} body={body} p={p} />
        </C>
      )
    },
  ),
  'glare-hover': view(
    () => import('./vendor/GlareHover'),
    (C, {p, text}) => {
      const [title, ...body] = lines(text)
      return (
        <C {...rest(p)} width="100%" height="100%" borderRadius="0px">
          <CardText title={title} body={body} p={p} />
        </C>
      )
    },
  ),

  // ───── 3D：地址在目录里已限定为 spline.design 官方域 ─────
  spline: view(
    () => import('@splinetool/react-spline'),
    (C, {p}) => <C scene={String(p.scene ?? '')} style={{width: '100%', height: '100%'}} />,
  ),

  // ───── 整页叠加层 ─────
  noise: view(() => import('./vendor/Noise'), (C, {p}) => <C {...p} />),
}

/** 卡片内的标题 + 正文，沿用文字排版参数。 */
function CardText({title, body, p}: {title?: string; body: string[]; p: Record<string, unknown>}) {
  const style: CSSProperties = {
    fontFamily: `var(--font-${p.font === 'mono' ? 'mono' : p.font === 'sans' ? 'sans' : 'serif'})`,
    textAlign: (p.align as CSSProperties['textAlign']) ?? 'left',
    color: typeof p.color === 'string' ? p.color : undefined,
  }
  return (
    <div className="fx-card-text" style={style}>
      {title && (
        <div className="fx-card-title" style={{fontSize: Number(p.size) || 22, fontWeight: Number(p.weight) || 600}}>
          {title}
        </div>
      )}
      {body.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  )
}
