import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react'

/**
 * 共享远程数据层。
 *
 * 问题：订阅、天气、热榜都要联网。如果每个组件实例自己 fetch，
 * 用户（或 AI）在两个页面各放一张订阅卡片，就会重复请求同一批源。
 *
 * 做法：以 key 标识一份远程数据，同一个 key 的所有订阅者共享一次请求、一份结果。
 * 组件只管 `useResource(key, fetcher)`，不关心缓存和去重。
 */

export type ResourceState<T> = {
  data: T | undefined
  loading: boolean
  error: string
  /** 最近一次成功的时间戳 */
  updatedAt: number
}

type Entry<T> = {
  state: ResourceState<T>
  fetcher: (() => Promise<T>) | null
  inflight: Promise<void> | null
  listeners: Set<() => void>
}

const entries = new Map<string, Entry<unknown>>()

function entryFor<T>(key: string): Entry<T> {
  let entry = entries.get(key) as Entry<T> | undefined
  if (!entry) {
    entry = {
      state: {data: undefined, loading: false, error: '', updatedAt: 0},
      fetcher: null,
      inflight: null,
      listeners: new Set(),
    }
    entries.set(key, entry as Entry<unknown>)
  }
  return entry
}

function emit(entry: Entry<unknown>) {
  entry.listeners.forEach((fn) => fn())
}

/** 拉取一次；已有进行中的请求就复用它。 */
function load<T>(key: string): Promise<void> {
  const entry = entryFor<T>(key)
  if (!entry.fetcher) return Promise.resolve()
  if (entry.inflight) return entry.inflight
  entry.state = {...entry.state, loading: true, error: ''}
  emit(entry as Entry<unknown>)
  const run = entry
    .fetcher()
    .then((data) => {
      entry.state = {data, loading: false, error: '', updatedAt: Date.now()}
    })
    .catch((cause: unknown) => {
      entry.state = {...entry.state, loading: false, error: cause instanceof Error ? cause.message : String(cause)}
    })
    .finally(() => {
      entry.inflight = null
      emit(entry as Entry<unknown>)
    })
  entry.inflight = run
  return run
}

/**
 * 订阅一份共享远程数据。
 *
 * @param key      数据标识；相同 key 共享。必须把影响结果的参数拼进去（代理、城市、源列表……）。
 * @param fetcher  取数函数；key 不变时以最近一次传入的为准。
 * @param options.every  自动刷新间隔（毫秒），不填则只在首次订阅时取一次。
 * @param options.enabled  false 时不取数（例如还没配置）。
 */
export function useResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {every?: number; enabled?: boolean} = {},
) {
  const {every, enabled = true} = options
  const entry = entryFor<T>(key)
  entry.fetcher = fetcher

  // snapshot 必须是稳定引用：state 只在变化时才换新对象
  const state = useSyncExternalStore(
    useCallback(
      (listener) => {
        entry.listeners.add(listener)
        return () => {
          entry.listeners.delete(listener)
        }
      },
      [entry],
    ),
    () => entry.state,
  )

  const started = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    if (started.current === key) return
    started.current = key
    // 已经有较新的结果（别的组件刚取过）就不重复请求
    if (entry.state.updatedAt && Date.now() - entry.state.updatedAt < 30_000) return
    void load<T>(key)
  }, [key, enabled, entry])

  useEffect(() => {
    if (!enabled || !every) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load<T>(key)
    }, every)
    return () => window.clearInterval(timer)
  }, [key, every, enabled])

  const refresh = useCallback(() => load<T>(key), [key])
  return {...state, refresh} as ResourceState<T> & {refresh: () => Promise<void>}
}
