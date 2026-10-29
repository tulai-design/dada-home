import {useEffect, useRef, useState} from 'react'
import {AppWindow, GameController, Gear, House, Monitor, Sparkle, SquaresFour} from '@phosphor-icons/react'
import {pageIcon} from '../lib/pageIcons'
import type {GeneratedApplication, Page} from '../lib/workspace'

type View = 'page' | 'settings' | 'monitor' | 'market' | 'application'

function tone(id: string) {
  let n = 0
  for (const ch of id) n = (n + ch.charCodeAt(0)) % 5
  return String(n)
}

function clockText(date: Date) {
  return date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})
}

/** 主机主屏：页面和应用是横排封面。首页本身的时钟和搜索不铺在这里。 */
export function SwitchHome({
  name,
  pages,
  applications,
  onPage,
  onApplication,
  bindOpen,
}: {
  name: string
  pages: Page[]
  applications: GeneratedApplication[]
  onPage: (id: string) => void
  onApplication: (id: string) => void
  bindOpen: (open: () => void) => void
}) {
  const covers = [
    ...pages.filter((page) => page.id !== 'home').map((page) => ({
      id: page.id,
      name: page.label || page.name,
      icon: page.icon,
      kind: 'page' as const,
    })),
    ...applications.filter((item) => item.dock).map((item) => ({
      id: item.id,
      name: item.instance.title || '应用',
      icon: undefined,
      kind: 'application' as const,
    })),
  ]
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const coversRef = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const startX = useRef(0)
  const selected = covers[Math.min(index, Math.max(covers.length - 1, 0))]
  const open = (cover: (typeof covers)[number]) => (cover.kind === 'page' ? onPage(cover.id) : onApplication(cover.id))
  const initial = name.trim().slice(0, 1) || '搭'

  useEffect(() => {
    bindOpen(() => { if (selected) open(selected) })
  })
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const row = coversRef.current
    if (!row) return
    const onWheel = (event: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      row.scrollLeft += event.deltaY
      event.preventDefault()
    }
    row.addEventListener('wheel', onWheel, {passive: false})
    return () => row.removeEventListener('wheel', onWheel)
  }, [covers.length])
  useEffect(() => {
    coversRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({inline: 'nearest', block: 'nearest'})
  }, [index])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement | null)?.isContentEditable) return
      if (!covers.length) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIndex((value) => Math.min(value + 1, covers.length - 1))
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex((value) => Math.max(value - 1, 0))
      } else if (event.key === 'Enter' && selected && !(event.target as HTMLElement | null)?.closest('.switch-dock')) {
        event.preventDefault()
        open(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="switch-home">
      <header className="switch-status">
        <span className="switch-avatar" title={name}>{initial}</span>
        <time className="switch-clock" dateTime={now.toISOString()}>{clockText(now)}</time>
      </header>
      <div className="switch-stage">
        <div className="switch-title" data-empty={selected ? undefined : 'true'}>{selected?.name ?? '页面会出现在这里'}</div>
        <div
          className="switch-covers"
          role="list"
          ref={coversRef}
          onPointerDown={(event) => { dragged.current = false; startX.current = event.clientX }}
          onPointerMove={(event) => { if (event.buttons && Math.abs(event.clientX - startX.current) > 10) dragged.current = true }}
        >
          {covers.map((cover, coverIndex) => {
            const Icon = cover.kind === 'page' ? pageIcon(cover.icon) : AppWindow
            const on = coverIndex === index
            return (
              <button
                key={`${cover.kind}:${cover.id}`}
                type="button"
                className="switch-cover"
                data-index={coverIndex}
                data-on={on ? 'true' : 'false'}
                aria-current={on || undefined}
                aria-label={on ? `${cover.name}，打开` : cover.name}
                onClick={() => {
                  if (dragged.current) return
                  if (on) open(cover)
                  else setIndex(coverIndex)
                }}
              >
                <span className="switch-cover-art" data-tone={tone(cover.id)}>
                  <Icon size={64} weight="fill" />
                  <span className="switch-cover-label">{cover.name}</span>
                </span>
              </button>
            )
          })}
          {!covers.length && (
            <div className="switch-cover switch-cover-empty" aria-hidden="true">
              <span className="switch-cover-art" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 底部圆形系统图标。主屏时是白底圆钮，选中的上方有一个点。 */
export function SwitchDock({
  view,
  board,
  monitorInstalled,
  onBoard,
  onAssistant,
  onMarket,
  onMonitor,
  onSettings,
  onStart,
}: {
  view: View
  board: boolean
  monitorInstalled: boolean
  onBoard: () => void
  onAssistant: () => void
  onMarket: () => void
  onMonitor: () => void
  onSettings: () => void
  onStart?: () => void
}) {
  const items = [
    {id: 'board', name: '主屏', icon: House, on: board && view === 'page', run: onBoard},
    {id: 'ai', name: '搭搭', icon: Sparkle, on: false, run: onAssistant},
    {id: 'market', name: '市场', icon: SquaresFour, on: view === 'market', run: onMarket},
    ...(monitorInstalled ? [{id: 'monitor', name: '监控', icon: Monitor, on: view === 'monitor', run: onMonitor}] : []),
    {id: 'settings', name: '设置', icon: Gear, on: view === 'settings', run: onSettings},
  ]
  const home = board && view === 'page'
  return (
    <nav className="switch-dock" data-board={home || undefined} aria-label="主机菜单">
      <div className="switch-dock-orbs">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} type="button" className="switch-dock-btn" data-id={item.id} data-on={item.on ? 'true' : 'false'} aria-current={item.on || undefined} aria-label={item.name} onClick={item.run}>
              <span className="switch-orb">
                <Icon size={26} weight={item.on ? 'fill' : 'regular'} />
              </span>
              <span className="switch-dock-name">{item.name}</span>
            </button>
          )
        })}
      </div>
      {home ? (
        <div className="switch-dock-foot">
          <span className="switch-dock-mark" aria-hidden="true"><GameController size={18} /></span>
          <button type="button" className="switch-start" onClick={onStart} disabled={!onStart}>
            <span className="switch-start-key" aria-hidden="true">A</span>
            打开
          </button>
        </div>
      ) : (
        <span className="switch-dock-mark" aria-hidden="true"><GameController size={18} /></span>
      )}
    </nav>
  )
}
