import type {CustomWidget, DataSource, FieldBind} from './workspace'

/**
 * 自定义组件的取值与校验。
 *
 * AI 写的是声明，不是代码，但仍不可信：路径可能写错、接口可能返回垃圾、
 * 地址可能指向没授权的域名。所有读取都经过这里，出错就安静返回空，
 * 绝不让一个坏声明把整页弄崩。
 */

/** 按点号路径取值，例如 "author.name"；取不到返回 undefined。 */
export function pick(item: unknown, path: string): unknown {
  if (!path) return undefined
  let value: unknown = item
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

/** 把取到的值变成一行可读文字。对象和数组不直接展示，避免界面上出现 [object Object]。 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('、')
  return ''
}

/** 从响应体里按路径取出数组。留空表示响应本身就是数组。 */
export function resolveItems(body: unknown, path?: string): Record<string, unknown>[] {
  const target = path ? pick(body, path) : body
  if (!Array.isArray(target)) return []
  // 只保留对象项：字符串/数字项无法按字段映射
  return target.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
}

/** 读一个字段绑定，拼上前缀。 */
export function bind(item: unknown, field?: FieldBind): string {
  if (!field) return ''
  const text = asText(pick(item, field.path))
  if (!text) return ''
  return field.prefix ? `${field.prefix}${text}` : text
}

// ───────────────────────── 地址与授权 ─────────────────────────

export type UrlCheck =
  | {ok: true; url: string; host: string}
  | {ok: false; reason: string}

/** 只接受 http(s)，且必须能解析出主机名。 */
export function checkUrl(raw: string): UrlCheck {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return {ok: false, reason: '地址是空的'}
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {ok: false, reason: `地址格式不对：${trimmed.slice(0, 80)}`}
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {ok: false, reason: `只支持 http(s) 地址，收到 ${parsed.protocol}`}
  }
  if (!parsed.hostname) return {ok: false, reason: '地址缺少域名'}
  return {ok: true, url: parsed.toString(), host: parsed.hostname.toLowerCase()}
}

/** 这个地址是否已被用户授权。 */
export function isGranted(url: string, grantedHosts: readonly string[]): boolean {
  const check = checkUrl(url)
  if (!check.ok) return false
  return grantedHosts.includes(check.host)
}

/** 域名白名单只存 host，不含协议和路径。 */
export function normalizeHost(raw: string): string | undefined {
  const check = checkUrl(raw.includes('://') ? raw : `https://${raw}`)
  return check.ok ? check.host : undefined
}

// ───────────────────────── 规格校验 ─────────────────────────

const LAYOUTS = ['list', 'cards', 'stats', 'text', 'links', 'art'] as const

/**
 * 清理 AI 给的 SVG。
 *
 * 直接塞进 innerHTML 就等于执行任意标记，所以先剥掉危险部分：
 * script/foreignObject、所有 on* 事件、javascript: 链接、外部引用。
 * 只保留画图需要的元素和属性。
 */
export function sanitizeSvg(raw: string): {ok: true; svg: string} | {ok: false; reason: string} {
  const source = (raw ?? '').trim()
  if (!source) return {ok: false, reason: 'SVG 内容为空'}
  if (source.length > 40_000) return {ok: false, reason: 'SVG 太大了，请精简到 4 万字符以内'}
  if (!/^<svg[\s>]/i.test(source)) return {ok: false, reason: 'SVG 必须以 <svg 开头'}

  // 块级剔除：整段拿掉，避免残留半截标签
  let out = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')

  // 属性级剔除：on* 事件、href/src 指向脚本、style 里的 expression
  out = out
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|xlink:href|src)\s*=\s*("|')?\s*javascript:[^\s>]*/gi, '')
    .replace(/style\s*=\s*("|')[^"']*expression[^"']*\1/gi, '')

  // 标签名白名单外的一律拿掉（含 <image> 这类可引用外链的）
  const ALLOWED = new Set([
    'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'circle', 'ellipse', 'rect', 'line',
    'polyline', 'polygon', 'text', 'tspan', 'lineargradient', 'radialgradient', 'stop', 'clippath',
    'mask', 'pattern', 'filter', 'fegaussianblur', 'feoffset', 'femerge', 'femergenode', 'fecolormatrix',
  ])
  out = out.replace(/<\/?\s*([a-zA-Z][\w:-]*)/g, (match, name: string) => {
    const lower = name.toLowerCase().replace(/^svg:/, '')
    return ALLOWED.has(lower) ? match : '<g data-stripped="1"'
  })
  // 被替换成 <g> 的闭合标签也要对上：统一在最后检查配平
  if ((out.match(/<g[\s>]/g) ?? []).length !== (out.match(/<\/g>/g) ?? []).length + (source.match(/<svg[\s>]/g) ?? []).length * 0) {
    // 配不平就退回：只保留最外层 svg，内容清空，避免渲染出坏结构
    const open = source.match(/^<svg[^>]*>/i)?.[0]
    if (!open) return {ok: false, reason: 'SVG 结构不完整'}
    return {ok: true, svg: `${open}</svg>`}
  }

  if (!/^<svg[\s>]/i.test(out)) return {ok: false, reason: 'SVG 结构不完整'}
  return {ok: true, svg: out}
}

/**
 * 校验并规整一份自定义组件规格。
 * 返回规整后的规格，或一句说清哪里不对的错误。
 */
export function normalizeWidget(raw: unknown, id: string): {ok: true; widget: CustomWidget} | {ok: false; reason: string} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, reason: '组件规格必须是一个对象'}
  const value = raw as Record<string, unknown>

  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 24) : ''
  if (!name) return {ok: false, reason: '组件需要一个名称'}

  const layout = LAYOUTS.includes(value.layout as never) ? (value.layout as CustomWidget['layout']) : undefined
  if (!layout) return {ok: false, reason: `layout 只能是 ${LAYOUTS.join(' / ')}，收到：${String(value.layout)}`}

  const item = (value.item && typeof value.item === 'object' ? value.item : {}) as Record<string, unknown>
  const bindOf = (field: unknown): FieldBind | undefined => {
    if (!field || typeof field !== 'object') return undefined
    const record = field as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    if (!path) return undefined
    const prefix = typeof record.prefix === 'string' ? record.prefix.slice(0, 16) : undefined
    return prefix ? {path, prefix} : {path}
  }
  // art 布局不读数据，只画 SVG
  if (layout === 'art') {
    const cleaned = sanitizeSvg(typeof value.svg === 'string' ? value.svg : '')
    if (!cleaned.ok) return {ok: false, reason: cleaned.reason}
    return {
      ok: true,
      widget: {
        id,
        name,
        description: typeof value.description === 'string' ? value.description.slice(0, 200) : '',
        layout,
        item: {title: {path: ''}},
        source: {kind: 'static', items: []},
        svg: cleaned.svg,
        emptyText: typeof value.emptyText === 'string' ? value.emptyText.slice(0, 60) : undefined,
      },
    }
  }

  const title = bindOf(item.title)
  if (!title) return {ok: false, reason: 'item.title 必须声明一个数据字段路径'}

  const source = normalizeSource(value.source)
  if (!source.ok) return {ok: false, reason: source.reason}

  const options = value.options && typeof value.options === 'object' ? (value.options as Record<string, unknown>) : {}
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) ? Math.max(0, Math.min(100, Math.trunc(options.limit))) : undefined

  return {
    ok: true,
    widget: {
      id,
      name,
      description: typeof value.description === 'string' ? value.description.slice(0, 200) : '',
      layout,
      item: {
        title,
        subtitle: bindOf(item.subtitle),
        meta: bindOf(item.meta),
        link: bindOf(item.link),
      },
      source: source.source,
      emptyText: typeof value.emptyText === 'string' ? value.emptyText.slice(0, 60) : undefined,
      options: {
        limit,
        numbered: typeof options.numbered === 'boolean' ? options.numbered : undefined,
      },
    },
  }
}

function normalizeSource(raw: unknown): {ok: true; source: DataSource} | {ok: false; reason: string} {
  if (!raw || typeof raw !== 'object') return {ok: false, reason: 'source 必须声明数据来源'}
  const value = raw as Record<string, unknown>

  if (value.kind === 'static') {
    const items = Array.isArray(value.items) ? value.items : []
    const safe = items.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row)).slice(0, 200)
    return {ok: true, source: {kind: 'static', items: safe}}
  }

  if (value.kind === 'http') {
    const check = checkUrl(typeof value.url === 'string' ? value.url : '')
    if (!check.ok) return {ok: false, reason: check.reason}
    const path = typeof value.path === 'string' && value.path.trim() ? value.path.trim() : undefined
    // 最短 60 秒，防止 AI 设一个每秒重取的地址把浏览器和对方站点打爆
    const every = typeof value.every === 'number' && Number.isFinite(value.every) ? Math.max(60_000, Math.trunc(value.every)) : undefined
    return {ok: true, source: {kind: 'http', url: check.url, path, every}}
  }

  return {ok: false, reason: `source.kind 只能是 static 或 http，收到：${String(value.kind)}`}
}

// ───────────────────────── 自定义样式 ─────────────────────────

/**
 * 清理 AI 写的 CSS。
 *
 * 允许任意声明（颜色、圆角、阴影、滤镜、动画……），因为它们只影响外观。
 * 拦掉三类真正危险的东西：
 *   - @import / @font-face：会把外部资源拉进来
 *   - url(javascript:) 和 expression()：可执行
 *   - url(http...)：CSS 里的外部请求会泄露「谁在看这个页面」，只放行 data: 图片
 */
export function sanitizeCss(raw: string): {ok: true; css: string} | {ok: false; reason: string} {
  const source = (raw ?? '').trim()
  if (!source) return {ok: false, reason: 'CSS 内容为空'}
  if (source.length > 8000) return {ok: false, reason: 'CSS 太长了，请精简到 8000 字符以内'}

  const lowered = source.toLowerCase()
  if (/@import/.test(lowered)) return {ok: false, reason: 'CSS 里不能用 @import'}
  if (/@font-face/.test(lowered)) return {ok: false, reason: 'CSS 里不能用 @font-face'}
  if (/expression\s*\(/.test(lowered)) return {ok: false, reason: 'CSS 里不能用 expression()'}
  if (/behavior\s*:/.test(lowered)) return {ok: false, reason: 'CSS 里不能用 behavior'}
  if (/javascript\s*:/i.test(source)) return {ok: false, reason: 'CSS 里不能出现 javascript:'}

  // url() 只允许位图 data:，SVG 的 data: URI 可以携带脚本
  const urls = [...source.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)]
  for (const [, , target] of urls) {
    const value = target.trim()
    if (!/^data:image\/(png|jpeg|jpg|gif|webp|avif);/i.test(value)) {
      return {ok: false, reason: `CSS 里的 url() 只支持 data: 位图（png/jpeg/gif/webp/avif），收到：${value.slice(0, 40)}`}
    }
  }

  // 花括号一律禁止：这段 CSS 会被包进 `[data-id="x"] { ... }`，
  // 出现 `}` 就能逃出选择器去改整页。只接受「属性: 值;」这种纯声明。
  if (source.includes('{') || source.includes('}')) {
    return {ok: false, reason: '只写属性声明（例如 color: red; border-radius: 8px），不要写选择器和花括号'}
  }

  return {ok: true, css: source}
}

/** 组件级样式能改的属性：全部只影响外观，不影响交互和布局逃逸。 */
export const STYLE_PROPS = [
  'background', 'background-color', 'background-image', 'background-size', 'background-position',
  'color', 'border', 'border-color', 'border-width', 'border-style', 'border-radius',
  'box-shadow', 'padding', 'margin', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'font-family', 'text-align', 'text-shadow', 'opacity', 'filter', 'backdrop-filter',
  'transform', 'gap', 'aspect-ratio',
] as const

/**
 * 允许的动画：只给预置的几个名字，不接受任意 keyframes。
 * 任意 animation 可以做出闪烁、抽动，既扰人也可能诱发不适。
 */
export const ANIMATIONS = ['none', 'fade-in', 'pulse-soft', 'float', 'spin-slow'] as const
