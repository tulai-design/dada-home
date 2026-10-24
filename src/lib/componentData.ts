import {useCallback, useEffect, useState} from 'react'
import {db, openDb} from './db'

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
const pending = new Map<string, unknown>()
const gone = new Set<string>()
let timer: number | undefined

function key(instanceId: string): string {
  return `${PREFIX}${instanceId}`
}

function notify(instanceId: string) {
  listeners.get(instanceId)?.forEach((fn) => fn())
}

/** 合并短时间内对同一个实例的多次写入（比如在便签里打字），一次落库。 */
export async function flush() {
  window.clearTimeout(timer)
  timer = undefined
  const rows = [...pending].map(([k, v]) => ({k, v}))
  const dels = [...gone]
  pending.clear()
  gone.clear()
  if (rows.length) await db.putMany('kv', rows)
  if (dels.length) await db.delMany('kv', dels)
}

function schedule() {
  if (timer === undefined) timer = window.setTimeout(() => void flush(), 300)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush())
}

/**
 * 启动时调用一次（渲染前）：把组件数据读进内存。
 * 旧版放在 localStorage 的 `fp.data.*` 会被搬进 IndexedDB，搬完删掉旧的。
 */
export async function initComponentData(): Promise<void> {
  const handle = await openDb()
  if (!handle) return
  useIdb = true
  for (const row of await db.all<{k: string; v: unknown}>('kv')) cache.set(key(row.k), row.v)

  try {
    const legacy: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) legacy.push(k)
    }
    const rows: {k: string; v: unknown}[] = []
    for (const k of legacy) {
      const raw = localStorage.getItem(k)
      if (raw === null) continue
      // 库里已有同 id 的就以库里的为准（不应该发生，但别覆盖较新的数据）
      if (!cache.has(k)) {
        const v = JSON.parse(raw) as unknown
        cache.set(k, v)
        rows.push({k: k.slice(PREFIX.length), v})
      }
    }
    if (rows.length) await db.putMany('kv', rows)
    // 确认写入库后再删旧的；没写成功（库返回空）就留着，下次再搬
    const saved = new Set((await db.all<{k: string}>('kv')).map((row) => key(row.k)))
    for (const k of legacy) if (saved.has(k)) localStorage.removeItem(k)
  } catch {
    /* 旧数据解析失败就留在原处 */
  }
}

/** 恢复出厂：丢掉还没落库的写入，免得清库之后又被写回去。 */
export function dropPendingData() {
  window.clearTimeout(timer)
  timer = undefined
  pending.clear()
  gone.clear()
}

export function readData<T>(instanceId: string, fallback: T): T {
  const k = key(instanceId)
  if (cache.has(k)) return cache.get(k) as T
  if (!useIdb) {
    try {
      const raw = localStorage.getItem(k)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T
        cache.set(k, parsed)
        return parsed
      }
    } catch {
      /* 存储不可用时回落到默认值 */
    }
  }
  cache.set(k, fallback)
  return fallback
}

export function writeData<T>(instanceId: string, value: T) {
  const k = key(instanceId)
  cache.set(k, value)
  if (useIdb) {
    gone.delete(instanceId)
    pending.set(instanceId, value)
    schedule()
  } else {
    try {
      localStorage.setItem(k, JSON.stringify(value))
    } catch {
      /* 无痕模式或超额，只在内存里保留 */
    }
  }
  notify(instanceId)
}

export function removeData(instanceId: string) {
  const k = key(instanceId)
  cache.delete(k)
  if (useIdb) {
    pending.delete(instanceId)
    gone.add(instanceId)
    schedule()
  } else {
    try {
      localStorage.removeItem(k)
    } catch {
      /* 忽略 */
    }
  }
  notify(instanceId)
}

/** 导出全部组件数据：{实例id: 数据}。 */
export function exportAllData(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!useIdb) {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith(PREFIX)) continue
        const raw = localStorage.getItem(k)
        if (raw !== null) result[k.slice(PREFIX.length)] = JSON.parse(raw)
      }
    } catch {
      /* 读不到就导出已缓存的部分 */
    }
  }
  for (const [k, value] of cache) {
    if (k.startsWith(PREFIX)) result[k.slice(PREFIX.length)] = value
  }
  return result
}

/** 导入组件数据，覆盖同 id 的现有数据。 */
export function importAllData(data: Record<string, unknown>) {
  for (const [instanceId, value] of Object.entries(data)) writeData(instanceId, value)
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
