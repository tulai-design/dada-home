import type { Article, Feed } from './types'

/** 代理模板里用 {url} 占位；`direct` 表示不加代理。 */
export const PROXY_PRESETS = [
  { id: 'dev', label: '同源代理 /__proxy（需部署）', template: '/__proxy?url={url}' },
  { id: 'allorigins', label: 'AllOrigins', template: 'https://api.allorigins.win/get?url={url}' },
  { id: 'direct', label: '直连（需目标站放开 CORS）', template: '' },
] as const

export function proxied(url: string, template: string): string {
  if (!template.trim()) return url
  if (template.includes('{url}')) return template.replace('{url}', encodeURIComponent(url))
  return template + encodeURIComponent(url)
}

/** AllOrigins 的 /get 会把正文包进 JSON，这里统一剥掉。 */
function unwrapBody(text: string): string {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(text) as { contents?: string; body?: string; data?: string }
      const inner = json.contents ?? json.body ?? json.data
      if (typeof inner === 'string') return inner
    } catch {
      /* 不是包装格式，按原文处理 */
    }
  }
  return text
}

/** RSS 和热榜共用取数边界：避免 SPA 的 HTML 首页被当作数据。 */
export async function fetchSourceText(url: string, proxy: string, accept: string, label: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(proxied(url, proxy), {headers: {accept}, signal: controller.signal})
    if (!res.ok) throw new Error(`${label} 返回 ${res.status}，请检查源地址及「设置 → 网络」中的取数代理。`)
    const body = unwrapBody(await res.text())
    const start = body.replace(/^\uFEFF/, '').trimStart().replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '')
    if (/^<(?:!doctype\s+html\b|html\b|head\b|body\b)/i.test(start)) {
      throw new Error(`${label} 返回了 HTML 网页，取数代理可能未部署，或代理／源地址不正确。请检查「设置 → 网络」。`)
    }
    return body
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(`${label} 请求超时（15 秒），请检查网络和「设置 → 网络」中的取数代理。`)
    if (cause instanceof TypeError) throw new Error(`${label} 连接失败，请检查网络、源站跨域权限及「设置 → 网络」中的取数代理。`)
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

const TEXT_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'a', 'figure', 'figcaption', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'del', 'sup', 'sub', 'span', 'div'])

/** 只留阅读所需标签，脚本、样式、内联事件一律剔除。 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body
  root
    .querySelectorAll('script, style, iframe, object, embed, form, input, button, svg, video, audio, source, link, meta')
    .forEach((el) => el.remove())
  // 只遍历 body 的后代：html / head / body 本身不可被替换
  Array.from(root.querySelectorAll('*')).forEach((el) => {
    const tag = el.tagName.toLowerCase()
    if (!TEXT_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes))
      return
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const keep = (tag === 'a' && name === 'href') ||
        (tag === 'img' && (name === 'src' || name === 'alt')) ||
        name === 'class'
      if (!keep) el.removeAttribute(attr.name)
    }
    if (tag === 'a') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noreferrer noopener')
    }
    if (tag === 'img') {
      el.setAttribute('loading', 'lazy')
    }
  })
  return root.innerHTML
}

/** HN 这类源的正文只有链接元信息，判定为「没有真正内容」。 */
export function isMetadataOnly(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return true
  const stripped = text
    .replace(/\b(Article URL|Comments URL|Points|# Comments|Comments):\s*\S+/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\s·,.;]+/g, '')
  return stripped.length < 24
}

export function plainText(html: string, limit = 220): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = (doc.body.textContent ?? '')
    // HN 这类源会在正文里塞链接元信息，不该出现在摘要里
    .replace(/^\s*(Article URL|Comments URL|Points|# Comments|Comments):.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function tagText(el: Element | null, names: string[]): string {
  if (!el) return ''
  for (const name of names) {
    const hit = el.getElementsByTagName(name)[0] ?? el.getElementsByTagNameNS('*', name)[0]
    if (hit?.textContent) return hit.textContent.trim()
  }
  return ''
}

function atomLink(el: Element): string {
  const links = Array.from(el.getElementsByTagNameNS('*', 'link'))
  const alt = links.find((l) => l.getAttribute('rel') === 'alternate' || !l.getAttribute('rel'))
  return alt?.getAttribute('href') ?? links[0]?.getAttribute('href') ?? ''
}

function absolute(url: string, base: string): string {
  if (!url) return base
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

export async function fetchFeed(feed: Feed, proxyTemplate: string): Promise<Article[]> {
  const label = feed.title || feed.url
  if (!feed.url.trim()) throw new Error(`${label || '订阅源'} 尚未填写地址。`)
  const xml = await fetchSourceText(feed.url, proxyTemplate, 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', label)
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error(`${label} 的 XML 解析失败，请确认地址返回 RSS / Atom。`)

  const root = doc.documentElement
  const isAtom = root.localName === 'feed' && root.namespaceURI === 'http://www.w3.org/2005/Atom'
  const isRss = root.localName === 'rss' && Boolean(root.querySelector('channel'))
  const isRdf = root.localName === 'RDF' && root.namespaceURI === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' && Boolean(root.getElementsByTagNameNS('http://purl.org/rss/1.0/', 'channel').length)
  if (!isAtom && !isRss && !isRdf) throw new Error(`${label} 返回的内容不是 RSS / Atom 订阅，请检查源地址及取数代理。`)

  const rssItems = Array.from(doc.getElementsByTagName('item'))
  const atomEntries = Array.from(doc.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'entry'))
  const nodes = isAtom ? atomEntries : rssItems
  const feedTitle = tagText(doc.documentElement, ['title']) || feed.title

  return nodes.slice(0, 40).map((node, i) => {
    const title = tagText(node, ['title']) || '无标题'
    const link = isAtom ? atomLink(node) : tagText(node, ['link'])
    const dateRaw = tagText(node, isAtom ? ['updated', 'published'] : ['pubDate', 'dc:date'])
    const contentRaw =
      tagText(node, ['content:encoded']) || tagText(node, ['content']) || tagText(node, ['description', 'summary'])
    const date = dateRaw ? new Date(dateRaw).getTime() : Date.now()
    return {
      id: `${feed.id}:${link || i}:${date}`,
      title,
      link: absolute(link, feed.url),
      source: feedTitle,
      date: Number.isFinite(date) ? date : Date.now(),
      excerpt: plainText(contentRaw, 180),
      content: contentRaw,
      linkOnly: isMetadataOnly(contentRaw),
    }
  })
}

export async function fetchAllFeeds(feeds: Feed[], proxyTemplate: string): Promise<{ articles: Article[]; errors: string[] }> {
  const settled = await Promise.allSettled(
    feeds.filter((f) => f.enabled !== false && f.url.trim()).map((f) => fetchFeed(f, proxyTemplate)),
  )
  const articles: Article[] = []
  const errors: string[] = []
  settled.forEach((r) => {
    if (r.status === 'fulfilled') articles.push(...r.value)
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  })
  // 让 useResource 保留上次成功内容；部分失败时仍可展示正常源。
  if (settled.length && errors.length === settled.length) throw new Error(`所有订阅源读取失败：${errors.slice(0, 3).join('；')}${errors.length > 3 ? `；另有 ${errors.length - 3} 个源失败` : ''}`)
  articles.sort((a, b) => b.date - a.date)
  return { articles, errors }
}
