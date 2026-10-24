import {useMemo} from 'react'
import {SHARED, useComponentData} from './componentData'
import {occurrencesIn, sortOccurrences, subscribedOccurrences, type CalendarEvent, type IcsSub, type Occurrence} from './calendar'
import {useResource} from './resource'

/**
 * 某段日期里所有的日程：自己的（本地）加上订阅的（.ics，取数走代理）。
 * 日历、日程两个组件共用；订阅的结果由 useResource 去重，放几个组件都只请求一次。
 */
export function useOccurrences(from: string, to: string, proxy: string) {
  const [events] = useComponentData<CalendarEvent[]>(SHARED.events, [])
  const [subs] = useComponentData<IcsSub[]>(SHARED.icsSubs, [])
  const active = useMemo(() => subs.filter((sub) => sub.enabled && sub.url.trim()), [subs])
  const signature = active.map((sub) => sub.url).join(',')
  const remote = useResource(`ics|${proxy}|${signature}|${from}|${to}`, () => subscribedOccurrences(active, proxy, from, to), {every: 600_000, enabled: active.length > 0})

  const items = useMemo<Occurrence[]>(() => sortOccurrences([...occurrencesIn(events, from, to), ...(active.length ? (remote.data?.items ?? []) : [])]), [events, from, to, active.length, remote.data])
  return {items, errors: [...(remote.data?.errors ?? []), ...(remote.error ? [remote.error] : [])], loading: remote.loading, hasSubs: active.length > 0, refresh: () => subscribedOccurrences(active, proxy, from, to, true).then(() => remote.refresh())}
}
