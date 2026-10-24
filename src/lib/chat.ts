import {useSyncExternalStore} from 'react'
import {db} from './db'
import {readStored, writeStored} from './store'

/**
 * 对话记录。
 *
 * 一轮对话是一个 Turn：用户说了什么，模型想了什么、答了什么，
 * 中间调用了哪些工具、各自成没成，用时多久。
 *
 * 这样存的原因：界面要能折叠思考过程、按轮展示工具调用、
 * 显示耗时和失败原因，而不是把所有东西拍平成一行行文字。
 */

/** 一次工具调用。 */
export type ToolStep = {
  name: string
  /** 给用户看的动作说明，例如「添加组件：待办」 */
  title: string
  ok: boolean
  /** 执行结果或失败原因，展开时显示 */
  text: string
}

/** 等待用户答复的确认请求。 */
export type PendingApproval = {
  request: {tool: string; summary: string}
}

export type Turn = {
  id: string
  /** 用户输入；工具紧随其后时为 undefined 不算，这里始终有值 */
  prompt: string
  /** 模型正文，流式增长 */
  answer: string
  /** 模型的思考过程（部分模型会返回） */
  reasoning: string
  tools: ToolStep[]
  /** 失败信息；成功时为空串 */
  error: string
  /** 本轮开始/结束时间，用来算耗时 */
  startedAt: number
  endedAt?: number
  /** 是否被用户中止 */
  aborted?: boolean
  /** 非空表示这一轮正卡在某个确认上，界面据此显示确认卡片 */
  pending?: PendingApproval
  /** 属于哪个对话；存取时由 store 盖章，界面不用管 */
  convId?: string
}

/** 一个对话：只存标题和时间，内容在 turns 仓库里。 */
export type Conv = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

/**
 * 对话 store。
 *
 * 数据放在 IndexedDB：对话可以无限增长，不再受 localStorage 约 5MB 的限制。
 * 内存里只放「当前打开的那个对话」的全部轮次，以及所有对话的标题列表；
 * 切到别的对话才去读它的轮次。
 *
 * 写入是增量的：流式输出时每个字都会改一轮，所以按轮标脏、合并成一次写入，不会每个字写一次库。
 */
type State = {ready: boolean; convs: Conv[]; convId: string; turns: Turn[]}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const CONV_KEY = 'conv'
const LEGACY_KEY = 'fp.chatTurns.v2'
const FLUSH_MS = 400

let state: State = {ready: false, convs: [], convId: newId(), turns: []}
const listeners = new Set<() => void>()
const dirty = new Set<string>()
const removed = new Set<string>()
let timer: number | undefined
let initPromise: Promise<void> | undefined

function set(part: Partial<State>) {
  state = {...state, ...part}
  listeners.forEach((fn) => fn())
}

const byRecent = (a: Conv, b: Conv) => b.updatedAt - a.updatedAt
const byStart = (a: Turn, b: Turn) => a.startedAt - b.startedAt

/** 标题取第一句话，压成一行。 */
function titleOf(turns: Turn[]): string {
  const first = turns[0]?.prompt.replace(/\s+/g, ' ').trim() ?? ''
  return first.length > 28 ? `${first.slice(0, 28)}…` : first || '新对话'
}

/** 刷新页面时还在进行中的轮次（没有结束时间），标成已停止，免得界面永远转圈。 */
function settle(turn: Turn): Turn {
  return turn.endedAt === undefined ? {...turn, endedAt: turn.startedAt, aborted: true, pending: undefined} : turn
}

async function load(convId: string): Promise<Turn[]> {
  const rows = await db.byIndex<Turn>('turns', 'convId', convId)
  return rows.sort(byStart).map(settle)
}

/** 旧版把所有轮次放在 localStorage 一个键里：一次性搬进 IndexedDB，成为一个「之前的对话」。 */
async function migrateLegacy(): Promise<void> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_KEY)
  } catch {
    return
  }
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Turn[]
    const turns = Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.prompt === 'string' && typeof t.id === 'string') : []
    if (turns.length) {
      const id = `legacy-${newId()}`
      const stamped = turns.map((t) => ({...t, convId: id}))
      await db.putMany('turns', stamped)
      const last = turns[turns.length - 1]
      await db.put('convs', {id, title: titleOf(turns), createdAt: turns[0].startedAt, updatedAt: last.endedAt ?? last.startedAt} satisfies Conv)
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* 解析失败就保留原数据不动，下次再试 */
  }
}

export function initChat(): Promise<void> {
  initPromise ??= (async () => {
    await migrateLegacy()
    const convs = (await db.all<Conv>('convs')).sort(byRecent)
    const saved = readStored<string>(CONV_KEY, '')
    const current = convs.find((c) => c.id === saved)
    const convId = current ? current.id : state.convId
    const turns = current ? await load(current.id) : state.turns
    set({ready: true, convs, convId, turns})
  })()
  return initPromise
}

/** 把脏的轮次写进库，并更新对话的标题和时间。 */
async function flush() {
  window.clearTimeout(timer)
  timer = undefined
  const {turns, convId} = state
  const ids = [...dirty]
  const gone = [...removed]
  dirty.clear()
  removed.clear()
  if (!ids.length && !gone.length) return

  const rows = turns.filter((t) => ids.includes(t.id)).map((t) => ({...t, convId}))
  if (rows.length) await db.putMany('turns', rows)
  if (gone.length) await db.delMany('turns', gone)

  if (turns.length) {
    const known = state.convs.find((c) => c.id === convId)
    const conv: Conv = {id: convId, title: known?.title ?? titleOf(turns), createdAt: known?.createdAt ?? turns[0].startedAt, updatedAt: Date.now()}
    await db.put('convs', conv)
    set({convs: [conv, ...state.convs.filter((c) => c.id !== convId)].sort(byRecent)})
  }
}

function schedule() {
  if (timer === undefined) timer = window.setTimeout(() => void flush(), FLUSH_MS)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush())
}

/** 改当前对话的轮次。用法和 useState 的 setter 一样，可以传函数。 */
function setTurns(next: Turn[] | ((prev: Turn[]) => Turn[])) {
  const prev = state.turns
  const value = typeof next === 'function' ? next(prev) : next
  if (value === prev) return
  const before = new Map(prev.map((t) => [t.id, t]))
  for (const turn of value) {
    if (before.get(turn.id) !== turn) dirty.add(turn.id)
    before.delete(turn.id)
  }
  // 剩下的就是被删掉的
  for (const id of before.keys()) {
    removed.add(id)
    dirty.delete(id)
  }
  set({turns: value})
  schedule()
}

/** 新开一个对话。当前这个是空的就不重复开。 */
async function newConv() {
  await flush()
  if (!state.turns.length) return
  const id = newId()
  writeStored(CONV_KEY, id)
  set({convId: id, turns: []})
}

async function openConv(id: string) {
  if (id === state.convId) return
  await flush()
  const turns = await load(id)
  writeStored(CONV_KEY, id)
  set({convId: id, turns})
}

/** 删掉一个对话和它所有轮次。删的是当前的就回到一个空白新对话。 */
async function deleteConv(id: string) {
  await flush()
  const rows = await db.byIndex<Turn>('turns', 'convId', id)
  await db.delMany('turns', rows.map((t) => t.id))
  await db.del('convs', id)
  const convs = state.convs.filter((c) => c.id !== id)
  if (id === state.convId) {
    const fresh = newId()
    writeStored(CONV_KEY, fresh)
    set({convs, convId: fresh, turns: []})
  } else {
    set({convs})
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useChat() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  return {...snapshot, setTurns, newConv, openConv, deleteConv}
}

/**
 * 发给模型的上下文：只取最近一段，免得对话越长越贵、最后撑爆上下文窗口。
 * 对话本身一轮不删，只是更早的内容不再带给模型。
 */
const CONTEXT_TURNS = 24
const CONTEXT_CHARS = 36_000

export function contextTurns(turns: Turn[], limit = CONTEXT_TURNS): Turn[] {
  const picked: Turn[] = []
  let size = 0
  for (let i = turns.length - 1; i >= 0 && picked.length < limit; i -= 1) {
    const turn = turns[i]
    size += turn.prompt.length + turn.answer.length
    if (picked.length && size > CONTEXT_CHARS) break
    picked.unshift(turn)
  }
  return picked
}

/** 导出全部对话，给「导出备份」用。 */
export async function exportChat() {
  return {convs: await db.all<Conv>('convs'), turns: await db.all<Turn>('turns')}
}

/** 清空所有对话（恢复默认时用）。 */
export async function clearChat() {
  dirty.clear()
  removed.clear()
  await Promise.all([db.clear('convs'), db.clear('turns')])
  set({convs: [], turns: [], convId: newId()})
}

/** 起一轮新对话。 */
export function beginTurn(prompt: string): Turn {
  return {
    id: newId(),
    prompt,
    answer: '',
    reasoning: '',
    tools: [],
    error: '',
    startedAt: Date.now(),
  }
}

/** 一轮是否还在进行中（用于界面显示「思考中」）。 */
export function isActive(turn: Turn): boolean {
  return turn.endedAt === undefined
}

/** 耗时（毫秒）；未结束返回 undefined。 */
export function elapsed(turn: Turn): number | undefined {
  return turn.endedAt === undefined ? undefined : turn.endedAt - turn.startedAt
}
