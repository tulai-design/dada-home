import {createToolFactory} from '@tulai-design/agent-core'
import {OPEN_TARGETS} from './defaults'
import {isAlwaysAllowed} from './permissions'
import {providerInfo, readSearchConfig, searchReady, webFetch, webSearch} from './webSearch'
import {readStored} from './store'
import type {HomeToolContext} from './tools'

/**
 * 搜索相关的工具，分两类，别混：
 *
 *   open_search  帮用户「去搜」：在新标签页打开某个搜索引擎的结果页。结果是用户自己看的。
 *                要经过用户同意；用户点过「总是允许」后不再问。
 *   web_search / web_fetch  给模型「自己查」：通过用户配好的搜索 API 拿结构化结果，读完再回答。
 *                用户在设置里填了服务商和密钥才可用。
 */

const define = createToolFactory<HomeToolContext, void>()

const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

async function guard(run: () => string | Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    return `没有成功：${error instanceof Error ? error.message : String(error)}`
  }
}

const NOT_READY = '联网搜索还没配好。让用户在设置的「联网搜索」里选一个服务商并填密钥（可以用 open_settings 带他去，section 填 search）；在那之前，可以用 open_search 帮他在浏览器里搜。'

/** 搜索结果页的链接；引擎名对不上时退回用户首页输入框在用的引擎，再退回谷歌。 */
export function searchUrl(query: string, engine?: string): {url: string; label: string} {
  const mode = readStored<string>('searchMode', 'ai')
  const target = OPEN_TARGETS.find((t) => t.id === engine) ?? OPEN_TARGETS.find((t) => t.id === mode) ?? OPEN_TARGETS[0]
  return {url: target.url + encodeURIComponent(query), label: target.label}
}

export const SEARCH_TOOLS = [
  define(
    {
      schema: {parse: (raw) => ({query: str(obj(raw).query), engine: str(obj(raw).engine) || undefined})},
      json: {
        type: 'object',
        properties: {
          query: {type: 'string', description: '要搜的关键词，原样放进搜索框'},
          engine: {type: 'string', enum: OPEN_TARGETS.map((t) => t.id), description: `去哪搜：${OPEN_TARGETS.map((t) => `${t.id}（${t.label}）`).join('、')}。用户没说就不填，会用他首页输入框在用的引擎。`},
        },
        required: ['query'],
      },
    },
    {
      name: 'open_search',
      title: '搜索并跳转',
      description: '在浏览器新标签页里打开某个搜索引擎（或 GitHub、YouTube、B 站、知乎等站内搜索）的结果页，让用户自己去看。用户说「去谷歌搜一下 xx」「在 B 站找 xx」时用。你自己读不到结果页的内容；想自己查资料再回答，用 web_search。需要用户同意。',
      effect: 'read',
      highRisk: () => !isAlwaysAllowed('open_search'),
      execute: async (args) =>
        guard(() => {
          if (!args.query) throw new Error('没说搜什么')
          const {url, label} = searchUrl(args.query, args.engine)
          if (args.engine && !OPEN_TARGETS.some((t) => t.id === args.engine)) throw new Error(`不认识这个搜索引擎：${args.engine}`)
          const opened = window.open(url, '_blank', 'noopener')
          return opened
            ? `已在新标签页用${label}搜索「${args.query}」。`
            : `浏览器拦截了自动打开的标签页。把这个链接给用户，让他点一下：${url}（也可以让他在地址栏右侧允许本站的弹出窗口）`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const o = obj(raw)
          return {query: str(o.query), limit: num(o.limit), news: o.news === true, days: num(o.days)}
        },
      },
      json: {
        type: 'object',
        properties: {
          query: {type: 'string', description: '搜索词。写具体、带上关键限定，比「天气」好的是「郑州 明天 天气」'},
          limit: {type: 'integer', minimum: 1, maximum: 10, description: '要几条，默认 5'},
          news: {type: 'boolean', description: '只看新闻'},
          days: {type: 'integer', minimum: 1, maximum: 365, description: '只看最近几天内的'},
        },
        required: ['query'],
      },
    },
    {
      name: 'web_search',
      title: '联网搜索',
      description: '通过用户配好的搜索服务（Tavily、Firecrawl、SearXNG、Exa、Brave 之一）搜网页，返回标题、链接、摘要。需要最新信息、事实核对、查资料时用；回答时给出处链接。结果不够细就对其中的链接用 web_fetch 读正文。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args, context) =>
        guard(async () => {
          if (!args.query) throw new Error('没说搜什么')
          const config = readSearchConfig()
          if (!searchReady(config)) return NOT_READY
          const result = await webSearch(args.query, {limit: args.limit, news: args.news, days: args.days, signal: context.signal}, config)
          const name = providerInfo(config.provider)?.name ?? ''
          if (!result.hits.length && !result.answer) return `${name} 没有搜到「${args.query}」的结果。换个说法再试。`
          return [
            `用 ${name} 搜「${args.query}」，${result.hits.length} 条：`,
            result.answer ? `\n搜索服务给的概括：${result.answer}\n` : '',
            ...result.hits.map((hit, i) => `${i + 1}. ${hit.title || hit.url}${hit.date ? `（${hit.date}）` : ''}\n   ${hit.url}\n   ${hit.snippet.replace(/\s+/g, ' ')}`),
          ].join('\n')
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({url: str(obj(raw).url), maxChars: num(obj(raw).maxChars)})},
      json: {
        type: 'object',
        properties: {
          url: {type: 'string', description: '网页地址，http 或 https'},
          maxChars: {type: 'integer', minimum: 500, maximum: 12000, description: '最多读多少字，默认 5000'},
        },
        required: ['url'],
      },
    },
    {
      name: 'web_fetch',
      title: '读取网页',
      description: '读一个网页的正文。通常用在 web_search 找到链接之后。Tavily、Firecrawl、Exa 能读得更干净；没有这些时用「网络」里的代理直接取，靠脚本渲染的页面可能读不到。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args, context) =>
        guard(async () => {
          let url: URL
          try {
            url = new URL(args.url)
          } catch {
            throw new Error('网址不对')
          }
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只能读 http 或 https 网页')
          const max = Math.max(500, Math.min(12000, Math.trunc(args.maxChars ?? 5000)))
          const text = await webFetch(url.href, max, context.signal)
          return `${url.href}\n\n${text}`
        }),
    },
  ),
] as const
