import {useSyncExternalStore} from 'react'
import {db, type DbOperation} from './db'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'
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
  /** 随本轮保存的文章资料，后续追问仍可使用；不混入用户输入。 */
  article?: {title: string; link: string; context: string}
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

/** 显示保留用户原话，发给模型时再附上用户选择的参考资料。 */
export function turnContent(turn: Pick<Turn, 'prompt' | 'article'>): string {
  return turn.article
    ? `${turn.article.context}\n\n用户的问题：\n${turn.prompt}`
    : turn.prompt
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
 * 数据放在 IndexedDB；仍受浏览器额度和实际持久化结果约束。
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
type TurnWrite = {turn: Turn; deleted: false} | {id: string; deleted: true}
const dirty = new Map<string, TurnWrite>()
const dirtyConvs = new Map<string, Conv>()
let flushing: Promise<void> | undefined
let navigation = 0
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

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function legacyTurn(value: unknown): value is Turn {
  if (!record(value) || typeof value.id !== 'string' || !value.id.trim()) return false
  if (['prompt', 'answer', 'reasoning', 'error'].some(key => typeof value[key] !== 'string')) return false
  if (!timestamp(value.startedAt) || (value.endedAt !== undefined && !timestamp(value.endedAt))) return false
  if (value.aborted !== undefined && typeof value.aborted !== 'boolean') return false
  if (value.convId !== undefined && (typeof value.convId !== 'string' || !value.convId.trim())) return false
  if (!Array.isArray(value.tools) || value.tools.some(tool => !record(tool) || typeof tool.name !== 'string' || typeof tool.title !== 'string' || typeof tool.text !== 'string' || typeof tool.ok !== 'boolean')) return false
  const article = value.article
  if (article !== undefined && (!record(article) || ['title', 'link', 'context'].some(key => typeof article[key] !== 'string'))) return false
  if (value.pending !== undefined && (!record(value.pending) || !record(value.pending.request) || typeof value.pending.request.tool !== 'string' || typeof value.pending.request.summary !== 'string')) return false
  return true
}

/** 旧备份和启动迁移共用纯校验；坏输入不可替换现有数据或被迁移成默认值。 */
export function validateLegacyTurns(value: unknown): Turn[] {
  if (!Array.isArray(value) || !value.every(legacyTurn) || new Set(value.map(turn => turn.id)).size !== value.length) {
    throw new Error('旧聊天数据格式损坏，原始记录已保留，请先导出备份。')
  }
  return value
}

/** 旧聊天只有在目标事务和读回成功后才清理；固定归属避免清旧键失败后重复迁移。 */
async function migrateLegacy(): Promise<void> {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return
  const turns = validateLegacyTurns(JSON.parse(raw))
  if (!turns.length) {
    // 连空旧记录也只在确认目标可读取后删除。
    await db.all('convs')
    localStorage.removeItem(LEGACY_KEY)
    return
  }
  const existing = await Promise.all(turns.map(turn => db.get<Turn>('turns', turn.id)))
  const id = existing.find(turn => turn?.convId)?.convId ?? `legacy-${turns[0].id}`
  const operations: DbOperation[] = []
  turns.forEach((turn, index) => {
    if (!existing[index]) operations.push({store: 'turns', type: 'put', value: {...turn, convId: id}})
  })
  if (!await db.get<Conv>('convs', id)) {
    const last = turns[turns.length - 1]
    operations.push({store: 'convs', type: 'put', value: {id, title: titleOf(turns), createdAt: turns[0].startedAt, updatedAt: last.endedAt ?? last.startedAt} satisfies Conv})
  }
  await db.batch(operations)
  const confirmed = await Promise.all(turns.map(turn => db.get<Turn>('turns', turn.id)))
  if (confirmed.some(turn => !turn) || !await db.get('convs', id)) throw new Error('旧聊天尚未完整写入，原数据已保留。')
  localStorage.removeItem(LEGACY_KEY)
}

export function initChat(): Promise<void> {
  if (initPromise) return initPromise
  const run = (async () => {
    await migrateLegacy()
    const convs = (await db.all<Conv>('convs')).sort(byRecent)
    const saved = readStored<string>(CONV_KEY, '')
    const current = convs.find(conv => conv.id === saved)
    const convId = current ? current.id : state.convId
    const turns = current ? await load(current.id) : state.turns
    set({ready: true, convs, convId, turns})
    clearPersistenceError('chat-init')
  })()
  initPromise = run.catch(error => {
    initPromise = undefined
    reportPersistenceError('chat-init', error, initChat)
    throw error
  })
  return initPromise
}

/** 快照在编辑发生时就绑定 convId；旧批次提交只确认自己对应的操作。 */
export function flush(): Promise<void> {
  window.clearTimeout(timer)
  timer = undefined
  if (flushing) return flushing.then(() => dirty.size || dirtyConvs.size ? flush() : undefined)
  const work = async () => {
    try {
      while (dirty.size || dirtyConvs.size) {
        const turns = [...dirty]
        const convs = [...dirtyConvs]
        const operations: DbOperation[] = turns.map(([id, item]) => item.deleted
          ? {store: 'turns', type: 'delete', key: id}
          : {store: 'turns', type: 'put', value: item.turn})
        operations.push(...convs.map(([, value]) => ({store: 'convs' as const, type: 'put' as const, value})))
        await db.batch(operations)
        for (const [id, item] of turns) if (dirty.get(id) === item) dirty.delete(id)
        for (const [id, item] of convs) if (dirtyConvs.get(id) === item) dirtyConvs.delete(id)
      }
      clearPersistenceError('chat-data')
    } catch (error) {
      reportPersistenceError('chat-data', error, flush)
      throw error
    }
  }
  const run = work().finally(() => {if (flushing === run) flushing = undefined})
  flushing = run
  return run
}

function backgroundFlush() {void flush().catch(() => undefined)}
function schedule() {if (timer === undefined) timer = window.setTimeout(backgroundFlush, FLUSH_MS)}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', backgroundFlush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && backgroundFlush())
}

function setTurns(next: Turn[] | ((prev: Turn[]) => Turn[])) {
  assertPersistenceWritable()
  const prev = state.turns
  const value = typeof next === 'function' ? next(prev) : next
  if (value === prev) return
  const convId = state.convId
  const before = new Map(prev.map(turn => [turn.id, turn]))
  for (const turn of value) {
    if (before.get(turn.id) !== turn) dirty.set(turn.id, {deleted: false, turn: {...turn, convId}})
    before.delete(turn.id)
  }
  for (const id of before.keys()) dirty.set(id, {deleted: true, id})
  let convs = state.convs
  if (value.length) {
    const known = convs.find(conv => conv.id === convId)
    const conv: Conv = {id: convId, title: known?.title ?? titleOf(value), createdAt: known?.createdAt ?? value[0].startedAt, updatedAt: Date.now()}
    dirtyConvs.set(convId, conv)
    convs = [conv, ...convs.filter(item => item.id !== convId)].sort(byRecent)
  }
  set({turns: value, convs})
  schedule()
}

async function newConv() {
  assertPersistenceWritable()
  const request = ++navigation
  await flush()
  if (request !== navigation) return
  assertPersistenceWritable()
  if (!state.turns.length) return
  const id = newId()
  writeStored(CONV_KEY, id)
  set({convId: id, turns: []})
}

async function openConv(id: string) {
  assertPersistenceWritable()
  const request = ++navigation
  if (id === state.convId) return
  await flush()
  const turns = await load(id)
  if (request !== navigation) return
  assertPersistenceWritable()
  writeStored(CONV_KEY, id)
  set({convId: id, turns})
}

async function deleteConv(id: string) {
  assertPersistenceWritable()
  ++navigation
  await flush()
  const rows = await db.byIndex<Turn>('turns', 'convId', id)
  assertPersistenceWritable()
  await db.batch([...rows.map(turn => ({store: 'turns' as const, type: 'delete' as const, key: turn.id})), {store: 'convs', type: 'delete', key: id}])
  const convs = state.convs.filter(conv => conv.id !== id)
  if (id === state.convId) {
    const fresh = newId()
    writeStored(CONV_KEY, fresh)
    set({convs, convId: fresh, turns: []})
  } else set({convs})
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
    size += turnContent(turn).length + turn.answer.length
    if (picked.length && size > CONTEXT_CHARS) break
    picked.unshift(turn)
  }
  return picked
}

/** 导出全部对话，给「导出备份」用。 */
export async function exportChat() {
  await flush()
  const snapshot = await db.snapshot()
  return {convs: snapshot.convs as Conv[], turns: snapshot.turns as Turn[]}
}

/** 清空所有对话（恢复默认时用）。 */
export async function clearChat() {
  await flush()
  await db.batch([{store: 'convs', type: 'clear'}, {store: 'turns', type: 'clear'}])
  ++navigation
  dirty.clear()
  dirtyConvs.clear()
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
