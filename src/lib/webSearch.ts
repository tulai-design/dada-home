import {proxied, plainText} from './rss'
import {readStored} from './store'

/**
 * 给模型用的联网搜索。
 *
 * 和首页的搜索框不是一回事：搜索框是用户自己搜、自己看结果；
 * 这里是搭搭拿到搜索结果后自己读、自己回答。所以需要能返回结构化结果的搜索 API。
 * 密钥只存在这台浏览器里，请求直接从浏览器发给服务商；不经过任何中转。
 */

export type SearchProvider = 'off' | 'tavily' | 'firecrawl' | 'searxng' | 'exa' | 'brave'

export type SearchConfig = {
  provider: SearchProvider
  /** 每个服务商各存一个密钥，切换时不丢 */
  keys: Partial<Record<SearchProvider, string>>
  /** SearXNG 实例地址；Firecrawl 自托管时的地址（留空用官方） */
  urls: Partial<Record<SearchProvider, string>>
}

export const defaultSearchConfig = (): SearchConfig => ({provider: 'off', keys: {}, urls: {}})

export const SEARCH_KEY = 'search'

export type ProviderInfo = {
  id: Exclude<SearchProvider, 'off'>
  name: string
  /** 一句话：它是什么、适合谁 */
  note: string
  needsKey: boolean
  /** 要不要用户填实例地址 */
  needsUrl: boolean
  urlPlaceholder?: string
  keyPlaceholder?: string
  /** 能不能读单个网页的正文 */
  canFetch: boolean
  signup: string
}

export const SEARCH_PROVIDERS: ProviderInfo[] = [
  {id: 'tavily', name: 'Tavily', note: '专为 AI 做的搜索，结果干净，还会给一句现成的答案。有免费额度。', needsKey: true, needsUrl: false, keyPlaceholder: 'tvly-…', canFetch: true, signup: 'https://app.tavily.com'},
  {id: 'firecrawl', name: 'Firecrawl', note: '搜索加网页抓取，能把整页转成干净的 Markdown。可自托管。', needsKey: true, needsUrl: false, urlPlaceholder: 'https://api.firecrawl.dev（自托管才需要改）', keyPlaceholder: 'fc-…', canFetch: true, signup: 'https://www.firecrawl.dev'},
  {id: 'searxng', name: 'SearXNG', note: '自己搭的元搜索引擎，不需要密钥。实例要开启 JSON 输出，并允许跨域。', needsKey: false, needsUrl: true, urlPlaceholder: 'https://searx.example.com', canFetch: false, signup: 'https://docs.searxng.org'},
  {id: 'exa', name: 'Exa', note: '语义搜索，适合找资料、找相似内容。', needsKey: true, needsUrl: false, keyPlaceholder: 'Exa API Key', canFetch: true, signup: 'https://dashboard.exa.ai'},
  {id: 'brave', name: 'Brave Search', note: '独立索引的搜索 API，有免费档。', needsKey: true, needsUrl: false, keyPlaceholder: 'BSA…', canFetch: false, signup: 'https://brave.com/search/api/'},
]

export const providerInfo = (id: SearchProvider): ProviderInfo | undefined => SEARCH_PROVIDERS.find((p) => p.id === id)

export const readSearchConfig = (): SearchConfig => {
  const stored = readStored<Partial<SearchConfig>>(SEARCH_KEY, {})
  return {...defaultSearchConfig(), ...stored, keys: {...stored.keys}, urls: {...stored.urls}}
}

/** 当前是否配好、可以搜。 */
export function searchReady(config: SearchConfig): boolean {
  const info = providerInfo(config.provider)
  if (!info) return false
  if (info.needsKey && !config.keys[info.id]?.trim()) return false
  if (info.needsUrl && !config.urls[info.id]?.trim()) return false
  return true
}

export type SearchHit = {title: string; url: string; snippet: string; date?: string}
export type SearchResult = {hits: SearchHit[]; answer?: string}
export type SearchOptions = {limit?: number; news?: boolean; days?: number; signal?: AbortSignal}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text)
const asStr = (v: unknown) => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : [])
const trimSlash = (url: string) => url.trim().replace(/\/+$/, '')

/** 跨域或断网时浏览器只会抛 TypeError，这里把它说成人话。 */
function networkHint(info: ProviderInfo, error: unknown): Error {
  if (error instanceof TypeError) {
    return new Error(
      info.id === 'searxng'
        ? '连不上 SearXNG：检查地址，并确认实例允许跨域（或在「网络」里配了可用的代理）'
        : `连不上 ${info.name}：网络不通，或者这个服务不允许浏览器直接请求（跨域）`,
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function failure(info: ProviderInfo, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await res.text()
    const json = JSON.parse(body) as Record<string, unknown>
    const inner = rec(json.detail).error ?? json.error ?? json.message ?? json.detail
    detail = typeof inner === 'string' ? inner : body
  } catch {
    /* 不是 JSON 就不带细节 */
  }
  const reason = res.status === 401 || res.status === 403 ? '密钥无效或没有权限' : res.status === 429 ? '请求太频繁或额度用完了' : `返回 ${res.status}`
  return new Error(`${info.name} ${reason}${detail ? `：${clip(detail, 120)}` : ''}`)
}

async function postJson(info: ProviderInfo, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body), signal})
  } catch (error) {
    throw networkHint(info, error)
  }
  if (!res.ok) throw await failure(info, res)
  return rec(await res.json())
}

async function getJson(info: ProviderInfo, url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, {headers, signal})
  } catch (error) {
    // 自托管的 SearXNG 常常没开跨域：退一步走「网络」里配的代理
    const proxy = rec(readStored<unknown>('settings', {})).proxy
    if (info.id !== 'searxng' || typeof proxy !== 'string' || !proxy.trim()) throw networkHint(info, error)
    try {
      res = await fetch(proxied(url, proxy), {headers, signal})
    } catch {
      throw networkHint(info, error)
    }
  }
  if (!res.ok) throw await failure(info, res)
  return rec(await res.json())
}

export async function webSearch(query: string, options: SearchOptions = {}, config: SearchConfig = readSearchConfig()): Promise<SearchResult> {
  const info = providerInfo(config.provider)
  if (!info) throw new Error('还没有开启联网搜索')
  if (!searchReady(config)) throw new Error(`${info.name} 还没配好`)
  const key = (config.keys[info.id] ?? '').trim()
  const limit = Math.max(1, Math.min(10, Math.trunc(options.limit ?? 5)))
  const {signal} = options

  switch (info.id) {
    case 'tavily': {
      const data = await postJson(info, 'https://api.tavily.com/search', {authorization: `Bearer ${key}`}, {
        query,
        max_results: limit,
        include_answer: true,
        topic: options.news ? 'news' : 'general',
        ...(options.days ? {days: options.days, time_range: options.days <= 1 ? 'day' : options.days <= 7 ? 'week' : options.days <= 31 ? 'month' : 'year'} : {}),
      }, signal)
      return {
        answer: asStr(data.answer) || undefined,
        hits: list(data.results).map((r) => ({title: asStr(r.title), url: asStr(r.url), snippet: clip(asStr(r.content), 400), date: asStr(r.published_date) || undefined})),
      }
    }
    case 'firecrawl': {
      const base = trimSlash(config.urls.firecrawl || 'https://api.firecrawl.dev')
      const data = await postJson(info, `${base}/v2/search`, {authorization: `Bearer ${key}`}, {query, limit, ...(options.news ? {sources: ['news']} : {})}, signal)
      const inner = rec(data.data)
      // v2 把结果按来源分组放在 data.web / data.news；老接口直接是数组
      const rows = Array.isArray(data.data) ? list(data.data) : [...list(inner.web), ...list(inner.news)]
      return {hits: rows.slice(0, limit).map((r) => ({title: asStr(r.title), url: asStr(r.url), snippet: clip(asStr(r.description) || asStr(r.snippet), 400), date: asStr(r.date) || undefined}))}
    }
    case 'searxng': {
      const base = trimSlash(config.urls.searxng ?? '')
      const range = options.days ? (options.days <= 1 ? 'day' : options.days <= 7 ? 'week' : options.days <= 31 ? 'month' : 'year') : ''
      const url = `${base}/search?${new URLSearchParams({q: query, format: 'json', ...(options.news ? {categories: 'news'} : {}), ...(range ? {time_range: range} : {})})}`
      const data = await getJson(info, url, {accept: 'application/json'}, signal)
      return {hits: list(data.results).slice(0, limit).map((r) => ({title: asStr(r.title), url: asStr(r.url), snippet: clip(asStr(r.content), 400), date: asStr(r.publishedDate) || undefined}))}
    }
    case 'exa': {
      const data = await postJson(info, 'https://api.exa.ai/search', {'x-api-key': key}, {
        query,
        numResults: limit,
        contents: {text: {maxCharacters: 500}},
        ...(options.news ? {category: 'news'} : {}),
        ...(options.days ? {startPublishedDate: new Date(Date.now() - options.days * 86400000).toISOString()} : {}),
      }, signal)
      return {hits: list(data.results).map((r) => ({title: asStr(r.title), url: asStr(r.url), snippet: clip(asStr(r.text), 400), date: asStr(r.publishedDate) || undefined}))}
    }
    case 'brave': {
      const freshness = options.days ? (options.days <= 1 ? 'pd' : options.days <= 7 ? 'pw' : options.days <= 31 ? 'pm' : 'py') : ''
      const url = `https://api.search.brave.com/res/v1/${options.news ? 'news' : 'web'}/search?${new URLSearchParams({q: query, count: String(limit), ...(freshness ? {freshness} : {})})}`
      const data = await getJson(info, url, {accept: 'application/json', 'x-subscription-token': key}, signal)
      const rows = options.news ? list(data.results) : list(rec(data.web).results)
      return {hits: rows.slice(0, limit).map((r) => ({title: asStr(r.title), url: asStr(r.url), snippet: clip(plainText(asStr(r.description), 400), 400), date: asStr(r.age) || undefined}))}
    }
  }
}

/** 读单个网页的正文：服务商有抓取接口就用它，没有就退回「网络」里的代理直接取。 */
export async function webFetch(url: string, maxChars: number, signal?: AbortSignal, config: SearchConfig = readSearchConfig()): Promise<string> {
  const info = providerInfo(config.provider)
  const key = info ? (config.keys[info.id] ?? '').trim() : ''

  if (info && searchReady(config) && info.canFetch) {
    switch (info.id) {
      case 'tavily': {
        const data = await postJson(info, 'https://api.tavily.com/extract', {authorization: `Bearer ${key}`}, {urls: [url]}, signal)
        const text = asStr(list(data.results)[0]?.raw_content)
        if (text) return clip(text, maxChars)
        break
      }
      case 'firecrawl': {
        const base = trimSlash(config.urls.firecrawl || 'https://api.firecrawl.dev')
        const data = await postJson(info, `${base}/v2/scrape`, {authorization: `Bearer ${key}`}, {url, formats: ['markdown'], onlyMainContent: true}, signal)
        const text = asStr(rec(data.data).markdown)
        if (text) return clip(text, maxChars)
        break
      }
      case 'exa': {
        const data = await postJson(info, 'https://api.exa.ai/contents', {'x-api-key': key}, {urls: [url], text: {maxCharacters: maxChars}}, signal)
        const text = asStr(list(data.results)[0]?.text)
        if (text) return clip(text, maxChars)
        break
      }
    }
  }

  const proxy = rec(readStored<unknown>('settings', {})).proxy
  const res = await fetch(proxied(url, typeof proxy === 'string' ? proxy : ''), {signal})
  if (!res.ok) throw new Error(`网页返回 ${res.status}`)
  const text = plainText(await res.text(), maxChars)
  if (!text) throw new Error('没读到正文（可能是靠脚本渲染的页面）')
  return text
}
