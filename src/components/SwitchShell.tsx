import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {Empty} from '@lobehub/ui'
import {AppWindow, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, GameController, Gear, House, Monitor, SquaresFour, WifiHigh, WifiSlash} from '@phosphor-icons/react'
import {useNow} from '../hooks'
import {pageIcon} from '../lib/pageIcons'
import {type NavigationEntry, type ShellIntent} from '../lib/shell/navigation'
import {ProfileAvatar} from './ProfileAvatar'
import '../switch-shell.css'

type View = 'page' | 'settings' | 'monitor' | 'market' | 'application'
type BatteryManager = EventTarget & {level: number; charging: boolean}
type BatteryStatus = {level: number; charging: boolean}

function tone(id: string) {
  let n = 0
  for (const ch of id) n = (n + ch.charCodeAt(0)) % 5
  return String(n)
}

/** 浏览器未提供电量时不展示；异步返回也必须遵循卸载清理。 */
function useConsoleStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [battery, setBattery] = useState<BatteryStatus | null>(null)
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    const batteryApi = navigator as Navigator & {getBattery?: () => Promise<BatteryManager>}
    let disposed = false
    let manager: BatteryManager | undefined
    const updateBattery = () => {
      if (manager) setBattery({level: Math.round(manager.level * 100), charging: manager.charging})
    }
    void batteryApi.getBattery?.().then((result) => {
      if (disposed) return
      manager = result
      updateBattery()
      manager.addEventListener('levelchange', updateBattery)
      manager.addEventListener('chargingchange', updateBattery)
    }).catch(() => { /* 不支持或拒绝读取时，隐藏电量。 */ })
    return () => {
      disposed = true
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      manager?.removeEventListener('levelchange', updateBattery)
      manager?.removeEventListener('chargingchange', updateBattery)
    }
  }, [])
  return {online, battery}
}

/** 主屏只编排已有入口；封面与选中标题在同一滚动轨道，避免标题漂移。 */
export function SwitchHome({name, avatarSeed, entries, dispatch, selectedKey, onSelect}: {
  name: string
  avatarSeed: string
  entries: readonly NavigationEntry[]
  dispatch: (intent: ShellIntent) => void
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const covers = entries.filter((entry) => !entry.home && entry.pinned && entry.target.kind !== 'system')
  const keyOf = (cover: NavigationEntry) => cover.key
  const selectedIndex = Math.max(0, covers.findIndex((cover) => keyOf(cover) === selectedKey))
  const coversRef = useRef<HTMLUListElement>(null)
  const gesture = useRef({x: 0, scroll: 0, active: false, dragged: false})
  const now = useNow(1000)
  const {online, battery} = useConsoleStatus()
  const BatteryIcon = battery?.charging ? BatteryCharging : (battery?.level ?? 0) > 70 ? BatteryFull : (battery?.level ?? 0) > 30 ? BatteryMedium : BatteryLow
  const open = (cover: NavigationEntry) => dispatch({type: 'navigate', target: cover.target})

  useEffect(() => {
    const row = coversRef.current
    if (!row) return
    const onWheel = (event: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      row.scrollLeft += event.deltaY
      event.preventDefault()
    }
    row.addEventListener('wheel', onWheel, {passive: false})
    return () => row.removeEventListener('wheel', onWheel)
  }, [covers.length])
  useEffect(() => {
    coversRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({inline: 'nearest', block: 'nearest'})
  }, [selectedIndex])

  const onCoverKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.switch-cover')) return
    const next = event.key === 'ArrowRight' ? Math.min(selectedIndex + 1, covers.length - 1)
      : event.key === 'ArrowLeft' ? Math.max(selectedIndex - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? covers.length - 1 : null
    if (next !== null && covers[next]) {
      event.preventDefault()
      onSelect(keyOf(covers[next]))
      coversRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus({preventScroll: true})
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.currentTarget.closest('.canvas')?.querySelector<HTMLButtonElement>('.switch-dock-btn')?.focus()
    }
  }

  return (
    <section className="switch-home" aria-label="主机主屏">
      <header className="switch-status">
        {<button type="button" className="switch-avatar" aria-label={`${name || '朋友'}，个人设置`} onClick={() => dispatch({type: 'navigate', target: {kind: 'system', name: 'settings', section: 'profile'}})}><ProfileAvatar seed={avatarSeed} /></button>}
        <div className="switch-status-side">
          <time className="switch-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</time>
          <span className="switch-network" role="img" aria-label={online ? '网络状态：在线' : '网络状态：离线'}>
            {online ? <WifiHigh aria-hidden="true" /> : <WifiSlash aria-hidden="true" />}
          </span>
          {battery && <span className="switch-battery" role="img" aria-label={`电量 ${battery.level}%${battery.charging ? '，充电中' : ''}`}><BatteryIcon aria-hidden="true" /></span>}
        </div>
      </header>
      <div className="switch-stage">
        {covers.length ? (
          <ul
            className="switch-covers"
            aria-label="页面和应用"
            ref={coversRef}
            onKeyDown={onCoverKey}
            onPointerDown={(event) => {
              gesture.current = {x: event.clientX, scroll: event.currentTarget.scrollLeft, active: true, dragged: false}
            }}
            onPointerMove={(event) => {
              const current = gesture.current
              if (!current.active || !event.buttons) return
              const distance = event.clientX - current.x
              if (Math.abs(distance) > 8) current.dragged = true
              if (current.dragged && event.pointerType === 'mouse') event.currentTarget.scrollLeft = current.scroll - distance
            }}
            onPointerUp={() => { gesture.current.active = false }}
            onPointerCancel={() => { gesture.current.active = false; gesture.current.dragged = true }}
            onPointerLeave={() => { gesture.current.active = false }}
          >
            {covers.map((cover, index) => {
              const Icon = cover.icon.kind === 'page' ? pageIcon(cover.icon.name) : AppWindow
              const selected = index === selectedIndex
              return (
                <li className="switch-cover-cell" key={keyOf(cover)}>
                  <button
                    type="button"
                    className="switch-cover"
                    data-index={index}
                    data-on={selected || undefined}
                    aria-current={selected || undefined}
                    aria-label={`${cover.label}${selected ? '，打开' : '，选择'}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      if (gesture.current.dragged) { gesture.current.dragged = false; return }
                      if (selected) open(cover)
                      else onSelect(keyOf(cover))
                    }}
                  >
                    <span className="switch-title" aria-hidden="true">{cover.label}</span>
                    <span className="switch-cover-art" data-tone={tone(cover.key)}>
                      <Icon className="switch-cover-icon" weight="fill" aria-hidden="true" />
                      <span className="switch-cover-label" aria-hidden="true">{cover.label}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <div className="switch-empty"><Empty title="还没有页面" description="从市场添加内容，或让搭搭帮你创建一个页面。" /></div>}
      </div>
    </section>
  )
}

/** 主屏圆形菜单；进入内容后收成一条系统操作栏，给设置和内容留出空间。 */
export function SwitchDock({view, board, entries, dispatch, onBoard, onStart}: {
  view: View
  board: boolean
  entries: readonly NavigationEntry[]
  dispatch: (intent: ShellIntent) => void
  onBoard: () => void
  onStart?: () => void
}) {
  const home = board
  const monitorInstalled = entries.some((entry) => entry.key === 'system:monitor')
  const onAssistant = () => dispatch({type: 'assistant', action: 'toggle-preferred'})
  const onMarket = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'market'}})
  const onMonitor = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'monitor'}})
  const onSettings = () => dispatch({type: 'navigate', target: {kind: 'system', name: 'settings'}})
  const items = [
    ...(!home ? [{id: 'board', name: '主屏', icon: House, on: false, run: onBoard}] : []),
    {id: 'ai', name: '搭搭', icon: null, on: false, run: onAssistant},
    {id: 'market', name: '市场', icon: SquaresFour, on: view === 'market', run: onMarket},
    ...(monitorInstalled ? [{id: 'monitor', name: '监控', icon: Monitor, on: view === 'monitor', run: onMonitor}] : []),
    {id: 'settings', name: '设置', icon: Gear, on: view === 'settings', run: onSettings},
  ]
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.switch-dock-btn')]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    } else if (home && event.key === 'ArrowUp') {
      event.preventDefault()
      event.currentTarget.closest('.canvas')?.querySelector<HTMLButtonElement>('.switch-cover[data-on="true"]')?.focus()
    }
  }
  return (
    <nav className="switch-dock" data-board={home || undefined} aria-label="主机菜单">
      <div className="switch-dock-orbs" onKeyDown={onMenuKey}>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} type="button" className="switch-dock-btn" data-id={item.id} data-on={item.on || undefined} aria-current={item.on ? 'page' : undefined} aria-label={item.name} onClick={item.run}>
              <span className="switch-orb">{Icon ? <Icon weight="regular" aria-hidden="true" /> : <img className="switch-dada-logo" src={`${import.meta.env.BASE_URL}brand/dada-logo.png`} alt="" draggable={false} />}</span>
              <span className="switch-dock-name">{item.name}</span>
            </button>
          )
        })}
      </div>
      <div className="switch-dock-foot">
        <span className="switch-dock-mark" aria-hidden="true"><GameController weight="fill" /></span>
        {home ? <button type="button" className="switch-start" onClick={onStart} disabled={!onStart}>
          <span className="switch-start-key" aria-hidden="true">A</span>打开
        </button> : <button type="button" className="switch-start" onClick={onBoard} aria-label="返回主屏">
          <span className="switch-start-key" aria-hidden="true">B</span>返回
        </button>}
      </div>
    </nav>
  )
}
