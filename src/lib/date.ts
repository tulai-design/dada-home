const DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1–31 的中文写法，二十几用「廿」，读起来更像旧历书。 */
export function cnDay(n: number): string {
  if (n <= 0) return ''
  if (n < 10) return DIGITS[n]
  if (n === 10) return '十'
  if (n < 20) return `十${DIGITS[n % 10]}`
  if (n === 20) return '二十'
  if (n < 30) return `廿${DIGITS[n % 10]}`
  if (n === 30) return '三十'
  return `三十${DIGITS[n % 10]}`
}

export function cnYear(year: number): string {
  return String(year)
    .split('')
    .map((d) => DIGITS[Number(d)])
    .join('')
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function weekdayCn(d: Date): string {
  return `星期${WEEKDAYS[d.getDay()]}`
}

export function monthDayCn(d: Date): string {
  return `${cnDay(d.getMonth() + 1)}月${cnDay(d.getDate())}日`
}

export function fullDateCn(d: Date): string {
  return `公元${cnYear(d.getFullYear())}年${monthDayCn(d)}`
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function clockText(d: Date, withSeconds = true): string {
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

export function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 5) return '夜深了'
  if (h < 8) return '清晨好'
  if (h < 11) return '早上好'
  if (h < 13) return '午安'
  if (h < 17) return '下午好'
  if (h < 19) return '傍晚好'
  if (h < 23) return '晚上好'
  return '夜深了'
}

export function relativeTime(input: string | number | Date, now = Date.now()): string {
  const t = new Date(input).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function shortTime(input: string | number | Date): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
