import {getLunarDate, getSolarDateFromLunar} from 'chinese-days'
import {daysBetween, parseYmd, today, ymd} from './calendar'
import {SHARED, readData, writeData} from './componentData'
import {uid} from './store'

/**
 * 倒数日：距离某一天还有几天，或者某件事已经过去几天。
 *
 * 一条记录只存「那一天」和是否每年重复：
 *   - 不重复：过了就变成「已经 N 天」（相当于正数日）
 *   - 每年重复：生日、纪念日，永远指向下一个
 *   - 农历：date 里写的是农历的月和日（年份随便，取出生那年即可），每年换算成当年的阳历
 */
export type Countdown = {
  id: string
  title: string
  /** YYYY-MM-DD；lunar 为真时是农历的年月日 */
  date: string
  repeat?: 'none' | 'yearly'
  lunar?: boolean
  /** 一个 emoji，可选 */
  icon?: string
  createdAt: number
}

const MAX = 200

export function readCountdowns(): Countdown[] {
  const list = readData<Countdown[]>(SHARED.countdowns, [])
  return Array.isArray(list) ? list : []
}
export const writeCountdowns = (next: Countdown[]) => writeData(SHARED.countdowns, next.slice(0, MAX))

export type CountdownDraft = {title: string; date: string; repeat?: 'none' | 'yearly'; lunar?: boolean; icon?: string}

/**
 * 新建一条倒数日。
 * lunar 为真时，date 仍然写阳历（用户和 AI 都只需要知道阳历），这里换算成农历的月日存下来，
 * 之后每年按农历重新换算；农历只对「每年重复」有意义，所以会强制成每年。
 */
export function makeCountdown(draft: CountdownDraft): Countdown {
  const title = draft.title.trim().slice(0, 60)
  if (!title) throw new Error('倒数日要有名字。')
  if (!parseYmd(draft.date)) throw new Error(`日期格式要写成 YYYY-MM-DD，收到「${draft.date}」。`)
  const item: Countdown = {id: uid(), title, date: draft.date, createdAt: Date.now()}
  if (draft.lunar) {
    let l
    try {
      l = getLunarDate(draft.date)
    } catch {
      throw new Error('这个日期超出了农历换算的范围（1900–2100 年）。')
    }
    item.lunar = true
    item.repeat = 'yearly'
    item.date = `${l.lunarYear}-${String(l.lunarMon).padStart(2, '0')}-${String(l.lunarDay).padStart(2, '0')}`
  } else if (draft.repeat === 'yearly') item.repeat = 'yearly'
  const icon = draft.icon?.trim()
  if (icon) item.icon = [...icon].slice(0, 2).join('')
  return item
}

/** 倒数日的原始日期换回阳历显示用：农历的取今年（或最近一次）的对应阳历。 */
export function lunarLabel(item: Countdown): string {
  if (!item.lunar) return ''
  const [, m, d] = item.date.split('-').map(Number)
  const months = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
  const days = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
  return `农历${months[m] ?? `${m}月`}${days[d] ?? d}`
}

export type Resolved = {
  /** 这条倒数日落在哪一天（每年重复的是下一次） */
  on: string
  /** 距今几天：未来为正，今天为 0，过去为负 */
  days: number
  /** 每年重复时，这是第几个周年 */
  nth?: number
}

/** 农历的某月某日在指定年份对应的阳历日期。 */
function solarOfLunar(year: number, mmdd: string): string | null {
  try {
    return getSolarDateFromLunar(`${year}-${mmdd}`).date
  } catch {
    return null
  }
}

export function resolve(item: Countdown, from = today()): Resolved | null {
  if (item.repeat !== 'yearly') {
    const on = item.lunar ? solarOfLunar(Number(item.date.slice(0, 4)), item.date.slice(5)) : item.date
    return on ? {on, days: daysBetween(from, on)} : null
  }
  const startYear = Number(item.date.slice(0, 4))
  const thisYear = Number(from.slice(0, 4))
  for (let year = thisYear; year <= thisYear + 1; year += 1) {
    const on = item.lunar ? solarOfLunar(year, item.date.slice(5)) : yearlyOn(item.date, year)
    if (on && daysBetween(from, on) >= 0) return {on, days: daysBetween(from, on), nth: year - startYear}
  }
  return null
}

/** 阳历每年重复：2 月 29 日在平年落到 2 月 28 日。 */
function yearlyOn(date: string, year: number): string {
  const [, m, d] = date.split('-').map(Number)
  const made = new Date(year, m - 1, d)
  if (made.getMonth() !== m - 1) return ymd(new Date(year, m - 1, d - 1))
  return ymd(made)
}

export function describe(item: Countdown, from = today()): string {
  const r = resolve(item, from)
  if (!r) return '日期无法换算'
  const when = r.days === 0 ? '就是今天' : r.days > 0 ? `还有 ${r.days} 天` : `已经 ${-r.days} 天`
  const extra = r.nth && r.nth > 0 ? `，第 ${r.nth} 个周年` : ''
  return `${when}（${r.on}）${extra}`
}

/** 按「最近要到的」排序：未来的由近到远，过去的排在后面（越新越靠前）。 */
export function sortCountdowns(list: Countdown[], from = today()): {item: Countdown; resolved: Resolved | null}[] {
  const withDays = list.map((item) => ({item, resolved: resolve(item, from)}))
  return withDays.sort((a, b) => {
    const da = a.resolved?.days ?? Number.POSITIVE_INFINITY
    const db = b.resolved?.days ?? Number.POSITIVE_INFINITY
    if (da >= 0 && db >= 0) return da - db
    if (da >= 0) return -1
    if (db >= 0) return 1
    return db - da
  })
}
