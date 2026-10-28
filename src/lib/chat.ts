import {useSyncExternalStore} from 'react'
import {db, type DbOperation} from './db'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'
import {readStored, writeStored} from './store'
import {hydrateTurn, splitTurn, toolDetailId, validateConv, validateStoredChat, validateStoredTurn, validateToolDetail, type Conv, type StoredTurn, type ToolDetail, type ToolStep, type Turn} from './chatStorageSchema'
export type {Conv, PendingApproval, StoredTool, StoredTurn, ToolDetail, ToolStep, Turn} from './chatStorageSchema'

/** 可见历史与正在生成的轮次分离；工具正文只在展开或完整导出时读取。 */
export type ChatState = {
  ready: boolean; convs: Conv[]; convId: string; currentConv: Conv | null; turns: StoredTurn[]; activeTurnIds: string[]
  hasMoreConvs: boolean; convsLoading: boolean; hasOlderTurns: boolean; turnsLoading: boolean; convsError: string; turnsError: string
}
export const CHAT_TURN_PAGE = 40
export const CHAT_CONV_PAGE = 50
const FLUSH_MS = 400
const CONV_KEY = 'conv'
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
let state: ChatState = {ready: false, convs: [], convId: newId(), currentConv: null, turns: [], activeTurnIds: [], hasMoreConvs: false, convsLoading: false, hasOlderTurns: false, turnsLoading: false, convsError: '', turnsError: ''}
const listeners = new Set<() => void>()
const dirty = new Map<string, StoredTurn>(), dirtyConvs = new Map<string, Conv>(), dirtyDetails = new Map<string, ToolDetail>()
const active = new Map<string, StoredTurn>(), knownConvs = new Map<string, Conv>(), drafts = new Set([state.convId]), deleting = new Set<string>()
type ReadOverlay = {convId?: string; turns: Map<string, StoredTurn>; convs: Map<string, Conv>}
const reads = new Set<ReadOverlay>()
let flushing: Promise<void> | undefined, initPromise: Promise<void> | undefined
let timer: number | undefined, navigation = 0, convGeneration = 0
let turnCursor: [number, string] | undefined, convCursor: [number, string] | undefined
let olderRequest: Promise<void> | undefined, convRequest: Promise<void> | undefined
let opening: {id: string; request: number} | undefined
let clearing = false
const byStart = (a: StoredTurn, b: StoredTurn) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byRecent = (a: Conv, b: Conv) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function set(part: Partial<ChatState>) {state = {...state, ...part}; listeners.forEach(fn => fn())}
function subscribe(fn: () => void) {listeners.add(fn); return () => {listeners.delete(fn)}}
export const getChatState = (): ChatState => state
function ready() {if (!state.ready) throw new Error('聊天记录尚未读取完成。')}
function writable(convId?: string) {assertPersistenceWritable(); ready(); if (clearing) throw new Error('正在清空聊天，请稍后再试。'); if (convId && deleting.has(convId)) throw new Error('该会话正在删除，不能继续写入。')}
function settled(turn: StoredTurn): StoredTurn {return turn.endedAt === undefined && !active.has(turn.id) ? {...turn, endedAt: turn.startedAt, aborted: true, pending: undefined} : turn}
// 游标查询可能早于 flush 取得快照；只在查询存续期保留更新，避免确认后旧查询回退新输出。
function beginRead(convId?: string): ReadOverlay {
  const read: ReadOverlay = {convId, turns: new Map(), convs: new Map()}
  for (const turn of [...dirty.values(), ...active.values()]) if (turn.convId === convId) read.turns.set(turn.id, turn)
  for (const conv of dirtyConvs.values()) if (!convId || conv.id === convId) read.convs.set(conv.id, conv)
  reads.add(read)
  return read
}
function overlay(rows: StoredTurn[], convId: string, read?: ReadOverlay): StoredTurn[] {
  const merged = new Map(rows.map(row => [row.id, settled(row)]))
  for (const turn of [...(read?.turns.values() ?? []), ...dirty.values(), ...active.values()]) if (turn.convId === convId) merged.set(turn.id, turn)
  return [...merged.values()].sort(byStart)
}
function mergeConvs(rows: Conv[], read?: ReadOverlay): Conv[] {
  const merged = new Map(rows.map(row => [row.id, row]))
  for (const conv of [...(read?.convs.values() ?? []), ...dirtyConvs.values()]) merged.set(conv.id, conv)
  for (const conv of merged.values()) knownConvs.set(conv.id, conv)
  return [...merged.values()].sort(byRecent)
}
async function turnPage(convId: string, cursor?: [number, string], limit = CHAT_TURN_PAGE) {
  const rows = (await db.page<unknown>('turns', 'chronological', {
    lower: [convId], upper: cursor ? [convId, ...cursor] : [convId, []], upperOpen: true, direction: 'prev', limit: limit + 1,
  })).map(validateStoredTurn)
  if (rows.some(turn => turn.convId !== convId)) throw new Error('聊天分页返回了其他会话的记录。')
  const page = rows.slice(0, limit), last = page[page.length - 1]
  return {rows: page.reverse(), more: rows.length > limit, cursor: last ? [last.startedAt, last.id] as [number, string] : cursor}
}
async function convPage(cursor?: [number, string]) {
  const rows = (await db.page<unknown>('convs', 'recent', {upper: cursor, upperOpen: true, direction: 'prev', limit: CHAT_CONV_PAGE + 1})).map(validateConv)
  const page = rows.slice(0, CHAT_CONV_PAGE), last = page[page.length - 1]
  return {rows: page, more: rows.length > CHAT_CONV_PAGE, cursor: last ? [last.updatedAt, last.id] as [number, string] : cursor}
}

export function initChat(): Promise<void> {
  if (initPromise) return initPromise
  const run = (async () => {
    const page = await convPage()
    const saved = readStored<string>(CONV_KEY, '')
    const raw = saved ? await db.get<unknown>('convs', saved) : undefined
    const current = raw === undefined ? null : validateConv(raw)
    const convId = current?.id ?? state.convId
    const turns = current ? await turnPage(convId) : {rows: [], more: false, cursor: undefined}
    convCursor = page.cursor; turnCursor = turns.cursor
    if (current) knownConvs.set(current.id, current)
    set({ready: true, convs: mergeConvs(page.rows), convId, currentConv: current, turns: overlay(turns.rows, convId), hasMoreConvs: page.more, hasOlderTurns: turns.more, convsError: '', turnsError: ''})
    clearPersistenceError('chat-init')
  })()
  initPromise = run.catch(error => {initPromise = undefined; reportPersistenceError('chat-init', error, initChat); throw error})
  return initPromise
}

/** 每批工具正文、轮次引用与会话元数据在同一事务确认；失败保留最新值。 */
export function flush(): Promise<void> {
  window.clearTimeout(timer); timer = undefined
  if (flushing) return flushing.then(() => dirty.size || dirtyConvs.size || dirtyDetails.size ? flush() : undefined)
  const work = async () => {
    try {
      while (dirty.size || dirtyConvs.size || dirtyDetails.size) {
        const turns = [...dirty], convs = [...dirtyConvs], details = [...dirtyDetails]
        const operations: DbOperation[] = [
          ...details.map(([, value]) => ({store: 'toolDetails' as const, type: 'put' as const, value})),
          ...turns.map(([, value]) => ({store: 'turns' as const, type: 'put' as const, value})),
          ...convs.map(([, value]) => ({store: 'convs' as const, type: 'put' as const, value})),
        ]
        await db.batch(operations)
        for (const [id, value] of turns) if (dirty.get(id) === value) dirty.delete(id)
        for (const [id, value] of convs) if (dirtyConvs.get(id) === value) dirtyConvs.delete(id)
        for (const [id, value] of details) if (dirtyDetails.get(id) === value) dirtyDetails.delete(id)
      }
      clearPersistenceError('chat-data')
    } catch (error) {reportPersistenceError('chat-data', error, flush); throw error}
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
function titleOf(prompt: string) {const title = prompt.replace(/\s+/g, ' ').trim(); return title.length > 28 ? `${title.slice(0, 28)}…` : title || '新对话'}
function accept(turn: StoredTurn) {
  dirty.set(turn.id, turn)
  if (turn.endedAt === undefined) active.set(turn.id, turn)
  else active.delete(turn.id)
  const old = knownConvs.get(turn.convId)
  const conv: Conv = {id: turn.convId, title: old?.title ?? titleOf(turn.prompt), createdAt: old?.createdAt ?? turn.startedAt, updatedAt: Date.now()}
  knownConvs.set(conv.id, conv); dirtyConvs.set(conv.id, conv)
  for (const read of reads) {
    if (read.convId === turn.convId) read.turns.set(turn.id, turn)
    if (!read.convId || read.convId === conv.id) read.convs.set(conv.id, conv)
  }
  set({convs: mergeConvs(state.convs), ...(turn.convId === state.convId ? {turns: overlay(state.turns, turn.convId), currentConv: conv} : {}), activeTurnIds: [...active.keys()]})
  schedule()
}
export function appendTurn(convId: string, turn: Turn): void {
  writable(convId)
  if (!knownConvs.has(convId) && !drafts.has(convId)) throw new Error('请先打开会话再追加内容。')
  if (dirty.has(turn.id) || active.has(turn.id) || state.turns.some(row => row.id === turn.id)) throw new Error('聊天轮次标识重复。')
  const split = splitTurn({...turn, convId})
  for (const detail of split.details) dirtyDetails.set(detail.id, detail)
  accept(split.turn)
}
function editable(convId: string, turnId: string): StoredTurn {
  const turn = active.get(turnId) ?? dirty.get(turnId) ?? state.turns.find(row => row.id === turnId)
  if (!turn || turn.convId !== convId) throw new Error('该轮聊天不在当前可编辑范围。')
  return turn
}
export function patchTurn(convId: string, turnId: string, patch: Partial<Omit<Turn, 'id' | 'convId' | 'tools'>>): void {
  writable(convId)
  const old = editable(convId, turnId)
  // 标识、归属和已发布工具引用只能由专用入口管理。
  const next = validateStoredTurn({...old, ...patch, id: old.id, convId: old.convId, tools: old.tools})
  accept(next)
}
export function appendTool(convId: string, turnId: string, tool: ToolStep): void {
  writable(convId)
  const old = editable(convId, turnId), index = old.tools.length
  const detail = validateToolDetail({id: toolDetailId(turnId, index), turnId, convId, index, text: tool.text, bytes: new TextEncoder().encode(tool.text).byteLength})
  const next = validateStoredTurn({...old, tools: [...old.tools, {name: tool.name, title: tool.title, ok: tool.ok, detailId: detail.id}]})
  dirtyDetails.set(detail.id, detail)
  accept(next)
}

export async function newConv(): Promise<string> {
  writable()
  const request = ++navigation
  opening = undefined
  await flush()
  if (request !== navigation) throw new Error('会话已切换，请重新发送。')
  writable()
  if (!state.currentConv && !state.turns.length) return state.convId
  const id = newId(); drafts.add(id); turnCursor = undefined; olderRequest = undefined
  writeStored(CONV_KEY, id)
  set({convId: id, currentConv: null, turns: [], hasOlderTurns: false, turnsLoading: false, turnsError: ''})
  return id
}
export async function openConv(id: string): Promise<void> {
  writable(id)
  const request = ++navigation
  opening = undefined
  olderRequest = undefined
  if (id === state.convId) {set({turnsLoading: false}); return}
  const target = {id, request}; opening = target
  const read = beginRead(id)
  set({turnsLoading: true, turnsError: ''})
  try {
    await flush()
    const raw = await db.get<unknown>('convs', id)
    if (raw === undefined) throw new Error('该会话不存在。')
    const current = validateConv(raw), page = await turnPage(id)
    if (request !== navigation) return
    writable(id)
    const latest = dirtyConvs.get(id) ?? read.convs.get(id) ?? current
    knownConvs.set(id, latest); turnCursor = page.cursor; olderRequest = undefined
    writeStored(CONV_KEY, id)
    set({convId: id, currentConv: latest, turns: overlay(page.rows, id, read), hasOlderTurns: page.more, turnsLoading: false, turnsError: ''})
  } catch (error) {if (request === navigation) set({turnsLoading: false}); throw error}
  finally {reads.delete(read); if (opening === target) opening = undefined}
}
export function loadOlderTurns(): Promise<void> {
  if (olderRequest) return olderRequest
  if (!state.hasOlderTurns) return Promise.resolve()
  const convId = state.convId, request = navigation, cursor = turnCursor
  const read = beginRead(convId)
  set({turnsLoading: true, turnsError: ''})
  const run = (async () => {
    try {
      const page = await turnPage(convId, cursor)
      if (request !== navigation || convId !== state.convId) return
      turnCursor = page.cursor
      set({turns: overlay([...page.rows, ...state.turns], convId, read), hasOlderTurns: page.more, turnsLoading: false, turnsError: ''})
    } catch (error) {if (request === navigation) set({turnsLoading: false, turnsError: message(error)}); throw error}
  })().finally(() => {reads.delete(read); if (olderRequest === run) olderRequest = undefined})
  olderRequest = run
  return run
}
export function loadMoreConvs(): Promise<void> {
  if (convRequest) return convRequest
  if (!state.hasMoreConvs) return Promise.resolve()
  const request = convGeneration, cursor = convCursor
  const read = beginRead()
  set({convsLoading: true, convsError: ''})
  const run = (async () => {
    try {
      const page = await convPage(cursor)
      if (request !== convGeneration) return
      convCursor = page.cursor
      set({convs: mergeConvs([...page.rows, ...state.convs], read), hasMoreConvs: page.more, convsLoading: false, convsError: ''})
    } catch (error) {if (request === convGeneration) set({convsLoading: false, convsError: message(error)}); throw error}
  })().finally(() => {reads.delete(read); if (convRequest === run) convRequest = undefined})
  convRequest = run
  return run
}
export async function deleteConv(id: string): Promise<void> {
  writable(id)
  if ([...active.values()].some(turn => turn.convId === id)) throw new Error('请先停止这个会话的生成，再删除。')
  deleting.add(id)
  // 删除另一会话不能使当前历史分页失效；只撤销正在读被删会话的导航。
  const invalidates = opening ? opening.id === id : state.convId === id
  const request = invalidates ? ++navigation : navigation
  if (invalidates) {opening = undefined; olderRequest = undefined; set({turnsLoading: false})}
  ++convGeneration; convRequest = undefined; set({convsLoading: false})
  try {
    await flush()
    const [turnIds, detailIds] = await Promise.all([db.keysByIndex('turns', 'convId', id), db.keysByIndex('toolDetails', 'convId', id)])
    assertPersistenceWritable()
    await db.batch([...turnIds.map(key => ({store: 'turns' as const, type: 'delete' as const, key})), ...detailIds.map(key => ({store: 'toolDetails' as const, type: 'delete' as const, key})), {store: 'convs', type: 'delete', key: id}])
    ++convGeneration; convRequest = undefined
    knownConvs.delete(id); drafts.delete(id)
    const convs = state.convs.filter(conv => conv.id !== id)
    if (state.convId === id && request === navigation) {
      const fresh = newId(); drafts.add(fresh); turnCursor = undefined; olderRequest = undefined
      writeStored(CONV_KEY, fresh)
      set({convs, convId: fresh, currentConv: null, turns: [], hasOlderTurns: false, turnsLoading: Boolean(opening), turnsError: '', convsLoading: false})
    } else set({convs, convsLoading: false})
  } finally {deleting.delete(id)}
}

export async function readToolDetail(detailId: string): Promise<string> {
  const pending = dirtyDetails.get(detailId)
  const raw = pending ?? await db.get<unknown>('toolDetails', detailId)
  if (raw === undefined) throw new Error('工具正文暂时无法读取，请重试；原记录未被删除。')
  const detail = validateToolDetail(raw)
  if (detail.id !== detailId) throw new Error('工具正文身份不匹配。')
  return (dirtyDetails.get(detailId) ?? detail).text
}

/** UI页数与模型上下文无关；不读取工具正文，仍保留原字符预算与至少一轮规则。 */
export async function loadContextTurns(convId: string, limit = 24): Promise<StoredTurn[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('上下文轮数必须在 1–100 之间。')
  const read = beginRead(convId)
  try {
    const page = await turnPage(convId, undefined, limit)
    return contextTurns(overlay(page.rows, convId, read).slice(-limit), limit)
  } finally {reads.delete(read)}
}
export function turnContent(turn: Pick<Turn, 'prompt' | 'article'>): string {return turn.article ? `${turn.article.context}\n\n用户的问题：\n${turn.prompt}` : turn.prompt}
export function contextTurns<T extends Pick<Turn, 'prompt' | 'article' | 'answer'>>(turns: T[], limit = 24): T[] {
  const picked: T[] = []; let size = 0
  for (let i = turns.length - 1; i >= 0 && picked.length < limit; i -= 1) {
    const turn = turns[i]; size += turnContent(turn).length + turn.answer.length
    if (picked.length && size > 36_000) break
    picked.unshift(turn)
  }
  return picked
}
export function useChat() {
  const snapshot = useSyncExternalStore(subscribe, getChatState)
  return {...snapshot, newConv, openConv, deleteConv, loadOlderTurns, loadMoreConvs, appendTurn, patchTurn, appendTool}
}
export async function exportChat() {
  await flush()
  const snapshot = await db.snapshot()
  validateStoredChat(snapshot.convs, snapshot.turns, snapshot.toolDetails)
  const details = new Map(snapshot.toolDetails.map(raw => {const detail = validateToolDetail(raw); return [detail.id, detail]}))
  return {convs: snapshot.convs.map(validateConv), turns: snapshot.turns.map(raw => hydrateTurn(validateStoredTurn(raw), details))}
}
export async function clearChat() {
  writable()
  if (active.size) throw new Error('请先停止生成，再清空聊天。')
  clearing = true
  try {
    await flush()
    assertPersistenceWritable()
    await db.batch([{store: 'convs', type: 'clear'}, {store: 'turns', type: 'clear'}, {store: 'toolDetails', type: 'clear'}])
    ++navigation; ++convGeneration
    olderRequest = undefined; convRequest = undefined; opening = undefined
    dirty.clear(); dirtyConvs.clear(); dirtyDetails.clear(); knownConvs.clear(); drafts.clear()
    const id = newId(); drafts.add(id); turnCursor = undefined; convCursor = undefined
    writeStored(CONV_KEY, id)
    set({convs: [], turns: [], convId: id, currentConv: null, activeTurnIds: [], hasOlderTurns: false, hasMoreConvs: false, turnsLoading: false, convsLoading: false, turnsError: '', convsError: ''})
  } finally {clearing = false}
}
export function beginTurn(prompt: string): Turn {return {id: newId(), prompt, answer: '', reasoning: '', tools: [], error: '', startedAt: Date.now()}}
export function isActive(turn: Pick<Turn, 'endedAt'>): boolean {return turn.endedAt === undefined}
export function elapsed(turn: Pick<Turn, 'startedAt' | 'endedAt'>): number | undefined {return turn.endedAt === undefined ? undefined : turn.endedAt - turn.startedAt}
