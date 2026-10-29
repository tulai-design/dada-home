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

/** 主机主屏：页面和应用是横排封面。首页本身的时钟和搜索不铺在这里。 */
export function SwitchHome({
  pages,
  applications,
  onPage,
  onApplication,
}: {
  pages: Page[]
  applications: GeneratedApplication[]
  onPage: (id: string) => void
  onApplication: (id: string) => void
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
  const homeRef = useRef<HTMLDivElement>(null)
  const selected = covers[Math.min(index, Math.max(covers.length - 1, 0))]
  const open = (cover: (typeof covers)[number]) => (cover.kind === 'page' ? onPage(cover.id) : onApplication(cover.id))

  useEffect(() => {
    homeRef.current?.focus()
  }, [])
  useEffect(() => {
    homeRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({inline: 'nearest', block: 'nearest'})
  }, [index])

  return (
    <div
      className="switch-home"
      ref={homeRef}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!covers.length) return
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          setIndex((value) => Math.min(value + 1, covers.length - 1))
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          setIndex((value) => Math.max(value - 1, 0))
        } else if (event.key === 'Enter' && selected) {
          event.preventDefault()
          open(selected)
        }
      }}
    >
      <div className="switch-title" data-empty={selected ? undefined : 'true'}>{selected?.name ?? '页面会出现在这里'}</div>
      <div className="switch-covers" role="list">
        {covers.map((cover, coverIndex) => {
          const Icon = cover.kind === 'page' ? pageIcon(cover.icon) : AppWindow
          const on = coverIndex === index
          return (
            <button
              key={`${cover.kind}:${cover.id}`}
              type="button"
              className="switch-cover"
              role="listitem"
              data-index={coverIndex}
              data-on={on ? 'true' : 'false'}
              aria-current={on || undefined}
              aria-label={cover.name}
              onMouseEnter={() => setIndex(coverIndex)}
              onFocus={() => setIndex(coverIndex)}
              onClick={() => open(cover)}
            >
              <span className="switch-cover-art" data-tone={tone(cover.id)}>
                <Icon size={54} weight="fill" />
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
  )
}

/** 底部圆形系统图标。选中的那颗有色环，名字写在下面。 */
export function SwitchDock({
  view,
  board,
  monitorInstalled,
  onBoard,
  onAssistant,
  onMarket,
  onMonitor,
  onSettings,
}: {
  view: View
  board: boolean
  monitorInstalled: boolean
  onBoard: () => void
  onAssistant: () => void
  onMarket: () => void
  onMonitor: () => void
  onSettings: () => void
}) {
  const items = [
    {id: 'board', name: '主屏', icon: House, on: board && view === 'page', run: onBoard},
    {id: 'ai', name: '搭搭', icon: Sparkle, on: false, run: onAssistant},
    {id: 'market', name: '市场', icon: SquaresFour, on: view === 'market', run: onMarket},
    ...(monitorInstalled ? [{id: 'monitor', name: '监控', icon: Monitor, on: view === 'monitor', run: onMonitor}] : []),
    {id: 'settings', name: '设置', icon: Gear, on: view === 'settings', run: onSettings},
  ]
  return (
    <nav className="switch-dock" aria-label="主机菜单">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button key={item.id} type="button" className="switch-dock-btn" data-on={item.on ? 'true' : 'false'} aria-current={item.on || undefined} onClick={item.run}>
            <span className="switch-orb">
              <Icon size={26} weight={item.on ? 'fill' : 'regular'} />
            </span>
            <span className="switch-dock-name">{item.name}</span>
          </button>
        )
      })}
      <span className="switch-dock-mark" aria-hidden="true">
        <GameController size={18} />
      </span>
    </nav>
  )
}
