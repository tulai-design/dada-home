import { useEffect, useRef, useState } from 'react'

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])
  useEffect(() => {
    if (delay === null) return
    const id = window.setInterval(() => saved.current(), delay)
    return () => window.clearInterval(id)
  }, [delay])
}

export function useHotkeys(onKey: (e: KeyboardEvent) => void) {
  const saved = useRef(onKey)
  useEffect(() => {
    saved.current = onKey
  }, [onKey])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => saved.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

export function useLocalHour() {
  const now = useNow(30000)
  return now.getHours()
}

/** 只在窗口重新可见时刷新，避免标签页常驻时反复请求。 */
export function useVisible(callback: () => void) {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') saved.current()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
}
