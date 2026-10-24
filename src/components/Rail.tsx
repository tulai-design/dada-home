import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button } from '@lobehub/ui'
import { Ellipsis, LayoutGrid, Monitor, Settings, Sparkles } from 'lucide-react'
import { pageIcon } from '../lib/pageIcons'
import { FROZEN_PAGE_ID, type Page } from '../lib/workspace'

/** 一个导航项占的高度（theme.css 里 .rail-slot 固定为 48）；实际以量到的为准。 */
const SLOT_HEIGHT = 48

type View = 'page' | 'settings' | 'monitor' | 'market'

/**
 * 侧栏：只有图标，名字在鼠标移上去的提示里。
 *
 *   ┌ 首页                     固定：始终第一个，不可改
 *   │ 页面 …                   可编辑：按顺序排，放不下的自动收进「更多」
 *   │ 更多                     打开「全部页面」切换器
 *   └ AI / 监控* / 市场 / 设置   固定（* 监控装了才有）
 *
 * 页面很多时不靠滚动条：量一下中间区域能放几项，放不下的折进「更多」，
 * 当前所在页面始终可见。页面的增删、排序、改名在 设置 › 侧栏，或直接对搭搭说。
 */
export function Rail({
  pages,
  page,
  view = 'page',
  onPage,
  onMore,
  onAssistant,
  onMonitor,
  onMarket,
  onSettings,
  monitorInstalled,
  badges,
  assistantBusy,
}: {
  pages: Page[]
  page: string
  /** 画布当前显示的是页面还是系统页 */
  view?: View
  onPage: (id: string) => void
  /** 打开「全部页面」切换器 */
  onMore: () => void
  onAssistant: () => void
  /** AI 正在工作，入口上显示一个提示点 */
  assistantBusy?: boolean
  onMonitor: () => void
  onMarket: () => void
  onSettings: () => void
  /** 监控是市场组件，装了才出现入口 */
  monitorInstalled: boolean
  /** 页面 id → 角标数字，由调用方按需提供。 */
  badges?: Record<string, number>
}) {
  const home = pages.find((item) => item.id === FROZEN_PAGE_ID) ?? pages[0]
  const rest = useMemo(() => pages.filter((item) => item.id !== home?.id), [pages, home])

  const midRef = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(99)
  useLayoutEffect(() => {
    const el = midRef.current
    if (!el) return
    const measure = () => {
      const slot = el.closest('.rail')?.querySelector('.rail-slot')
      const height = slot?.getBoundingClientRect().height || SLOT_HEIGHT
      setCapacity(Math.max(0, Math.floor(el.clientHeight / height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 放得下就全放；放不下留一格给「更多」，并保证当前页可见
  const overflow = rest.length > capacity
  let shown = rest
  if (overflow) {
    const slots = Math.max(0, capacity - 1)
    shown = rest.slice(0, slots)
    const active = rest.findIndex((item) => item.id === page)
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
        tooltipProps={{ placement: 'right', mouseEnterDelay: 0.1 }}
        size={{ blockSize: 40, size: 19, borderRadius: 12 }}
        active={on}
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

  const pageEntry = (item: Page) =>
    entry(item.id, item.name, pageIcon(item.icon), view === 'page' && page === item.id, () => onPage(item.id), { count: badges?.[item.id] })

  return (
    <nav className="rail" aria-label="侧边导航">
      <Button className="rail-logo" type="text" onClick={() => home && onPage(home.id)} aria-label="搭搭">
        搭
      </Button>

      {home && <div className="rail-fixed">{pageEntry(home)}</div>}

      <div className="rail-mid" ref={midRef}>
        <div className="rail-nav">
          {shown.map(pageEntry)}
          {(overflow || hidden > 0) && entry('more', `全部页面（${pages.length}）`, Ellipsis, false, onMore)}
        </div>
      </div>

      <div className="rail-fixed">
        {entry('ai', '搭搭 AI', Sparkles, false, onAssistant, { busy: assistantBusy })}
        {monitorInstalled && entry('monitor', '服务监控', Monitor, view === 'monitor', onMonitor)}
        {entry('market', '组件市场', LayoutGrid, view === 'market', onMarket)}
        {entry('settings', '设置', Settings, view === 'settings', onSettings)}
      </div>
    </nav>
  )
}
