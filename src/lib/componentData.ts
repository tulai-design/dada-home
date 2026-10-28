import {useCallback, useEffect, useState} from 'react'
import {db, openDb, type DbOperation} from './db'
import {commitWithSync} from './incrementalLocal'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'

/**
 * 组件数据存储。
 *
 * 每个组件实例的数据放在自己的命名空间里：`data.<实例id>`。
 * 好处是导出时能清楚看到「哪块数据属于哪个组件」，删除组件时数据一并清掉，
 * 同一类型放两个实例（比如两张便签）也不会互相覆盖。
 *
 * 与工作空间结构（页面、布局、配置）分开存放：结构小而稳定，数据可能很大。
 */

const PREFIX = 'fp.data.'

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()
/** 全部组件数据的内存副本。启动时一次性从 IndexedDB 读进来，之后读写都是同步的。 */
const cache = new Map<string, unknown>()
/** IndexedDB 可用时为 true；不可用就继续用 localStorage。 */
let useIdb = false
type Pending = {version: number; value?: unknown; deleted: boolean}
const pending = new Map<string, Pending>()
let version = 0
let timer: number | undefined
let flushing: Promise<void> | undefined

function key(instanceId: string): string {return `${PREFIX}${instanceId}`}
function notify(instanceId: string) {listeners.get(instanceId)?.forEach(fn => fn())}

function persistFallback(id: string, item: Pending) {
  if (item.deleted) localStorage.removeItem(key(id))
  else localStorage.setItem(key(id), JSON.stringify(item.value))
}

/** 串行排空已接受的改动；只有事务提交后才确认对应版本。 */
export function flush(): Promise<void> {
  window.clearTimeout(timer)
  timer = undefined
  if (flushing) return flushing.then(() => pending.size ? flush() : undefined)
  const work = async () => {
    try {
      while (pending.size) {
        const batch = [...pending]
        if (useIdb) {
          const operations: DbOperation[] = batch.map(([id, item]) => item.deleted
            ? {store: 'kv', type: 'delete', key: id}
            : {store: 'kv', type: 'put', value: {k: id, v: item.value}})
          await commitWithSync(operations, batch.map(([id]) => ({collection: 'component' as const, key: id})))
        } else {
          for (const [id, item] of batch) persistFallback(id, item)
        }
        for (const [id, item] of batch) if (pending.get(id) === item) pending.delete(id)
      }
      clearPersistenceError('component-data')
    } catch (error) {
      reportPersistenceError('component-data', error, flush)
      throw error
    }
  }
  const run = work().finally(() => {if (flushing === run) flushing = undefined})
  flushing = run
  return run
}

function backgroundFlush() {void flush().catch(() => undefined)}
function schedule() {
  if (timer === undefined) timer = window.setTimeout(backgroundFlush, 300)
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', backgroundFlush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && backgroundFlush())
}

/** 初始化失败不会发布空缓存；单条损坏的旧 JSON 保留，其他合法记录继续迁移。 */
export async function initComponentData(): Promise<void> {
  const handle = await openDb()
  if (!handle) {useIdb = false; return}
  const rows = await db.all<{k: string; v: unknown}>('kv')
  const loaded = new Map(rows.map(row => [key(row.k), row.v]))
  const legacy: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const name = localStorage.key(i)
    if (name?.startsWith(PREFIX)) legacy.push(name)
  }
  const toMigrate: {k: string; v: unknown}[] = []
  for (const name of legacy) {
    if (loaded.has(name)) {clearPersistenceError(`legacy-component:${name}`); continue}
    const raw = localStorage.getItem(name)
    if (raw === null) continue
    try {toMigrate.push({k: name.slice(PREFIX.length), v: JSON.parse(raw) as unknown}); clearPersistenceError(`legacy-component:${name}`)}
    catch (error) {reportPersistenceError(`legacy-component:${name}`, new Error('有一份旧组件数据无法解析，原数据已保留。'), undefined, false)}
  }
  if (toMigrate.length) await commitWithSync(toMigrate.map(value => ({store: 'kv' as const, type: 'put' as const, value})), toMigrate.map(row => ({collection: 'component' as const, key: row.k})))
  // 重新读取已提交的记录，避免请求完成但事务失败时删除唯一来源。
  const saved = await db.all<{k: string; v: unknown}>('kv')
  for (const row of saved) loaded.set(key(row.k), row.v)
  for (const name of legacy) if (loaded.has(name)) localStorage.removeItem(name)
  cache.clear()
  for (const [name, value] of loaded) cache.set(name, value)
  useIdb = true
}

/** 仅在调用方已等待 flush 后用于替换生命周期；不能取消正在提交的事务。 */
export function dropPendingData() {
  window.clearTimeout(timer)
  timer = undefined
  pending.clear()
}

export function readData<T>(instanceId: string, fallback: T): T {
  const name = key(instanceId)
  if (cache.has(name)) return cache.get(name) as T
  if (!useIdb) {
    try {
      const raw = localStorage.getItem(name)
      if (raw !== null) {const value = JSON.parse(raw) as T; cache.set(name, value); return value}
    } catch (error) {reportPersistenceError(`component-read:${instanceId}`, error, undefined, !(error instanceof SyntaxError))}
  }
  cache.set(name, fallback)
  return fallback
}

export function writeData<T>(instanceId: string, value: T) {
  assertPersistenceWritable()
  cache.set(key(instanceId), value)
  const item: Pending = {version: ++version, value, deleted: false}
  pending.set(instanceId, item)
  if (useIdb) schedule()
  else {
    try {persistFallback(instanceId, item); pending.delete(instanceId); if (!pending.size) clearPersistenceError('component-data')}
    catch (error) {reportPersistenceError('component-data', error, flush)}
  }
  notify(instanceId)
}

export function removeData(instanceId: string) {
  assertPersistenceWritable()
  cache.delete(key(instanceId))
  const item: Pending = {version: ++version, deleted: true}
  pending.set(instanceId, item)
  if (useIdb) schedule()
  else {
    try {persistFallback(instanceId, item); pending.delete(instanceId); if (!pending.size) clearPersistenceError('component-data')}
    catch (error) {reportPersistenceError('component-data', error, flush)}
  }
  notify(instanceId)
}

/** 导出不隐瞒无法读取的回落数据；备份调用方另需等待 flush。 */
export function exportAllData(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!useIdb) {
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i)
      if (!name?.startsWith(PREFIX)) continue
      const raw = localStorage.getItem(name)
      if (raw !== null) result[name.slice(PREFIX.length)] = JSON.parse(raw) as unknown
    }
  }
  for (const [name, value] of cache) if (name.startsWith(PREFIX)) result[name.slice(PREFIX.length)] = value
  return result
}

export function importAllData(data: Record<string, unknown>) {
  for (const [id, value] of Object.entries(data)) writeData(id, value)
}

/**
 * 共享数据命名空间。
 *
 * 有些数据跨组件共用：订阅源列表被所有「订阅」卡片共用，书签同理。
 * 这类数据存在固定 id 下（以 @ 开头，与实例 id 区分），
 * 既能被多个实例共享，又照样进导出、能被识别归属。
 */
export const SHARED = {
  feeds: '@shared.feeds',
  feedsRead: '@shared.feedsRead',
  bookmarks: '@shared.bookmarks',
  /** 自己的日程（日历、日程组件和 AI 共用） */
  events: '@shared.events',
  /** 订阅的 .ics 日历 */
  icsSubs: '@shared.icsSubs',
  /** 倒数日 */
  countdowns: '@shared.countdowns',
  /** 专注记录（番茄钟完成的每一段） */
  focusLog: '@shared.focusLog',
  /** 播放列表 */
  music: '@shared.music',
} as const

/** 组件读写自己那份数据。 */
export function useComponentData<T>(instanceId: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readData(instanceId, fallback))

  useEffect(() => {
    setValue(readData(instanceId, fallback))
    const fn = () => setValue(readData(instanceId, fallback))
    let set = listeners.get(instanceId)
    if (!set) {
      set = new Set()
      listeners.set(instanceId, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
    }
    // fallback 只作初值，不参与订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = readData(instanceId, fallback)
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(current) : next
      writeData(instanceId, resolved)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instanceId],
  )

  return [value, update] as const
}
