/** NewsHub 热榜聚合。文档：https://newshub.shenzjd.com/api */
import { fetchSourceText } from './rss'

export const NEWSHUB_ORIGIN = 'https://newshub.shenzjd.com'

const LEGACY_HOT = 'codelife.cc'

export const DEFAULT_HOT_BOARDS = ['zhihu', 'weibo', 'ithome']

export type HotItem = { title: string; url?: string; heat?: string }

export type HotSource = { id: string; name: string; column?: string }

export type HotBoard = { id: string; name: string; items: HotItem[]; error?: string }

export const HOT_COLUMNS: { id: string; label: string }[] = [
  { id: 'china', label: '综合' },
  { id: 'tech', label: '科技' },
  { id: 'finance', label: '财经' },
  { id: 'world', label: '国际' },
]

/** 旧的单接口地址换成聚合站的源站；已经是某个源站时只保留 origin。 */
export function hotOrigin(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed.includes(LEGACY_HOT)) return NEWSHUB_ORIGIN
  try {
    return new URL(trimmed).origin
  } catch {
    return NEWSHUB_ORIGIN
  }
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

function formatScore(n: number): string {
  if (n >= 10000) {
    const wan = n / 10000
    return `${wan >= 10 ? Math.round(wan) : wan.toFixed(1)}万`
  }
  return String(n)
}

function heatOf(row: Record<string, unknown>): string | undefined {
  if (typeof row.score === 'number' && row.score > 0) return formatScore(row.score)
  const extra = row.extra
  if (extra && typeof extra === 'object') {
    const info = (extra as Record<string, unknown>).info
    if (typeof info === 'string' && info.trim()) return info.replace(/^热度[:：]\s*/, '').trim()
  }
  return undefined
}

function itemOf(row: unknown): HotItem | null {
  if (!row || typeof row !== 'object') return null
  const obj = row as Record<string, unknown>
  if (typeof obj.title !== 'string') return null
  const title = cleanTitle(obj.title)
  if (!title) return null
  return { title, url: typeof obj.url === 'string' ? obj.url : undefined, heat: heatOf(obj) }
}

async function readJson(url: string, proxy: string): Promise<unknown> {
  const text = await fetchSourceText(url, proxy, 'application/json', '热榜接口')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('热榜接口返回的内容不是 JSON，请检查源站地址和「设置 → 网络」中的取数代理。')
  }
}

export async function fetchSources(origin: string, proxy: string): Promise<HotSource[]> {
  const json = (await readJson(`${hotOrigin(origin)}/api/v1/sources`, proxy)) as { sources?: unknown[] } | null
  if (!json || !Array.isArray(json.sources)) throw new Error('热榜源列表缺少 sources 数组，请确认源站提供 NewsHub 兼容接口。')
  const sources = json.sources.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const obj = row as Record<string, unknown>
    if (obj.enabled === false) return []
    if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return []
    return [{ id: obj.id, name: obj.name, column: typeof obj.column === 'string' ? obj.column : undefined }]
  })
  if (!sources.length) throw new Error('热榜接口没有返回可用榜单，请检查源站是否正常。')
  return sources
}

export async function fetchBoards(origin: string, ids: string[], proxy: string, limit = 16): Promise<HotBoard[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (!unique.length) return []
  const url = `${hotOrigin(origin)}/api/v1/batch?sources=${encodeURIComponent(unique.join(','))}&limit=${Math.min(50, Math.max(1, limit))}`
  const json = (await readJson(url, proxy)) as { results?: unknown[] } | null
  if (!json || !Array.isArray(json.results)) throw new Error('热榜数据缺少 results 数组，请确认源站提供 NewsHub 兼容接口。')
  const results = json.results
  const byId = new Map<string, HotBoard>()
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>
    if (typeof obj.id !== 'string') continue
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name : obj.id
    const data = Array.isArray(obj.data) ? obj.data : []
    const items = data.map(itemOf).filter((item): item is HotItem => Boolean(item))
    byId.set(obj.id, {
      id: obj.id,
      name,
      items,
      error: obj.success === false ? '这一榜暂时没有数据' : !Array.isArray(obj.data) || (data.length > 0 && !items.length) ? '这一榜返回的数据格式不正确' : undefined,
    })
  }
  const boards = unique.map((id) => byId.get(id) ?? { id, name: id, items: [], error: '未返回这一榜' })
  if (boards.every((board) => board.error)) throw new Error(`热榜读取失败：${boards.map((board) => `${board.name}：${board.error}`).join('；')}`)
  return boards
}
