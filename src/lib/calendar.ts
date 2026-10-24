import ICAL from 'ical.js'
import {getDayDetail, getLunarDate, getLunarFestivals, getSolarTerms} from 'chinese-days'
import {SHARED, readData, writeData} from './componentData'
import {proxied} from './rss'
import {uid} from './store'

/**
 * 日历与日程的数据层。
 *
 * 分三块：
 *   1. 日期信息：农历、节气、传统节日、法定假日和调休（来自 chinese-days，离线可用）
 *   2. 自己的日程：存在共享命名空间里，日历组件、日程组件和 AI 工具读写的是同一份
 *   3. 订阅的日历：用户在设置里填 .ics 地址（Google / Apple / 滴答清单 / Outlook 都能导出），
 *      用 ical.js 解析，包含重复事件的展开
 */

/* ───────────── 日期小工具（一律用本地时区的 YYYY-MM-DD） ───────────── */

const pad2 = (n: number) => String(n).padStart(2, '0')

export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 'YYYY-MM-DD' → 本地当天 0 点；格式不对返回 null。 */
export function parseYmd(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return ymd(date) === text ? date : null
}

export function addDays(text: string, days: number): string {
  const date = parseYmd(text) ?? new Date()
  date.setDate(date.getDate() + days)
  return ymd(date)
}

/** b - a 的天数（按日历日算，不受夏令时影响）。 */
export function daysBetween(a: string, b: string): number {
  const da = parseYmd(a)
  const db = parseYmd(b)
  if (!da || !db) return 0
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000)
}

export const today = () => ymd(new Date())
export const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六']
export const weekdayOf = (text: string) => parseYmd(text)?.getDay() ?? 0

/* ───────────── 日期信息：农历 / 节气 / 节日 / 假日 ───────────── */

export type DayInfo = {
  date: string
  weekday: number
  /** 农历：初一显示月份（如「九月」），其余显示日（如「十五」） */
  lunar: string
  /** 完整农历，如「九月十五」 */
  lunarFull: string
  /** 传统节日（春节、中秋…）或常见的阳历节日（情人节…），没有就空 */
  festival?: string
  /** 当天正是某个节气 */
  term?: string
  /** 法定假日名称，如「国庆节」 */
  holiday?: string
  /** 放假（含周末） */
  rest: boolean
  /** 调休上班（周末被调成工作日） */
  makeup: boolean
  /** 一格里最该显示的那一行小字 */
  label: string
}

/** 农历节日里只留大家真的会过的；这个库里还有不少冷门的。 */
const LUNAR_FESTIVALS = new Set(['春节', '元宵节', '龙抬头', '端午节', '七夕', '中元节', '中秋节', '重阳节', '腊八节', '小年', '除夕', '寒衣节', '下元节'])

const SOLAR_FESTIVALS: Record<string, string> = {
  '02-14': '情人节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '05-04': '青年节',
  '06-01': '儿童节',
  '09-10': '教师节',
  '10-31': '万圣节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
}

const infoCache = new Map<string, DayInfo>()
const festivalYear = new Map<number, Map<string, string>>()
const termYear = new Map<number, Map<string, string>>()

function lunarFestivalsOf(year: number): Map<string, string> {
  let map = festivalYear.get(year)
  if (!map) {
    map = new Map()
    try {
      for (const item of getLunarFestivals(`${year}-01-01`, `${year}-12-31`)) {
        const name = item.name.find((n) => LUNAR_FESTIVALS.has(n))
        if (name) map.set(item.date, name)
      }
    } catch {
      /* 超出库支持的年份就当没有 */
    }
    festivalYear.set(year, map)
  }
  return map
}

function termsOf(year: number): Map<string, string> {
  let map = termYear.get(year)
  if (!map) {
    map = new Map()
    try {
      for (const item of getSolarTerms(`${year}-01-01`, `${year}-12-31`)) map.set(item.date, item.name)
    } catch {
      /* 同上 */
    }
    termYear.set(year, map)
  }
  return map
}

/** 一天的完整信息。结果带缓存，月历一次要问 42 天也不卡。 */
export function dayInfo(text: string): DayInfo {
  const cached = infoCache.get(text)
  if (cached) return cached
  const date = parseYmd(text) ?? new Date()
  const key = ymd(date)
  const year = date.getFullYear()

  let lunar = ''
  let lunarFull = ''
  try {
    const l = getLunarDate(key)
    const month = `${l.isLeap ? '闰' : ''}${l.lunarMonCN}`
    lunarFull = `${month}${l.lunarDayCN}`
    lunar = l.lunarDay === 1 ? month : l.lunarDayCN
  } catch {
    /* 超出 1900–2100 */
  }

  let holiday: string | undefined
  let rest = date.getDay() === 0 || date.getDay() === 6
  let makeup = false
  try {
    const detail = getDayDetail(key)
    const parts = detail.name.split(',')
    rest = !detail.work
    // 周末却要上班 = 调休补班；这种日子库里也带着节日名，但它不是假日，别当成假日显示
    makeup = detail.work && (date.getDay() === 0 || date.getDay() === 6)
    if (parts.length >= 2 && !makeup) holiday = parts[1]
  } catch {
    /* 没有这一年的假日数据，按周末算 */
  }

  const festival = lunarFestivalsOf(year).get(key) ?? SOLAR_FESTIVALS[key.slice(5)]
  const term = termsOf(year).get(key)
  const label = holiday ?? festival ?? term ?? lunar

  const info: DayInfo = {date: key, weekday: date.getDay(), lunar, lunarFull, festival, term, holiday, rest, makeup, label}
  infoCache.set(key, info)
  return info
}

/** 把 DayInfo 写成一句话，给界面和 AI 用。 */
export function describeDay(info: DayInfo): string {
  const parts = [`${info.date} 星期${WEEKDAYS_CN[info.weekday]}`]
  if (info.lunarFull) parts.push(`农历${info.lunarFull}`)
  const marks = [info.holiday && `法定假日：${info.holiday}`, info.festival && info.festival !== info.holiday && `节日：${info.festival}`, info.term && `节气：${info.term}`].filter(Boolean)
  if (marks.length) parts.push(marks.join('，'))
  parts.push(info.makeup ? '调休上班' : info.rest ? (info.holiday ? '放假' : '休息日') : '工作日')
  return parts.join('｜')
}

/** 月历要显示的 6 周 × 7 天；weekStart 0=周日开头，1=周一开头。 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): string[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() - weekStart + 7) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({length: 42}, (_, i) => ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))
}

/* ───────────── 自己的日程 ───────────── */

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export const REPEAT_LABEL: Record<Repeat, string> = {none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年'}

export type CalendarEvent = {
  id: string
  title: string
  /** 开始日期 YYYY-MM-DD */
  date: string
  /** 开始时间 HH:mm，没有就是全天 */
  time?: string
  endTime?: string
  /** 连续几天（全天事件用），默认 1 */
  days?: number
  repeat?: Repeat
  note?: string
  createdAt: number
}

/** 展开后落在某一天的一次事件。 */
export type Occurrence = {
  key: string
  /** 自己的日程才有；订阅来的为空，只读 */
  eventId?: string
  date: string
  title: string
  time?: string
  endTime?: string
  note?: string
  repeat?: Repeat
  /** 来自哪个订阅 */
  source?: string
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value)

const MAX_EVENTS = 2000

export function readEvents(): CalendarEvent[] {
  const list = readData<CalendarEvent[]>(SHARED.events, [])
  return Array.isArray(list) ? list : []
}

export function writeEvents(next: CalendarEvent[]) {
  writeData(SHARED.events, next.slice(0, MAX_EVENTS))
}

export type EventDraft = {title: string; date: string; time?: string; endTime?: string; days?: number; repeat?: Repeat; note?: string}

/** 校验并规整一条日程；不合法就抛出能直接念给用户听的错。 */
export function makeEvent(draft: EventDraft): CalendarEvent {
  const title = draft.title.trim().slice(0, 120)
  if (!title) throw new Error('日程要有标题。')
  if (!parseYmd(draft.date)) throw new Error(`日期格式要写成 YYYY-MM-DD，收到「${draft.date}」。`)
  if (draft.time && !isTime(draft.time)) throw new Error(`时间格式要写成 HH:mm，收到「${draft.time}」。`)
  if (draft.endTime && !isTime(draft.endTime)) throw new Error(`结束时间格式要写成 HH:mm，收到「${draft.endTime}」。`)
  const event: CalendarEvent = {id: uid(), title, date: draft.date, createdAt: Date.now()}
  if (draft.time) event.time = draft.time
  if (draft.time && draft.endTime) event.endTime = draft.endTime
  if (draft.days && draft.days > 1) event.days = Math.min(Math.floor(draft.days), 31)
  if (draft.repeat && draft.repeat !== 'none') event.repeat = draft.repeat
  const note = draft.note?.trim().slice(0, 500)
  if (note) event.note = note
  return event
}

function fits(event: CalendarEvent, day: string): boolean {
  const gap = daysBetween(event.date, day)
  if (gap < 0) return false
  switch (event.repeat ?? 'none') {
    case 'none':
      return gap < (event.days ?? 1)
    case 'daily':
      return true
    case 'weekly':
      return gap % 7 < (event.days ?? 1)
    case 'monthly': {
      const start = parseYmd(event.date)
      const date = parseYmd(day)
      return Boolean(start && date && start.getDate() === date.getDate())
    }
    case 'yearly':
      return event.date.slice(5) === day.slice(5)
  }
}

const byTime = (a: Occurrence, b: Occurrence) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'zh')

/** 自己的日程在 [from, to]（含）里的所有出现。区间最长 400 天。 */
export function occurrencesIn(events: CalendarEvent[], from: string, to: string): Occurrence[] {
  const span = Math.min(daysBetween(from, to), 400)
  const result: Occurrence[] = []
  for (let i = 0; i <= span; i += 1) {
    const day = addDays(from, i)
    for (const event of events) {
      if (fits(event, day)) result.push({key: `${event.id}@${day}`, eventId: event.id, date: day, title: event.title, time: event.time, endTime: event.endTime, note: event.note, repeat: event.repeat})
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
}

/* ───────────── 订阅的日历（.ics） ───────────── */

export type IcsSub = {id: string; name: string; url: string; enabled: boolean}

export function readSubs(): IcsSub[] {
  const list = readData<IcsSub[]>(SHARED.icsSubs, [])
  return Array.isArray(list) ? list : []
}
export const writeSubs = (next: IcsSub[]) => writeData(SHARED.icsSubs, next)

type Parsed = {fetchedAt: number; events: ICAL.Event[]}
const parsed = new Map<string, Parsed>()
const TTL = 10 * 60_000

async function load(sub: IcsSub, proxy: string, force: boolean): Promise<Parsed> {
  const hit = parsed.get(sub.url)
  if (hit && !force && Date.now() - hit.fetchedAt < TTL) return hit
  // webcal:// 是 https 的别名
  const url = sub.url.replace(/^webcal:\/\//i, 'https://')
  const res = await fetch(proxied(url, proxy))
  if (!res.ok) throw new Error(`${sub.name || sub.url} 返回 ${res.status}`)
  let text = await res.text()
  // AllOrigins 一类的代理会把正文包进 JSON
  if (text.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(text) as {contents?: string}
      if (typeof json.contents === 'string') text = json.contents
    } catch {
      /* 不是包装就按原文 */
    }
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(`${sub.name || sub.url} 不是有效的 .ics 日历`)
  const root = new ICAL.Component(ICAL.parse(text))
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent)
    if (event.isRecurrenceException()) exceptions.push(event)
    else masters.set(`${event.uid}|${masters.size}`, event)
  }
  const byUid = new Map<string, ICAL.Event>()
  for (const event of masters.values()) byUid.set(event.uid, event)
  for (const exception of exceptions) byUid.get(exception.uid)?.relateException(exception)
  const entry = {fetchedAt: Date.now(), events: [...masters.values()]}
  parsed.set(sub.url, entry)
  return entry
}

function expandIcs(sub: IcsSub, events: ICAL.Event[], from: string, to: string): Occurrence[] {
  const lo = parseYmd(from)
  const hi = parseYmd(to)
  if (!lo || !hi) return []
  const loMs = lo.getTime()
  const hiMs = hi.getTime() + 86_400_000
  const out: Occurrence[] = []
  const push = (start: ICAL.Time, end: ICAL.Time | null, event: ICAL.Event) => {
    const allDay = start.isDate
    const s = start.toJSDate()
    let e = end ? end.toJSDate() : s
    // 全天事件的结束日期在 ics 里是「不含」的，往回收一天
    if (allDay && e.getTime() > s.getTime()) e = new Date(e.getTime() - 86_400_000)
    const lastDay = ymd(e < s ? s : e)
    const firstDay = ymd(s)
    const length = Math.min(daysBetween(firstDay, lastDay), 31)
    for (let i = 0; i <= length; i += 1) {
      const day = addDays(firstDay, i)
      const dayMs = (parseYmd(day) as Date).getTime()
      if (dayMs < loMs || dayMs >= hiMs) continue
      out.push({
        key: `${sub.id}:${event.uid}@${day}${allDay ? '' : s.getTime()}`,
        date: day,
        title: event.summary || '（无标题）',
        time: allDay || i > 0 ? undefined : `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
        endTime: allDay || i > 0 || length > 0 ? undefined : `${pad2(e.getHours())}:${pad2(e.getMinutes())}`,
        note: event.description || undefined,
        source: sub.name || '订阅',
      })
    }
  }
  for (const event of events) {
    try {
      if (event.isRecurring()) {
        const iterator = event.iterator()
        for (let guard = 0; guard < 800; guard += 1) {
          const next = iterator.next()
          if (!next) break
          if (next.toJSDate().getTime() >= hiMs) break
          const detail = event.getOccurrenceDetails(next)
          push(detail.startDate, detail.endDate, detail.item)
        }
      } else {
        push(event.startDate, event.endDate, event)
      }
    } catch {
      /* 个别事件坏了就跳过，不影响其它 */
    }
  }
  return out
}

/** 所有启用的订阅在 [from, to] 里的事件。某个订阅失败不影响其它，错误一并带回。 */
export async function subscribedOccurrences(subs: IcsSub[], proxy: string, from: string, to: string, force = false): Promise<{items: Occurrence[]; errors: string[]}> {
  const items: Occurrence[] = []
  const errors: string[] = []
  await Promise.all(
    subs
      .filter((sub) => sub.enabled && sub.url.trim())
      .map(async (sub) => {
        try {
          const entry = await load(sub, proxy, force)
          items.push(...expandIcs(sub, entry.events, from, to))
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }),
  )
  return {items, errors}
}

export const sortOccurrences = (list: Occurrence[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))

/** 用户填的订阅地址：只收 http(s) 和 webcal。 */
export function cleanIcsUrl(raw: string): string | null {
  const text = raw.trim().replace(/^webcal:\/\//i, 'https://')
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
