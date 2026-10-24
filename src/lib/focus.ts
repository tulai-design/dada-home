import {useSyncExternalStore} from 'react'
import {SHARED, readData, writeData} from './componentData'
import {addDays, ymd} from './calendar'
import {readStored, writeStored} from './store'

/**
 * 番茄钟。
 *
 * 计时放在模块里而不是组件里：切换页面、组件被卸载，计时都不能断；
 * 刷新页面也要接得上（所以存的是「几点结束」，不是「还剩几秒」）。
 * 界面只负责显示，用 useFocus() 订阅状态；AI 通过工具读写同一份。
 */

export type FocusPhase = 'focus' | 'short' | 'long'
export const PHASE_LABEL: Record<FocusPhase, string> = {focus: '专注', short: '短休息', long: '长休息'}

export type FocusSettings = {
  focusMin: number
  shortMin: number
  longMin: number
  /** 每几个专注后来一次长休息 */
  longEvery: number
  /** 专注结束后自动开始休息 */
  autoBreak: boolean
  /** 结束时响一声、弹系统通知 */
  alert: boolean
}

export const DEFAULT_FOCUS: FocusSettings = {focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoBreak: true, alert: true}

export type FocusState = {
  phase: FocusPhase
  status: 'idle' | 'running' | 'paused'
  /** 运行中：结束的时间戳 */
  endsAt?: number
  /** 暂停中：还剩多少毫秒 */
  leftMs?: number
  /** 这一段的总长（毫秒），画进度用 */
  totalMs: number
  /** 这一轮在做什么 */
  label?: string
  /** 当前循环里已完成几个专注 */
  round: number
}

export type FocusRecord = {at: number; minutes: number; label?: string}

const SETTINGS_KEY = 'focusSettings'
const STATE_KEY = 'focusState'
const LOG_CAP = 1500

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback)

export function readFocusSettings(): FocusSettings {
  const raw = readStored<Partial<FocusSettings>>(SETTINGS_KEY, {})
  return {
    focusMin: clamp(raw.focusMin, 1, 180, DEFAULT_FOCUS.focusMin),
    shortMin: clamp(raw.shortMin, 1, 60, DEFAULT_FOCUS.shortMin),
    longMin: clamp(raw.longMin, 1, 120, DEFAULT_FOCUS.longMin),
    longEvery: clamp(raw.longEvery, 2, 12, DEFAULT_FOCUS.longEvery),
    autoBreak: typeof raw.autoBreak === 'boolean' ? raw.autoBreak : DEFAULT_FOCUS.autoBreak,
    alert: typeof raw.alert === 'boolean' ? raw.alert : DEFAULT_FOCUS.alert,
  }
}

export function writeFocusSettings(part: Partial<FocusSettings>) {
  writeStored(SETTINGS_KEY, {...readFocusSettings(), ...part})
  // 空闲时，时长改了就立刻反映到表盘上
  if (state.status === 'idle') setState(idleState(state.phase, state.round))
}

const minutesOf = (phase: FocusPhase, s = readFocusSettings()) => (phase === 'focus' ? s.focusMin : phase === 'short' ? s.shortMin : s.longMin)
const idleState = (phase: FocusPhase, round: number): FocusState => ({phase, status: 'idle', totalMs: minutesOf(phase) * 60_000, round})

/* ───────────── 状态 ───────────── */

let state: FocusState = restore()
const listeners = new Set<() => void>()
let timer: number | undefined
let ticker: number | undefined

function restore(): FocusState {
  const saved = readStored<Partial<FocusState> | null>(STATE_KEY, null)
  if (saved && (saved.phase === 'focus' || saved.phase === 'short' || saved.phase === 'long') && typeof saved.totalMs === 'number') {
    return {
      phase: saved.phase,
      status: saved.status === 'running' || saved.status === 'paused' ? saved.status : 'idle',
      endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : undefined,
      leftMs: typeof saved.leftMs === 'number' ? saved.leftMs : undefined,
      totalMs: saved.totalMs,
      label: typeof saved.label === 'string' ? saved.label : undefined,
      round: typeof saved.round === 'number' ? saved.round : 0,
    }
  }
  return idleState('focus', 0)
}

function setState(next: FocusState) {
  state = next
  writeStored(STATE_KEY, next)
  listeners.forEach((fn) => fn())
  arm()
}

/* ───────────── 到点 ───────────── */

function arm() {
  window.clearTimeout(timer)
  timer = undefined
  window.clearInterval(ticker)
  ticker = undefined
  if (state.status !== 'running' || state.endsAt === undefined) {
    setTitle(null)
    return
  }
  const wait = state.endsAt - Date.now()
  // setTimeout 最长约 24 天，番茄钟远小于此
  timer = window.setTimeout(finish, Math.max(0, wait))
  ticker = window.setInterval(() => setTitle(remaining(state)), 1000)
  setTitle(remaining(state))
}

// emoji 是两个 UTF-16 单元，不能放进 [] 字符类；多段叠起来的一并去掉
const TITLE_PREFIX = /^(?:(?:🍅|☕) \d{2}:\d{2} · )+/

function setTitle(leftMs: number | null) {
  if (typeof document === 'undefined') return
  const base = document.title.replace(TITLE_PREFIX, '')
  document.title = leftMs === null ? base : `${state.phase === 'focus' ? '🍅' : '☕'} ${mmss(leftMs)} · ${base}`
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 还剩多少毫秒。 */
export function remaining(s: FocusState, now = Date.now()): number {
  if (s.status === 'running' && s.endsAt !== undefined) return Math.max(0, s.endsAt - now)
  if (s.status === 'paused' && s.leftMs !== undefined) return s.leftMs
  return s.totalMs
}

function finish() {
  if (state.status !== 'running') return
  const settings = readFocusSettings()
  const endedAt = state.endsAt ?? Date.now()
  let round = state.round
  let next: FocusPhase
  let message: string

  if (state.phase === 'focus') {
    round += 1
    logFocus({at: endedAt, minutes: Math.round(state.totalMs / 60_000), label: state.label})
    next = round % settings.longEvery === 0 ? 'long' : 'short'
    message = `专注完成，${state.label ? `「${state.label}」` : ''}辛苦了。休息一下吧。`
  } else {
    next = 'focus'
    message = '休息结束，准备开始下一个专注。'
  }

  // 睡眠或标签页被冻结后很久才醒来：太久以前的不再自动接下一段，免得一打开就在计时
  const stale = Date.now() - endedAt > 30 * 60_000
  const auto = next !== 'focus' && settings.autoBreak && !stale
  const keepLabel = next === 'focus' ? undefined : state.label
  if (auto) {
    const total = minutesOf(next, settings) * 60_000
    setState({phase: next, status: 'running', endsAt: Date.now() + total, totalMs: total, round, label: keepLabel})
  } else {
    setState({...idleState(next, next === 'long' ? 0 : round), label: keepLabel})
  }
  if (!stale && settings.alert) alertUser(state.phase === 'focus' ? '休息结束' : '专注完成', message)
}

function logFocus(record: FocusRecord) {
  const list = readData<FocusRecord[]>(SHARED.focusLog, [])
  writeData(SHARED.focusLog, [...(Array.isArray(list) ? list : []), record].slice(-LOG_CAP))
}

/* ───────────── 提醒 ───────────── */

let audio: AudioContext | undefined

/** 两声轻轻的提示音，不依赖任何音频文件。 */
function chime() {
  try {
    audio ??= new AudioContext()
    const ctx = audio
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    ;[880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + i * 0.22)
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.22 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.7)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.22)
      osc.stop(now + i * 0.22 + 0.75)
    })
  } catch {
    /* 没有音频权限就静默 */
  }
}

function alertUser(title: string, body: string) {
  chime()
  try {
    navigator.vibrate?.([120, 60, 120])
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, {body, icon: `${import.meta.env.BASE_URL}brand/icon-192.png`, tag: 'dada-focus'})
    }
  } catch {
    /* 通知不可用就算了 */
  }
}

/** 第一次开始时请求通知权限（必须由用户操作触发）。 */
function askPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  } catch {
    /* 忽略 */
  }
}

/* ───────────── 动作 ───────────── */

export const focusActions = {
  /** 开始当前这一段。label 只在专注时有意义。 */
  start(label?: string, minutes?: number) {
    askPermission()
    // 先打一下音频上下文，之后到点才允许发声
    try {
      audio ??= new AudioContext()
      if (audio.state === 'suspended') void audio.resume()
    } catch {
      /* 忽略 */
    }
    const phase = state.phase
    const total = (minutes && minutes > 0 ? clamp(minutes, 1, 180, minutesOf(phase)) : minutesOf(phase)) * 60_000
    const cleaned = label?.trim().slice(0, 60) || state.label
    setState({phase, status: 'running', endsAt: Date.now() + total, totalMs: total, round: state.round, label: cleaned || undefined})
  },
  pause() {
    if (state.status !== 'running') return
    setState({...state, status: 'paused', leftMs: remaining(state), endsAt: undefined})
  },
  resume() {
    if (state.status !== 'paused') return
    setState({...state, status: 'running', endsAt: Date.now() + (state.leftMs ?? state.totalMs), leftMs: undefined})
  },
  /** 放弃这一段，回到待开始（不记录）。 */
  stop() {
    setState({...idleState(state.phase, state.round), label: state.label})
  },
  /** 跳到另一种阶段（比如不想休息了）。 */
  switchTo(phase: FocusPhase) {
    setState({...idleState(phase, state.round), label: state.label})
  },
  /** 全部重来，连带循环计数。 */
  reset() {
    setState(idleState('focus', 0))
  },
  setLabel(label: string) {
    setState({...state, label: label.trim().slice(0, 60) || undefined})
  },
}

export const getFocusState = () => state

export function useFocus(): FocusState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

/* ───────────── 统计 ───────────── */

export type FocusStats = {todayCount: number; todayMinutes: number; weekMinutes: number; streak: number; totalCount: number}

export function readFocusLog(): FocusRecord[] {
  const list = readData<FocusRecord[]>(SHARED.focusLog, [])
  return Array.isArray(list) ? list : []
}

export function focusStats(log = readFocusLog(), now = new Date()): FocusStats {
  const day = ymd(now)
  const weekStart = addDays(day, -6)
  const perDay = new Map<string, number>()
  for (const record of log) perDay.set(ymd(new Date(record.at)), (perDay.get(ymd(new Date(record.at))) ?? 0) + record.minutes)
  const todayItems = log.filter((record) => ymd(new Date(record.at)) === day)
  let weekMinutes = 0
  for (let i = 0; i < 7; i += 1) weekMinutes += perDay.get(addDays(weekStart, i)) ?? 0
  // 连续几天有专注：今天还没开始不算断
  let streak = 0
  let cursor = perDay.has(day) ? day : addDays(day, -1)
  while (perDay.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return {todayCount: todayItems.length, todayMinutes: todayItems.reduce((sum, r) => sum + r.minutes, 0), weekMinutes, streak, totalCount: log.length}
}

/** 最近 7 天（含今天）每天专注了多少分钟，从旧到新。画柱状图用。 */
export function focusWeek(log = readFocusLog(), now = new Date()): {day: string; minutes: number}[] {
  const day = ymd(now)
  const perDay = new Map<string, number>()
  for (const record of log) {
    const key = ymd(new Date(record.at))
    perDay.set(key, (perDay.get(key) ?? 0) + record.minutes)
  }
  return Array.from({length: 7}, (_, i) => {
    const key = addDays(day, i - 6)
    return {day: key, minutes: perDay.get(key) ?? 0}
  })
}

/** 页面重新可见时补一次检查：后台标签页的定时器会被浏览器拖慢。 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'running' && state.endsAt !== undefined && state.endsAt <= Date.now()) finish()
  })
  // 启动时如果上次关页面时正好有一段在跑，接着走（已经过点的在 arm 里立刻 finish）
  queueMicrotask(arm)
}
