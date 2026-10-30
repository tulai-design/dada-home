import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionIcon, Badge, Button } from '@lobehub/ui'
import {AppWindow, DotsThree as Ellipsis, SquaresFour as LayoutGrid, Monitor, Gear as Settings, Sparkle as Sparkles} from '@phosphor-icons/react'
import { scopeDockCss, DEFAULT_DOCK_PRESET } from '../lib/dock'
import { pageIcon } from '../lib/pageIcons'
import { useIsMobile } from '../lib/useMedia'
import {navigationKey, type NavigationEntry} from '../lib/shell/navigation'
import type {ShellAdapterProps} from './shell/contracts'

/** 一个导航项占的高度（含间距），dock.css 里是 --dock-pitch，量不到就用这个。 */
const SLOT_PITCH = 48
/** 手机底栏每个入口的宽度。 */
const MOBILE_SLOT_WIDTH = 56
/** 手机底栏最宽 380，两侧各留 12。 */
const MOBILE_DOCK_MAX = 380

/**
 * Dock：电脑上是左侧悬浮的一列，手机上是底部悬浮的一排。只有图标，名字在提示里。
 * 默认是「拟态液体玻璃」；纸质卡片和通栏是可选预设。样式见 dock.css，
 * 也可以换预设，或者让搭搭写一份全新的 CSS（lib/dock.ts）。
 *
 *   ┌ 首页                     固定：始终第一个，不可改
 *   │ 页面 / 固定应用 …        按顺序排，放不下的自动收进「更多」
 *   │ 更多                     查看所有页面和固定应用
 *   └ AI / 监控* / 市场 / 设置   固定（* 监控装了才有）
 *
 * 页面很多时不靠滚动条：量一下中间区域能放几项，放不下的折进「更多」，
 * 当前所在页面始终可见。页面的增删、排序、改名在 设置 › 侧栏，或直接对搭搭说。
 */
export function Rail({model, dispatch}: Pick<ShellAdapterProps, 'model' | 'dispatch'>) {
  const {entries, activation, dock, badges} = model
  const assistantBusy = model.assistant.busy
  const home = entries.find((item) => item.home)
  const rest = useMemo(() => entries.filter((item) => !item.home && item.pinned && item.target.kind !== 'system'), [entries])
  const selectedId = navigationKey(activation.target)
  const view = activation.target.kind === 'system' ? activation.target.name : activation.target.kind
  const navigationCount = entries.filter((item) => item.target.kind !== 'system').length
  const hasUnpinnedPages = entries.some((item) => item.target.kind !== 'system' && !item.home && !item.pinned)
  const monitorInstalled = entries.some((item) => item.key === 'system:monitor')
  const onMore = () => dispatch({type: 'all-navigation'})
  const onAssistant = () => dispatch({type: 'assistant', action: 'toggle-preferred'})
  const onLogo = () => dispatch({type: 'assistant', action: 'open-panel'})
  const onMonitor = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'monitor'}})
  const onMarket = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'market'}})
  const onSettings = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'settings'}})

  const mobile = useIsMobile()
  const shellRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLElement>(null)
  const lastOn = useRef<Element | null>(null)
  const [capacity, setCapacity] = useState(99)

  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => {
      if (mobile) {
        // 手机：横排。扣掉两侧留白后，除掉首页、AI、更多三个固定位，剩下的放页面
        const width = Math.min(el.clientWidth - 24, MOBILE_DOCK_MAX) - 20
        setCapacity(Math.max(0, Math.floor(width / MOBILE_SLOT_WIDTH) - 3))
        return
      }
      // 电脑：竖排。总高度扣掉上下各给 logo 让出的位置、胶囊内边距、分隔线，再扣掉首页和底部固定入口
      const pitch = parseFloat(getComputedStyle(el).getPropertyValue('--dock-pitch')) || SLOT_PITCH
      const fixed = 1 + 1 + (monitorInstalled ? 1 : 0) + 2
      const chrome = 80 * 2 + 24 + 14
      setCapacity(Math.max(0, Math.floor((el.clientHeight - chrome) / pitch) - fixed))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [mobile, monitorInstalled])

  // 把滑块放到当前页的入口底下。直接改 CSS 变量，不走 React 状态，避免多渲染一轮
  const placeGlider = () => {
    const box = dockRef.current
    const glider = gliderRef.current
    if (!box || !glider) return
    const on = box.querySelector<HTMLElement>('.rail-btn[data-on="true"]')
    if (!on) {
      box.style.setProperty('--go', '0')
      lastOn.current = null
      return
    }
    const outer = box.getBoundingClientRect()
    const inner = on.getBoundingClientRect()
    let x: number
    let y: number
    let w: number
    let h: number
    if (mobile) {
      // 手机：一块扁一点的玻璃，整个落在胶囊里面，宽度跟着入口走但不超过 76
      const slot = on.closest('.rail-slot')?.getBoundingClientRect() ?? inner
      w = Math.min(Math.max(slot.width - 8, inner.width), 76)
      h = 38
      x = slot.left + slot.width / 2 - w / 2 - outer.left - box.clientLeft
      y = inner.top + inner.height / 2 - h / 2 - outer.top - box.clientTop
    } else {
      // 电脑：比按钮四周各大一圈，像是托住它
      const pad = 4
      x = inner.left - outer.left - box.clientLeft - pad
      y = inner.top - outer.top - box.clientTop - pad
      w = inner.width + pad * 2
      h = inner.height + pad * 2
    }
    box.style.setProperty('--gx', `${x}px`)
    box.style.setProperty('--gy', `${y}px`)
    box.style.setProperty('--gw', `${w}px`)
    box.style.setProperty('--gh', `${h}px`)
    box.style.setProperty('--go', '1')
    // 换了入口：沿移动方向挤一下再弹回来，像液体被拉了一把
    if (lastOn.current && lastOn.current !== on && box.dataset.ready === 'true' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const squish = mobile ? '1.2 1' : '1 1.2'
      glider.animate([{ scale: '1 1' }, { scale: squish }, { scale: '1 1' }], { duration: 440, easing: 'ease' })
    }
    lastOn.current = on
  }
  useLayoutEffect(() => {
    placeGlider()
    const box = dockRef.current
    if (!box) return
    // 第一次摆好之后再打开过渡，不然进来时滑块会从角落飞过来
    const frame = requestAnimationFrame(() => {
      box.dataset.ready = 'true'
    })
    const observer = new ResizeObserver(placeGlider)
    observer.observe(box)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      gliderRef.current?.getAnimations().forEach((animation) => animation.cancel())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile])
  // 页面、视图、入口数量变了，当前入口的位置也会变
  useLayoutEffect(placeGlider)

  // 放得下就全放；放不下留一格给「更多」，并保证当前页可见
  const overflow = rest.length + (hasUnpinnedPages ? 1 : 0) > capacity
  let shown = rest
  if (overflow) {
    const slots = Math.max(0, capacity - 1)
    shown = rest.slice(0, slots)
    const active = rest.findIndex((item) => item.key === selectedId)
    if (active >= slots && slots > 0) shown = [...shown.slice(0, slots - 1), rest[active]]
    else if (active >= slots) shown = [rest[active]].slice(0, slots)
  }
  const hidden = rest.length - shown.length

  const entry = (key: string, title: string, Icon: typeof Sparkles, on: boolean, onClick: () => void, extra?: { busy?: boolean; count?: number }) => {
    const control = (
      <ActionIcon
        className="rail-btn"
        icon={Icon}
        title={title}
        tooltipProps={{ placement: mobile ? 'top' : 'right', mouseEnterDelay: 0.1 }}
        size={{ blockSize: mobile ? 48 : 40, size: 19, borderRadius: 99 }}
        data-on={on}
        data-busy={extra?.busy ? 'true' : undefined}
        aria-label={title}
        aria-current={on ? 'page' : undefined}
        onClick={onClick}
      />
    )
    return (
      <div key={key} className="rail-slot">
        {extra?.count ? (
          <Badge count={extra.count} size="small">
            {control}
          </Badge>
        ) : (
          control
        )}
      </div>
    )
  }

  const pageEntry = (item: NavigationEntry) =>
    entry(item.key, item.label, item.icon.kind === 'application' ? AppWindow : pageIcon(item.icon.kind === 'page' ? item.icon.name : undefined), selectedId === item.key, () => dispatch({type: 'navigate', target: item.target}), {count: badges?.[item.target.kind !== 'system' ? item.target.id : item.key]})

  // 手机：页面放不下的收进「更多」，那里也有市场、监控、设置
  let top: ReactNode
  let mid: ReactNode
  let bottom: ReactNode
  if (mobile) {
    const slots = Math.max(0, capacity)
    let tabs = rest
    if (rest.length > slots) {
      tabs = rest.slice(0, slots)
      const active = rest.findIndex((item) => item.key === selectedId)
      if (active >= slots && slots > 0) tabs = [...tabs.slice(0, slots - 1), rest[active]]
      else if (active >= slots) tabs = []
    }
    top = home && pageEntry(home)
    mid = tabs.map(pageEntry)
    bottom = (
      <>
        {entry('ai', '搭搭 AI', Sparkles, false, onAssistant, { busy: assistantBusy })}
        {entry('more', `更多（${navigationCount} 个页面与应用）`, Ellipsis, view !== 'page' && view !== undefined, onMore)}
      </>
    )
  } else {
    top = home && pageEntry(home)
    mid = (
      <>
        {shown.map(pageEntry)}
        {(overflow || hidden > 0 || hasUnpinnedPages) && entry('more', `页面与应用（${navigationCount}）`, Ellipsis, false, onMore)}
      </>
    )
    bottom = (
      <>
        {entry('ai', '搭搭 AI', Sparkles, false, onAssistant, { busy: assistantBusy })}
        {monitorInstalled && entry('monitor', '服务监控', Monitor, view === 'monitor', onMonitor)}
        {entry('market', '组件市场', LayoutGrid, view === 'market', onMarket)}
        {entry('settings', '设置', Settings, view === 'settings', onSettings)}
      </>
    )
  }

  const scoped = useMemo(() => (dock?.css ? scopeDockCss(dock.css) : null), [dock?.css])

  return (
    <nav
      className="dock-shell"
      ref={shellRef}
      data-dock={dock?.preset ?? DEFAULT_DOCK_PRESET}
      data-orient={mobile ? 'horizontal' : 'vertical'}
      aria-label={mobile ? '底部导航' : '侧边导航'}
    >
      {scoped?.ok && <style data-dock-custom="">{scoped.css}</style>}
      {/* 电脑上 logo 放在窗口左上角，不在 Dock 里面 */}
      {!mobile && (
        <Button className="dock-logo" type="text" onClick={onLogo} aria-label="打开搭搭助手" title="打开搭搭助手">
          <img className="dock-logo-img" src={`${import.meta.env.BASE_URL}brand/dada-logo.png`} alt="" width={56} height={56} draggable={false} />
        </Button>
      )}
      <div className="dock" ref={dockRef}>
        <i className="dock-glider" ref={gliderRef} aria-hidden="true" />
        <div className="dock-group dock-top">{top}</div>
        <div className="dock-group dock-mid">{mid}</div>
        <div className="dock-group dock-bottom">{bottom}</div>
      </div>
      {/* 液体玻璃的扭曲滤镜：backdrop-filter 里用 url(#dock-liquid-glass) 引用它 */}
      <div className="dock-filter" aria-hidden="true">
        <svg focusable="false">
          <filter id="dock-liquid-glass" x="-20%" y="-20%" width="140%" height="140%" primitiveUnits="objectBoundingBox">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.07" numOctaves={2} seed={8} result="map" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.002" result="blur" />
            <feDisplacementMap in="blur" in2="map" scale="0.05" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      </div>
    </nav>
  )
}
