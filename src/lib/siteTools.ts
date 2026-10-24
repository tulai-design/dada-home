import {createToolFactory} from '@tulai-design/agent-core'
import {SHARED, readData, writeData} from './componentData'
import {SEARCH_ENGINES, defaultFeeds, defaultSettings} from './defaults'
import {WorkspaceError} from './errors'
import {DEFAULT_HOT_BOARDS, fetchBoards, fetchSources} from './hot'
import {isInstalled} from './market'
import {probe, summarize} from './monitor'
import {fetchAllFeeds, plainText} from './rss'
import {findSkill, SKILLS} from './skills'
import {readStored, uid, writeStored} from './store'
import {isAlwaysAllowed} from './permissions'
import {providerInfo, readSearchConfig, searchReady} from './webSearch'
import type {Article, Feed, Settings, Todo} from './types'
import {fetchWeather, geocode} from './weather'
import {getWorkspace} from './workspaceStore'
import type {HomeToolContext} from './tools'

/**
 * 站点功能的工具：订阅、热榜、待办、便签、天气、监控、全局设置、技能。
 *
 * 和 tools.ts 里「搭页面」的工具分开放，因为它们面对的是用户的内容和偏好，不是页面结构。
 * 原则：
 *   - 读的都放开，写的都经过校验；
 *   - 删除类、覆盖类标成高危，走审批；
 *   - 密钥（AI 的 API Key、监控的令牌和密码）永远不经过这里：不读、不写、不展示。
 */

const define = createToolFactory<HomeToolContext, void>()

type Obj = Record<string, unknown>
const obj = (raw: unknown): Obj => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Obj) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optStr = (value: unknown): string | undefined => str(value) || undefined
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])

async function guard(run: () => string | Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof WorkspaceError) return `没有成功：${error.message}`
    return `没有成功：${error instanceof Error ? error.message : String(error)}`
  }
}

const settings = (): Settings => ({...defaultSettings(), ...readStored<Partial<Settings>>('settings', {})})
const patchSettings = (part: Partial<Settings>) => writeStored('settings', {...readStored<Partial<Settings>>('settings', {}), ...part})

const httpUrl = (raw: string): string | null => {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/* ---------- 订阅 ---------- */

const MAX_FEEDS = 50

/** 订阅源第一次被用到时把默认源落库，这样工具和界面看到的是同一批（含同样的 id）。 */
function feedList(): Feed[] {
  const stored = readData<Feed[] | null>(SHARED.feeds, null)
  if (Array.isArray(stored)) return stored
  const seeded = defaultFeeds()
  writeData(SHARED.feeds, seeded)
  return seeded
}
const saveFeeds = (feeds: Feed[]) => writeData(SHARED.feeds, feeds)

/** 最近一次读到的文章，read_article 在里面按链接找全文。 */
let lastArticles: Article[] = []

const dateText = (ms: number) => new Date(ms).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false})

/* ---------- 待办、便签 ---------- */

type Slot = {id: string; page: string; title: string}

function slots(type: 'todos' | 'note'): Slot[] {
  return getWorkspace().pages.flatMap((page) =>
    page.components.filter((c) => c.type === type).map((c) => ({id: c.id, page: page.name, title: c.title || (typeof c.config.heading === 'string' ? c.config.heading : '') || (type === 'todos' ? '待办' : '便签')})),
  )
}

/** 找到要操作的那一个待办/便签实例：没指定且只有一个就用它，多个就让模型选。 */
function slotFor(type: 'todos' | 'note', ref: string | undefined): Slot {
  const label = type === 'todos' ? '待办' : '便签'
  const all = slots(type)
  if (!all.length) throw new WorkspaceError(`页面上还没有${label}组件。书桌里有待办和便签：先 install_addon 装上 desk，或者 add_component 放一个。`)
  if (ref) {
    const hit = all.find((slot) => slot.id === ref)
    if (!hit) throw new WorkspaceError(`没有这个${label}组件：${ref}。现有：${all.map((s) => `${s.id}（${s.page}｜${s.title}）`).join('、')}`)
    return hit
  }
  if (all.length > 1) throw new WorkspaceError(`有 ${all.length} 个${label}组件，请用 ref 指定：${all.map((s) => `${s.id}（${s.page}｜${s.title}）`).join('、')}`)
  return all[0]
}

const todosOf = (id: string) => readData<Todo[]>(id, [])

function searchLine(): string {
  const config = readSearchConfig()
  const info = providerInfo(config.provider)
  if (!info) return '未开启（web_search 不可用；密钥由用户自己在设置里填，你不能改）'
  return `${info.name}｜${searchReady(config) ? '已配好，可用 web_search' : '还没配好（缺密钥或地址）'}`
}

const SECTION_HINT = 'profile 个人｜appearance 外观｜templates 模板｜sidebar 侧栏｜statusbar 状态条｜ai 搭搭 AI｜soul 灵魂｜memory 记忆｜network 网络｜search 联网搜索｜data 数据｜about 关于｜feeds 订阅｜hot 热榜｜bookmarks 书签｜weather 天气｜monitor 监控｜calendar 日历（订阅 .ics）｜focus 番茄钟'

export const SITE_TOOLS = [
  /* ───── 订阅 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_feeds',
      title: '查看订阅源',
      description: '列出用户订阅的 RSS 源（id｜名称｜地址｜是否启用）。想知道用户在看什么，或要增删订阅源之前先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const feeds = feedList()
        if (!feeds.length) return '还没有订阅任何源。'
        return `共 ${feeds.length} 个订阅源\n${feeds.map((f) => `${f.id}｜${f.title || '（未命名）'}｜${f.url}｜${f.enabled === false ? '已停用' : '启用'}`).join('\n')}`
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({source: optStr(obj(raw).source), query: optStr(obj(raw).query), limit: num(obj(raw).limit)})},
      json: {
        type: 'object',
        properties: {
          source: {type: 'string', description: '只看某个来源（名称里包含这段文字即可）'},
          query: {type: 'string', description: '标题或摘要里包含的关键词'},
          limit: {type: 'number', description: '最多返回几篇，默认 15，最多 40'},
        },
      },
    },
    {
      name: 'read_feeds',
      title: '读取订阅文章',
      description: '实时抓取已启用订阅源的最新文章，按时间倒序返回（时间｜来源｜标题｜链接｜摘要）。「总结今天的订阅」「有什么新文章」「帮我找关于 X 的文章」都用它。要看某篇全文用 read_article。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          const feeds = feedList().filter((f) => f.enabled !== false)
          if (!feeds.length) return '没有启用的订阅源。可以用 add_feed 添加。'
          const {articles, errors} = await fetchAllFeeds(feeds, settings().proxy)
          lastArticles = articles
          const q = args.query?.toLowerCase()
          const picked = articles
            .filter((a) => !args.source || a.source.includes(args.source))
            .filter((a) => !q || a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q))
            .slice(0, Math.min(40, Math.max(1, args.limit ?? 15)))
          const lines = picked.map((a) => `${dateText(a.date)}｜${a.source}｜${a.title}｜${a.link}｜${a.excerpt.slice(0, 100)}`)
          const notes = errors.length ? `\n（有 ${errors.length} 个源没抓到：${errors.slice(0, 3).join('；')}）` : ''
          return lines.length ? `共抓到 ${articles.length} 篇，列出 ${lines.length} 篇\n${lines.join('\n')}${notes}` : `没有符合条件的文章（共抓到 ${articles.length} 篇）。${notes}`
        }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({link: str(obj(raw).link)})}, json: {type: 'object', properties: {link: {type: 'string', description: 'read_feeds 返回的文章链接'}}, required: ['link']}},
    {
      name: 'read_article',
      title: '读取文章全文',
      description: '读一篇订阅文章的正文（来自订阅源自带的内容，最多约 4000 字）。需要先用 read_feeds 抓过。有些源只给标题和链接，没有正文，这时如实告诉用户。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args) => {
        const hit = lastArticles.find((a) => a.link === args.link)
        if (!hit) return '没找到这篇。先用 read_feeds 抓一次，再用它返回的链接。'
        if (hit.linkOnly) return `「${hit.title}」的订阅源只提供了标题和链接，没有正文：${hit.link}`
        return `${hit.title}｜${hit.source}｜${dateText(hit.date)}\n${plainText(hit.content, 4000)}`
      },
    },
  ),
  define(
    {schema: {parse: (raw) => ({url: str(obj(raw).url), title: optStr(obj(raw).title)})}, json: {type: 'object', properties: {url: {type: 'string', description: 'RSS 或 Atom 地址'}, title: {type: 'string', description: '名称，可不填'}}, required: ['url']}},
    {
      name: 'add_feed',
      title: '添加订阅源',
      description: '订阅一个 RSS/Atom 地址。已经订阅过的地址会跳过。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const url = httpUrl(args.url)
          if (!url) throw new WorkspaceError('订阅地址必须是 http(s) 开头的有效网址。')
          const feeds = feedList()
          if (feeds.some((f) => f.url.replace(/\/$/, '') === url.replace(/\/$/, ''))) throw new WorkspaceError('这个地址已经订阅过了。')
          if (feeds.length >= MAX_FEEDS) throw new WorkspaceError(`订阅源最多 ${MAX_FEEDS} 个。`)
          const feed: Feed = {id: uid(), title: args.title ?? new URL(url).hostname.replace(/^www\./, ''), url, enabled: true}
          saveFeeds([...feeds, feed])
          return `已订阅「${feed.title}」，id=${feed.id}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id), title: optStr(obj(raw).title), enabled: bool(obj(raw).enabled)})},
      json: {type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, enabled: {type: 'boolean', description: 'false 停用但保留，true 重新启用'}}, required: ['id']},
    },
    {
      name: 'update_feed',
      title: '修改订阅源',
      description: '改订阅源的名称，或停用/启用它。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const feeds = feedList()
          const hit = feeds.find((f) => f.id === args.id)
          if (!hit) throw new WorkspaceError(`没有这个订阅源：${args.id}`)
          saveFeeds(feeds.map((f) => (f.id === args.id ? {...f, ...(args.title ? {title: args.title} : {}), ...(args.enabled !== undefined ? {enabled: args.enabled} : {})} : f)))
          return `已更新「${args.title ?? hit.title}」。`
        }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({id: str(obj(raw).id)})}, json: {type: 'object', properties: {id: {type: 'string'}}, required: ['id']}},
    {
      name: 'remove_feed',
      title: '取消订阅',
      description: '删除一个订阅源。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const feeds = feedList()
          const hit = feeds.find((f) => f.id === args.id)
          if (!hit) throw new WorkspaceError(`没有这个订阅源：${args.id}`)
          saveFeeds(feeds.filter((f) => f.id !== args.id))
          return `已取消订阅「${hit.title}」。`
        }),
    },
  ),

  /* ───── 热榜 ───── */
  define(
    {schema: {parse: (raw) => ({boards: strList(obj(raw).boards), limit: num(obj(raw).limit)})}, json: {type: 'object', properties: {boards: {type: 'array', items: {type: 'string'}, description: '榜单 id，不填就用用户关注的那几个'}, limit: {type: 'number', description: '每榜几条，默认 10，最多 30'}}}},
    {
      name: 'get_hot',
      title: '查看热榜',
      description: '实时读取热榜（标题｜热度｜链接）。不指定 boards 时读用户在设置里关注的榜单。榜单 id 用 list_hot_sources 查。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          const s = settings()
          const ids = args.boards.length ? args.boards : s.hotBoards?.length ? s.hotBoards : DEFAULT_HOT_BOARDS
          const boards = await fetchBoards(s.hotSource, ids, s.proxy, Math.min(30, Math.max(1, args.limit ?? 10)))
          return boards
            .map((b) => `# ${b.name}（${b.id}）${b.error ? `｜${b.error}` : ''}\n${b.items.map((i, n) => `${n + 1}. ${i.title}${i.heat ? `｜${i.heat}` : ''}${i.url ? `｜${i.url}` : ''}`).join('\n')}`)
            .join('\n\n')
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_hot_sources',
      title: '查看可选榜单',
      description: '列出热榜聚合站提供的全部榜单（id｜名称｜分类），以及用户当前关注的。',
      effect: 'read',
      highRisk: () => false,
      execute: () =>
        guard(async () => {
          const s = settings()
          const sources = await fetchSources(s.hotSource, s.proxy)
          return `当前关注：${(s.hotBoards ?? []).join('、') || '（默认）'}\n${sources.map((x) => `${x.id}｜${x.name}${x.column ? `｜${x.column}` : ''}`).join('\n')}`
        }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({boards: strList(obj(raw).boards)})}, json: {type: 'object', properties: {boards: {type: 'array', items: {type: 'string'}, description: '要关注的榜单 id，最多 12 个，会整体替换'}}, required: ['boards']}},
    {
      name: 'set_hot_boards',
      title: '设置关注的热榜',
      description: '设置热榜页关注哪些榜单（整体替换）。先用 list_hot_sources 确认 id 存在。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          const ids = [...new Set(args.boards)].slice(0, 12)
          if (!ids.length) throw new WorkspaceError('至少选一个榜单。')
          const s = settings()
          const valid = new Set((await fetchSources(s.hotSource, s.proxy)).map((x) => x.id))
          const unknown = valid.size ? ids.filter((id) => !valid.has(id)) : []
          if (unknown.length) throw new WorkspaceError(`这些榜单不存在：${unknown.join('、')}。用 list_hot_sources 看有哪些。`)
          patchSettings({hotBoards: ids})
          return `热榜现在关注：${ids.join('、')}。`
        }),
    },
  ),

  /* ───── 待办 ───── */
  define(
    {schema: {parse: (raw) => ({ref: optStr(obj(raw).ref)})}, json: {type: 'object', properties: {ref: {type: 'string', description: '待办组件的 id；只有一个待办组件时可不填'}}}},
    {
      name: 'list_todos',
      title: '查看待办',
      description: '列出待办清单（id｜状态｜内容）。页面上有多个待办组件时，不带 ref 会列出它们让你选。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const slot = slotFor('todos', args.ref)
          const todos = todosOf(slot.id)
          if (!todos.length) return `「${slot.title}」里还没有待办。`
          const open = todos.filter((t) => !t.done).length
          return `「${slot.title}」（${slot.id}）共 ${todos.length} 条，未完成 ${open} 条\n${todos.map((t) => `${t.id}｜${t.done ? '已完成' : '未完成'}｜${t.text}`).join('\n')}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({texts: strList(obj(raw).texts).slice(0, 30), ref: optStr(obj(raw).ref)})},
      json: {type: 'object', properties: {texts: {type: 'array', items: {type: 'string'}, description: '要加的待办，每条一句话'}, ref: {type: 'string'}}, required: ['texts']},
    },
    {
      name: 'add_todos',
      title: '添加待办',
      description: '往待办清单里添加一条或多条。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (!args.texts.length) throw new WorkspaceError('没有内容可加。')
          const slot = slotFor('todos', args.ref)
          const now = Date.now()
          const added = args.texts.map((text, i): Todo => ({id: uid(), text: text.slice(0, 200), done: false, createdAt: now + i}))
          writeData(slot.id, [...added.reverse(), ...todosOf(slot.id)])
          return `已加入「${slot.title}」${added.length} 条。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids), done: bool(obj(raw).done) ?? true, ref: optStr(obj(raw).ref)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}}, done: {type: 'boolean', description: 'true 标记完成（默认），false 改回未完成'}, ref: {type: 'string'}}, required: ['ids']},
    },
    {
      name: 'complete_todos',
      title: '勾选待办',
      description: '把待办标记为完成，或改回未完成。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const slot = slotFor('todos', args.ref)
          const todos = todosOf(slot.id)
          const hits = todos.filter((t) => args.ids.includes(t.id))
          if (!hits.length) throw new WorkspaceError('没有找到这些待办，先用 list_todos 看 id。')
          writeData(slot.id, todos.map((t) => (args.ids.includes(t.id) ? {...t, done: args.done} : t)))
          return `已${args.done ? '完成' : '重新打开'} ${hits.length} 条。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids), onlyDone: bool(obj(raw).onlyDone) ?? false, ref: optStr(obj(raw).ref)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}, description: '要删的待办 id'}, onlyDone: {type: 'boolean', description: 'true 表示清掉所有已完成的（此时不用 ids）'}, ref: {type: 'string'}}},
    },
    {
      name: 'remove_todos',
      title: '删除待办',
      description: '删除指定待办，或清掉所有已完成的。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const slot = slotFor('todos', args.ref)
          const todos = todosOf(slot.id)
          const gone = todos.filter((t) => (args.onlyDone ? t.done : args.ids.includes(t.id)))
          if (!gone.length) throw new WorkspaceError('没有符合的待办。')
          const set = new Set(gone.map((t) => t.id))
          writeData(slot.id, todos.filter((t) => !set.has(t.id)))
          return `已删除 ${gone.length} 条。`
        }),
    },
  ),

  /* ───── 便签 ───── */
  define(
    {schema: {parse: (raw) => ({ref: optStr(obj(raw).ref)})}, json: {type: 'object', properties: {ref: {type: 'string', description: '便签组件的 id；只有一个时可不填'}}}},
    {
      name: 'read_note',
      title: '读取便签',
      description: '读出便签的全部文字。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const slot = slotFor('note', args.ref)
          const text = readData<string>(slot.id, '')
          return text.trim() ? `「${slot.title}」（${slot.id}）\n${text}` : `「${slot.title}」是空的。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({text: typeof obj(raw).text === 'string' ? (obj(raw).text as string) : '', mode: str(obj(raw).mode) === 'replace' ? 'replace' : 'append', ref: optStr(obj(raw).ref)})},
      json: {type: 'object', properties: {text: {type: 'string'}, mode: {type: 'string', enum: ['append', 'replace'], description: 'append 接在末尾（默认），replace 整体覆盖'}, ref: {type: 'string'}}, required: ['text']},
    },
    {
      name: 'write_note',
      title: '写便签',
      description: '往便签里写字。默认接在末尾；用户要求重写时才用 replace（会覆盖原有内容）。',
      effect: 'write',
      highRisk: (args) => args.mode === 'replace',
      execute: (args) =>
        guard(() => {
          const slot = slotFor('note', args.ref)
          if (!args.text.trim()) throw new WorkspaceError('没有内容可写。')
          const old = readData<string>(slot.id, '')
          const next = args.mode === 'replace' || !old.trim() ? args.text : `${old.replace(/\s+$/, '')}\n${args.text}`
          writeData(slot.id, next.slice(0, 20000))
          return `便签「${slot.title}」已${args.mode === 'replace' ? '重写' : '追加'}，现在 ${Math.min(next.length, 20000)} 字。`
        }),
    },
  ),

  /* ───── 天气、监控 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_weather',
      title: '查看天气',
      description: '读取用户所在城市当前的天气（气温、最高最低、天气、风速、湿度）。城市在设置里，可用 update_settings 修改。',
      effect: 'read',
      highRisk: () => false,
      execute: () =>
        guard(async () => {
          const s = settings()
          const w = await fetchWeather(s.lat, s.lon, s.city)
          return `${w.place}：${w.label}，${w.temp}°C（今日 ${w.min}~${w.max}°C），风速 ${w.wind} km/h，湿度 ${w.humidity}%`
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_monitors',
      title: '查看服务监控',
      description: '列出用户接入的监控（名称、类型）并实时探测状态。令牌和密码不会出现在这里，也不能通过 AI 修改，需要用户自己在设置 › 监控里填。',
      effect: 'read',
      highRisk: () => false,
      execute: () =>
        guard(async () => {
          if (!isInstalled(getWorkspace(), 'monitor')) return '服务监控还没安装，可以用 install_addon 装上 monitor；监控的地址和令牌要用户自己填。'
          const s = settings()
          if (!s.monitor?.length) return '还没有接入任何监控。让用户在 设置 › 监控 里添加（需要填写令牌，AI 不代填）。'
          const rows = await Promise.all(
            s.monitor.map(async (m) => {
              const state = await probe(m, s.proxy)
              const sum = summarize(state)
              return `${m.name}｜${m.kind}｜${sum.primary}｜${sum.secondary}`
            }),
          )
          return rows.join('\n')
        }),
    },
  ),

  /* ───── 全局设置 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_settings',
      title: '查看设置',
      description: '查看用户的全局设置：称呼、城市、搜索引擎、热榜、显示选项、AI 面板打开方式、已用的模型名等。不含任何密钥。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const s = settings()
        const engine = readStored<string>('searchMode', 'ai')
        const ws = getWorkspace()
        return [
          `称呼：${s.name}`,
          `城市：${s.city}（${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}）`,
          `首页输入框当前模式：${engine}（ai 或 ${SEARCH_ENGINES.map((e) => e.id).join('/')}）`,
          `显示秒：${s.showSeconds ? '是' : '否'}｜显示站点图标：${s.showFavicons ? '是' : '否'}`,
          `壁纸：${s.wallpaper}`,
          `热榜关注：${(s.hotBoards ?? []).join('、') || '（默认）'}`,
          `监控：${s.monitor?.length ?? 0} 个`,
          `联网搜索：${searchLine()}`,
          `「搜索并跳转」${isAlwaysAllowed('open_search') ? '已设为总是允许（不再询问）' : '每次都要用户确认'}`,
          `AI：模型 ${s.ai.model}｜${s.ai.apiKey ? '已填密钥' : '未填密钥'}（接口地址、密钥、模型由用户自己在设置里填，你不能改）`,
          `侧栏进入 AI 的方式：${readStored<string>('sidebarAi', 'full') === 'full' ? '全屏' : '侧栏'}`,
          `已安装的市场组件：${ws.addons.join('、') || '（无）'}`,
        ].join('\n')
      },
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          name: optStr(obj(raw).name),
          city: optStr(obj(raw).city),
          showSeconds: bool(obj(raw).showSeconds),
          showFavicons: bool(obj(raw).showFavicons),
          searchEngine: optStr(obj(raw).searchEngine),
          sidebarAi: optStr(obj(raw).sidebarAi),
        }),
      },
      json: {
        type: 'object',
        properties: {
          name: {type: 'string', description: '称呼（搭搭怎么叫用户）'},
          city: {type: 'string', description: '所在城市，会自动查经纬度，影响天气'},
          showSeconds: {type: 'boolean', description: '时钟是否显示秒'},
          showFavicons: {type: 'boolean', description: '书签、常用网站是否显示站点图标'},
          searchEngine: {type: 'string', enum: ['ai', ...SEARCH_ENGINES.map((e) => e.id)], description: '首页输入框默认用什么：ai 或某个搜索引擎'},
          sidebarAi: {type: 'string', enum: ['full', 'drawer'], description: '从侧栏图标打开 AI 时：全屏 full 还是侧栏 drawer'},
        },
      },
    },
    {
      name: 'update_settings',
      title: '修改设置',
      description: [
        '修改用户的全局设置，只能改上面列出的几项。',
        '不能改：AI 的接口地址、密钥、模型，监控的令牌和密码，取数代理。这些涉及密钥和数据流向，必须由用户自己在设置里操作；需要时告诉用户去哪改（用 open_settings 带他过去）。',
        '主题、壁纸、页面、侧栏用各自的专用工具。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          const part: Partial<Settings> = {}
          const done: string[] = []
          if (args.name) {
            part.name = args.name.slice(0, 30)
            done.push(`称呼=${part.name}`)
          }
          if (args.city) {
            const place = (await geocode(args.city))[0]
            if (!place) throw new WorkspaceError(`查不到这个城市：${args.city}`)
            Object.assign(part, {city: place.name, lat: place.lat, lon: place.lon})
            done.push(`城市=${place.name}${place.admin ? `（${place.admin}）` : ''}`)
          }
          if (args.showSeconds !== undefined) {
            part.showSeconds = args.showSeconds
            done.push(`显示秒=${args.showSeconds}`)
          }
          if (args.showFavicons !== undefined) {
            part.showFavicons = args.showFavicons
            done.push(`显示站点图标=${args.showFavicons}`)
          }
          if (args.searchEngine) {
            if (args.searchEngine !== 'ai' && !SEARCH_ENGINES.some((e) => e.id === args.searchEngine)) throw new WorkspaceError(`不认识这个搜索引擎：${args.searchEngine}`)
            writeStored('searchMode', args.searchEngine)
            done.push(`输入框默认=${args.searchEngine}`)
          }
          if (args.sidebarAi) {
            if (args.sidebarAi !== 'full' && args.sidebarAi !== 'drawer') throw new WorkspaceError('sidebarAi 只能是 full 或 drawer。')
            writeStored('sidebarAi', args.sidebarAi)
            done.push(`侧栏 AI=${args.sidebarAi === 'full' ? '全屏' : '侧栏'}`)
          }
          if (!done.length) throw new WorkspaceError('没有给出要改的项。')
          if (Object.keys(part).length) patchSettings(part)
          return `已更新：${done.join('；')}。`
        }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({section: optStr(obj(raw).section)})}, json: {type: 'object', properties: {section: {type: 'string', description: `设置的哪一项：${SECTION_HINT}`}}}},
    {
      name: 'open_settings',
      title: '打开设置',
      description: '带用户到设置页的某一项。AI 不能代填的东西（接口地址、密钥、监控令牌）就用它把用户带过去。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args, context) => {
        if (!context.openSettings) return '当前环境不能打开设置页。'
        context.openSettings(args.section)
        return `已打开设置${args.section ? ` › ${args.section}` : ''}。`
      },
    },
  ),

  /* ───── 技能 ───── */
  define(
    {schema: {parse: (raw) => ({id: str(obj(raw).id)})}, json: {type: 'object', properties: {id: {type: 'string', enum: SKILLS.map((s) => s.id), description: '技能 id'}}, required: ['id']}},
    {
      name: 'use_skill',
      title: '调用技能',
      description: `取一份技能说明并照着做。可用技能：${SKILLS.map((s) => `${s.id}（${s.name}）`).join('、')}。任务匹配系统提示里「技能」目录中的某一项时，先调用它，再开始做。`,
      effect: 'read',
      highRisk: () => false,
      execute: async (args) => {
        const skill = findSkill(args.id)
        return skill ? skill.body : `没有这个技能：${args.id}。可用：${SKILLS.map((s) => s.id).join('、')}`
      },
    },
  ),
] as const
