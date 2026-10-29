/**
 * Dock（桌面左侧的侧栏 / 手机底部的标签栏）的样式。
 *
 * 默认是「纸质卡片」：悬浮的实色卡片，细边线，没有玻璃。
 * 玻璃胶囊和通栏仍是可选预设。
 * 想换成别的：内置几种预设，或者让 AI 完整地写一份新的 CSS（custom css），
 * 它能改位置、形状、材质、动画，什么都行。
 *
 * AI 写的 CSS 会被「圈」在 Dock 里：每条选择器前面自动加上 Dock 自己的作用域，
 * 所以它改不到页面其他部分；同时拦掉能发请求、能引入外部资源的写法。
 */

export const DOCK_PRESETS = [
  {id: 'glass', name: '拟态液体玻璃', description: '悬浮的玻璃胶囊，当前页下有一块会流动的液态玻璃。'},
  {id: 'solid', name: '纸质卡片', description: '悬浮的实色卡片，细边线，没有玻璃效果。默认。'},
  {id: 'bar', name: '通栏', description: '贴边的整条栏：电脑上是通高的侧栏，手机上是通宽的底栏。'},
] as const

export type DockPreset = (typeof DOCK_PRESETS)[number]['id']

export type DockStyle = {
  preset: DockPreset
  /** AI 写的整套自定义样式（原文）。渲染时再圈进作用域。 */
  css?: string
}

export const DEFAULT_DOCK_PRESET: DockPreset = 'solid'
export const DOCK_CSS_LIMIT = 6000
/** 所有自定义样式都挂在这个选择器下面。 */
export const DOCK_SCOPE = '.dock-shell[data-dock]'

export const isDockPreset = (value: unknown): value is DockPreset => DOCK_PRESETS.some((item) => item.id === value)

/** 读存下来的 Dock 设置；等于默认值就返回 undefined，不占空间。 */
export function readDock(raw: unknown): DockStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as {preset?: unknown; css?: unknown}
  const preset = isDockPreset(value.preset) ? value.preset : DEFAULT_DOCK_PRESET
  const css = typeof value.css === 'string' && scopeDockCss(value.css).ok ? value.css.trim() : undefined
  if (preset === DEFAULT_DOCK_PRESET && !css) return undefined
  return {preset, ...(css ? {css} : {})}
}

type Scoped = {ok: true; css: string} | {ok: false; reason: string}
const fail = (reason: string): Scoped => ({ok: false, reason})

/** 在顶层（不在括号、引号里）按分隔符切开。 */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 找和 open 位置的 `{` 配对的 `}`；找不到返回 -1。 */
function findClose(text: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 找下一个顶层的 `{` 或 `;`。 */
function nextBreak(text: string, from: number): number {
  let quote = ''
  let paren = 0
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') paren += 1
    else if (ch === ')') paren -= 1
    else if (paren === 0 && (ch === '{' || ch === ';')) return i
  }
  return -1
}

function scopeSelector(selector: string): string | null {
  const sel = selector.trim()
  if (!sel) return null
  if (sel.startsWith('&')) return DOCK_SCOPE + sel.slice(1)
  // 顺手兼容直接写 .dock-shell 的
  const shell = /^\.dock-shell(?![\w-])/.exec(sel)
  if (shell) return DOCK_SCOPE + sel.slice(shell[0].length)
  return `${DOCK_SCOPE} ${sel}`
}

const NESTABLE_AT = /^@(media|supports|container|layer)\b/i

function scopeBlock(text: string, depth: number): Scoped {
  if (depth > 4) return fail('嵌套太深了')
  let out = ''
  let loose = ''
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1
    if (i >= text.length) break
    const j = nextBreak(text, i)
    if (j < 0) return fail(`语法不完整，末尾缺少 ; 或 }：${text.slice(i, i + 30)}`)
    if (text[j] === ';') {
      const declaration = text.slice(i, j).trim()
      if (declaration.startsWith('@')) return fail(`不支持 ${declaration.split(/\s/)[0]}`)
      if (declaration) loose += `${declaration};`
      i = j + 1
      continue
    }
    const prelude = text.slice(i, j).trim()
    const close = findClose(text, j)
    if (close < 0) return fail('花括号没有配对')
    const body = text.slice(j + 1, close)
    i = close + 1

    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? ''
      if (name.endsWith('keyframes')) {
        const keyframe = prelude.slice(name.length + 1).trim()
        if (!/^dock-[\w-]+$/.test(keyframe)) return fail(`动画名要以 dock- 开头，避免和页面里的动画重名：${keyframe}`)
        out += `${prelude}{${body}}`
      } else if (NESTABLE_AT.test(prelude)) {
        const inner = scopeBlock(body, depth + 1)
        if (!inner.ok) return inner
        out += `${prelude}{${inner.css}}`
      } else {
        return fail(`不支持 @${name}（只能用 @media、@supports、@container、@layer、@keyframes）`)
      }
      continue
    }

    const selectors = splitTop(prelude, ',').map(scopeSelector)
    if (selectors.some((item) => item === null)) return fail('选择器是空的')
    out += `${selectors.join(',')}{${body}}`
  }
  return {ok: true, css: (loose ? `${DOCK_SCOPE}{${loose}}` : '') + out}
}

/**
 * 校验并圈定 Dock 的自定义 CSS。
 *
 *   - 写法：普通 CSS。选择器相对 Dock 根节点，`&` 代表根节点本身，例如 `& { … }`、`.dock { … }`、
 *     `.rail-btn[data-on='true'] { … }`；也可以直接写一串声明，会当作根节点的样式。
 *   - 允许 @media / @supports / @container / @layer / @keyframes（动画名以 dock- 开头）。
 *   - 禁止 @import、@font-face 等，url() 只收 data: 位图和 #锚点，所以不会向外发任何请求。
 */
export function scopeDockCss(raw: string): Scoped {
  const source = (raw ?? '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!source) return fail('CSS 内容为空')
  if (source.length > DOCK_CSS_LIMIT) return fail(`CSS 太长了，请精简到 ${DOCK_CSS_LIMIT} 字符以内`)
  if (source.includes('\\')) return fail('CSS 里不要用反斜杠转义')
  if (/[<]/.test(source)) return fail('CSS 里不能出现 <')

  const lowered = source.toLowerCase()
  if (/@(import|font-face|namespace|charset|property|page|font-feature-values|counter-style)/.test(lowered)) return fail('不能用 @import、@font-face 这类会引入外部资源的写法')
  if (/expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:/.test(lowered)) return fail('CSS 里有不允许的写法')
  if (/\b(image-set|src|element|paint|cross-fade)\s*\(/.test(lowered)) return fail('CSS 里不能用 image-set()、src() 这类函数')

  for (const [, , target] of source.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const value = target.trim()
    if (!/^data:image\/(png|jpeg|jpg|gif|webp|avif);/i.test(value) && !/^#[\w-]+$/.test(value)) {
      return fail(`url() 只支持 data: 位图和 #锚点，收到：${value.slice(0, 40)}`)
    }
  }
  return scopeBlock(source, 0)
}

/** 给 AI 看的结构说明：它要完整地重写 Dock，得知道里面有什么。 */
export const DOCK_GUIDE = [
  'Dock 的结构（选择器相对 Dock 根节点，`&` 就是根节点）：',
  '  nav.dock-shell  ← `&`。占位容器，本身透明：电脑上是左侧一整列（宽 var(--side-width)，满高，居中放 .dock），手机上是底部一整行。data-orient 是 vertical（电脑）或 horizontal（手机）',
  '    button.dock-logo ← 品牌图标，只有电脑上有。它不在 .dock 里，而是钉在容器左上角（离左边和上边各 16px，60×60）',
  '    div.dock      ← 看得见的那一块（position:relative; isolation:isolate）。默认是玻璃胶囊，形状、材质、位置都在这里改',
  '      i.dock-glider        ← 当前页的滑块，绝对定位，位置和大小由 --gx --gy --gw --gh 给出（不要改这四个变量的用法）。可以改它的背景、形状、阴影，也可以 display:none',
  '      div.dock-group.dock-top      ← 首页',
  '      div.dock-group.dock-mid      ← 其他页面和「更多」',
  '      div.dock-group.dock-bottom   ← 搭搭 AI、监控、组件市场、设置（手机上只有 AI 和「更多」）',
  '        div.rail-slot > button.rail-btn   ← 每个入口，里面是一个 svg 图标。当前页 data-on="true"，AI 在工作时 data-busy="true"',
  '可用变量：--dock-ink（图标深色）--dock-muted（未选中色）--dock-surface（胶囊底色）--dock-active（滑块底色）--dock-glass --dock-light --dock-dark --dock-saturation，',
  '  --dock-shadow（整套液体玻璃的高光和阴影，可直接 box-shadow: var(--dock-shadow)）--dock-glider-shadow（滑块用的那一套）；以及页面的 --main --bg --text --text2 --border --font-serif。',
  '  玻璃模糊写法：backdrop-filter: blur(2px) url(#dock-liquid-glass) saturate(var(--dock-saturation))（url(#dock-liquid-glass) 是 Dock 里自带的扭曲滤镜，可省略）。',
  '写法：普通 CSS，可以用 @media、@supports、@container、@keyframes（动画名必须以 dock- 开头）。电脑和手机是两种形态，要分别照顾：手机用 @media (max-width: 760px) 或 &[data-orient="horizontal"]。',
  '不能用：@import、@font-face、外部 url()（只收 data: 位图和 #锚点）、反斜杠转义、< 。',
  '你写的是整个 Dock 的皮肤，可以彻底重做：换位置（比如电脑上改成贴底的横条）、换形状、换材质（毛玻璃、实色、描边、像素、霓虹…）、换选中的表现、加动画。别把 .rail-btn 藏起来或让它点不到。',
].join('\n')
