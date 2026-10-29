import {useEffect, useId, useRef, useState, type KeyboardEvent} from 'react'
import {AppWindow, ArrowSquareOut, CopySimple, Desktop, Gear, House, Minus, Monitor, Moon, Square, SquaresFour, Sun, X} from '@phosphor-icons/react'
import {useNow} from '../hooks'
import {pageIcon} from '../lib/pageIcons'
import type {GeneratedApplication, Page} from '../lib/workspace'
import '../win98-shell.css'

export type Win98NavigationProps = {
  pages: Page[]
  applications: GeneratedApplication[]
  onPage: (id: string) => void
  onApplication: (id: string) => void
  onAssistant: () => void
  onMarket: () => void
  onSettings: () => void
  onMonitor?: () => void
}

type DesktopEntry = {
  id: string
  label: string
  icon: typeof AppWindow | null
  kind: 'page' | 'application' | 'system'
  run: () => void
}

/** 桌面仅显示固定入口，开始菜单可访问所有真实页面和应用。 */
function navigationEntries(props: Win98NavigationProps, desktop: boolean): DesktopEntry[] {
  return [
    ...props.pages.filter((page) => !desktop || page.id === 'home' || page.dock !== false).map((page) => ({
      id: `page:${page.id}`,
      label: page.id === 'home' ? '我的主页' : page.label || page.name,
      icon: page.id === 'home' ? House : pageIcon(page.icon),
      kind: 'page' as const,
      run: () => props.onPage(page.id),
    })),
    ...props.applications.filter((application) => !desktop || application.dock).map((application) => ({
      id: `application:${application.id}`,
      label: application.instance.title || '应用',
      icon: AppWindow,
      kind: 'application' as const,
      run: () => props.onApplication(application.id),
    })),
    {id: 'assistant', label: '搭搭', icon: null, kind: 'system', run: props.onAssistant},
    {id: 'market', label: '组件市场', icon: SquaresFour, kind: 'system', run: props.onMarket},
    ...(props.onMonitor ? [{id: 'monitor', label: '服务监控', icon: Monitor, kind: 'system' as const, run: props.onMonitor}] : []),
    {id: 'settings', label: '控制面板', icon: Gear, kind: 'system', run: props.onSettings},
  ]
}

function EntryIcon({entry}: {entry: DesktopEntry}) {
  const Icon = entry.icon
  return Icon ? <Icon weight="duotone" aria-hidden="true" />
    : <img src={`${import.meta.env.BASE_URL}brand/dada-logo.png`} alt="" draggable={false} />
}

/** 桌面选择只影响外壳；打开入口交给宿主，保持原页面和应用的数据身份。 */
export function Win98Desktop(props: Win98NavigationProps) {
  const entries = navigationEntries(props, true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pointerType = useRef('mouse')
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId))

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.win98-desktop-item')]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
    if (event.key.startsWith('Arrow')) {
      const current = buttons[index].getBoundingClientRect()
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      const candidates = buttons.map((button, candidate) => {
        const rect = button.getBoundingClientRect()
        const along = horizontal ? rect.x - current.x : rect.y - current.y
        const across = Math.abs(horizontal ? rect.y - current.y : rect.x - current.x)
        return {candidate, along, score: Math.abs(along) + across * 4}
      }).filter(({along}) => forward ? along > 1 : along < -1).sort((a, b) => a.score - b.score)
      next = candidates[0]?.candidate ?? index
    }
    if (next < 0 || !entries[next]) return
    event.preventDefault()
    setSelectedId(entries[next].id)
    buttons[next]?.focus()
  }

  return (
    <section className="win98-desktop" aria-label="Windows 98 桌面">
      <ul className="win98-desktop-icons" onKeyDown={onKeyDown} aria-label="桌面快捷方式">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              className="win98-desktop-item"
              data-id={entry.id}
              data-kind={entry.kind}
              data-selected={index === selectedIndex || undefined}
              aria-label={entry.label}
              aria-pressed={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
              onPointerDown={(event) => { pointerType.current = event.pointerType }}
              onFocus={() => setSelectedId(entry.id)}
              onClick={(event) => {
                setSelectedId(entry.id)
                if (event.detail === 0 || pointerType.current === 'touch' || pointerType.current === 'pen') entry.run()
              }}
              onDoubleClick={(event) => { if (pointerType.current === 'mouse' && event.detail === 2) entry.run() }}
            >
              <span className="win98-desktop-icon"><EntryIcon entry={entry} /><ArrowSquareOut className="win98-shortcut" aria-hidden="true" /></span>
              <span className="win98-desktop-label">{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Win98Taskbar({title, windowOpen, desktop, onRestore, onDesktop, mode, onTheme, assistantOpen, ...navigation}: Win98NavigationProps & {
  title: string
  windowOpen: boolean
  desktop: boolean
  onRestore: () => void
  onDesktop: () => void
  mode: 'light' | 'dark'
  onTheme: () => void
  assistantOpen?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const now = useNow(1000)
  const entries = navigationEntries(navigation, false)
  const closeMenu = () => {
    setMenuOpen(false)
    startRef.current?.focus({preventScroll: true})
  }

  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target) || startRef.current?.contains(event.target)) return
      setMenuOpen(false)
      startRef.current?.focus({preventScroll: true})
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      startRef.current?.focus({preventScroll: true})
    }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menuOpen])

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const index = items.indexOf(event.target as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next !== null) { event.preventDefault(); items[next]?.focus() }
    else if (event.key === 'Tab') setMenuOpen(false)
  }

  return (
    <nav className="win98-taskbar" aria-label="任务栏">
      <button ref={startRef} type="button" className="win98-start win98-raised" aria-label="开始菜单" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} data-pressed={menuOpen || undefined} onClick={() => setMenuOpen((open) => !open)} onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true) }
      }}>
        <img src={`${import.meta.env.BASE_URL}brand/dada-logo.png`} alt="" draggable={false} /><b>开始</b>
      </button>
      {menuOpen && (
        <div className="win98-start-menu win98-raised" id={menuId} role="menu" aria-label="开始" ref={menuRef} onKeyDown={onMenuKey}>
          <div className="win98-menu-brand" aria-hidden="true"><span>搭搭 <b>98</b></span></div>
          <div className="win98-menu-items" role="none">
            {entries.map((entry, index) => (
              <div key={entry.id} role="none">
                {index > 0 && entries[index - 1].kind !== entry.kind && <div className="win98-menu-separator" role="separator" />}
                <button type="button" className="win98-menu-item" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); entry.run() }}>
                  <span className="win98-menu-icon"><EntryIcon entry={entry} /></span><span>{entry.label}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <span className="win98-taskbar-divider" aria-hidden="true" />
      <button type="button" className="win98-task-quick" aria-label="显示桌面" title="显示桌面" onClick={onDesktop}><Desktop weight="duotone" aria-hidden="true" /></button>
      <button type="button" className="win98-task-quick win98-assistant-quick" aria-label="搭搭助手" title="搭搭助手" aria-pressed={assistantOpen || false} onClick={navigation.onAssistant}><img src={`${import.meta.env.BASE_URL}brand/dada-logo.png`} alt="" draggable={false} /></button>
      <span className="win98-taskbar-divider" aria-hidden="true" />
      <div className="win98-task-list">
        {windowOpen && <button type="button" className="win98-task-current win98-raised" data-pressed={!desktop || undefined} aria-label={`${desktop ? '恢复' : '最小化'}${title}`} onClick={desktop ? onRestore : onDesktop}>
          <AppWindow weight="duotone" aria-hidden="true" /><span>{title}</span>
        </button>}
      </div>
      <div className="win98-tray">
        <button type="button" className="win98-theme-toggle" aria-label={mode === 'dark' ? '切换到浅色' : '切换到深色'} title={mode === 'dark' ? '切换到浅色' : '切换到深色'} onClick={onTheme}>{mode === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</button>
        <time dateTime={now.toISOString()} title={now.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'})}>{now.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false})}</time>
      </div>
    </nav>
  )
}

export function Win98Titlebar({title, maximized, onMinimize, onMaximize, onClose}: {
  title: string
  maximized: boolean
  onMinimize: () => void
  onMaximize: () => void
  onClose: () => void
}) {
  return (
    <header className="win98-titlebar" aria-label={`${title}，窗口`} onDoubleClick={(event) => {
      if (event.target instanceof Element && !event.target.closest('button')) onMaximize()
    }}>
      <span className="win98-window-title"><AppWindow weight="duotone" aria-hidden="true" /><span>{title}</span></span>
      <div className="win98-window-actions">
        <button type="button" className="win98-raised" aria-label="最小化窗口" title="最小化" onClick={onMinimize}><Minus weight="bold" aria-hidden="true" /></button>
        <button type="button" className="win98-raised" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={onMaximize}>{maximized ? <CopySimple weight="bold" aria-hidden="true" /> : <Square weight="bold" aria-hidden="true" />}</button>
        <button type="button" className="win98-raised win98-close" aria-label="关闭窗口" title="关闭" onClick={onClose}><X weight="bold" aria-hidden="true" /></button>
      </div>
    </header>
  )
}
