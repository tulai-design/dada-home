import { useCallback, useEffect, useState } from 'react'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()
const memory = new Map<string, unknown>()

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

function readUncached<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`fp.${key}`)
    const parsed = raw ? JSON.parse(raw) as T : fallback
    clearPersistenceError(`settings-read:${key}`)
    return parsed
  } catch (error) {
    reportPersistenceError(`settings-read:${key}`, error, error instanceof SyntaxError ? undefined : () => {
      // 实际重读权限；缓存中的未保存编辑不能被磁盘旧值覆盖。
      const value = readUncached(key, fallback)
      if (!memory.has(key)) memory.set(key, value)
      notify(key)
    }, !(error instanceof SyntaxError))
    throw error
  }
}

export function readStored<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T
  try {
    const value = readUncached(key, fallback)
    memory.set(key, value)
    return value
  } catch {return fallback}
}

function persistStored(key: string) {
  const source = `settings:${key}`
  try {
    localStorage.setItem(`fp.${key}`, JSON.stringify(memory.get(key)))
    clearPersistenceError(source)
    clearPersistenceError(`settings-read:${key}`)
  } catch (error) {
    reportPersistenceError(source, error, () => persistStored(key))
    throw error
  }
}

export function writeStored<T>(key: string, value: T) {
  assertPersistenceWritable()
  memory.set(key, value)
  try {persistStored(key)} catch { /* 错误已登记，保留当前编辑值供用户重试。 */ }
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
