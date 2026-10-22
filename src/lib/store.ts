import { useCallback, useEffect, useState } from 'react'

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()
const memory = new Map<string, unknown>()

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

export function readStored<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T
  try {
    const raw = localStorage.getItem(`fp.${key}`)
    if (raw) {
      const parsed = JSON.parse(raw) as T
      memory.set(key, parsed)
      return parsed
    }
  } catch {
    /* 存储不可用时静默回落到默认值 */
  }
  memory.set(key, fallback)
  return fallback
}

export function writeStored<T>(key: string, value: T) {
  memory.set(key, value)
  try {
    localStorage.setItem(`fp.${key}`, JSON.stringify(value))
  } catch {
    /* 无痕模式或超额，只在内存里保留 */
  }
  notify(key)
}

export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))

  useEffect(() => {
    const fn = () => setValue(readStored(key, fallback))
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
    }
    // fallback 作为初值，不参与订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = readStored(key, fallback)
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(current) : next
      writeStored(key, resolved)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  return [value, update] as const
}

export const uid = () => Math.random().toString(36).slice(2, 10)
