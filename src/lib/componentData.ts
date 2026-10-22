import {useCallback, useEffect, useState} from 'react'

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
const cache = new Map<string, unknown>()

function key(instanceId: string): string {
  return `${PREFIX}${instanceId}`
}

function notify(instanceId: string) {
  listeners.get(instanceId)?.forEach((fn) => fn())
}

export function readData<T>(instanceId: string, fallback: T): T {
  const k = key(instanceId)
  if (cache.has(k)) return cache.get(k) as T
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
  cache.set(k, fallback)
  return fallback
}

export function writeData<T>(instanceId: string, value: T) {
  const k = key(instanceId)
  cache.set(k, value)
  try {
    localStorage.setItem(k, JSON.stringify(value))
  } catch {
    /* 无痕模式或超额，只在内存里保留 */
  }
  notify(instanceId)
}

export function removeData(instanceId: string) {
  const k = key(instanceId)
  cache.delete(k)
  try {
    localStorage.removeItem(k)
  } catch {
    /* 忽略 */
  }
  notify(instanceId)
}

/** 导出全部组件数据：{实例id: 数据}。 */
export function exportAllData(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
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
