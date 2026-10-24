import {WorkspaceError} from './errors'

/**
 * 主题字体：从 Google Fonts 引入，并（可选）指定接管哪一类字体。
 *
 * 为什么是结构化字段而不是让 AI 直接写 @import：
 * 字体名会被拼进样式表地址，必须严格校验；加载失败要能提示；切换主题时要能卸掉不用的。
 */

export type FontRole = 'serif' | 'sans' | 'mono'
export type ThemeFont = {family: string; role?: FontRole}

export const MAX_FONTS = 4

/** 三类字体原本的字体栈。接管某一类时，把新字体放在最前面，原来的作为后备。 */
export const DEFAULT_STACKS: Record<FontRole, string> = {
  serif: "'Source Serif 4', 'Noto Serif SC', 'Songti SC', 'STSong', Georgia, serif",
  sans: "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",
}

/** Google Fonts 的字体名：字母、数字和空格，例如 "Playfair Display"、"Noto Serif SC"、"ZCOOL KuaiLe"。 */
const FAMILY = /^[A-Za-z][A-Za-z0-9 ]{0,39}$/

export function cleanFonts(raw: unknown): ThemeFont[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new WorkspaceError('fonts 必须是数组，例如 [{"family":"Playfair Display","role":"serif"}]')
  if (raw.length > MAX_FONTS) throw new WorkspaceError(`一个主题最多引入 ${MAX_FONTS} 个字体`)
  const out: ThemeFont[] = []
  for (const item of raw) {
    const source = typeof item === 'string' ? {family: item} : (item as {family?: unknown; role?: unknown} | null)
    const family = typeof source?.family === 'string' ? source.family.trim().replace(/\s+/g, ' ') : ''
    if (!FAMILY.test(family)) throw new WorkspaceError(`字体名不合法：${String(source?.family)}。只能是 Google Fonts 上的名字，例如 Playfair Display。`)
    const role = (source as {role?: unknown}).role
    if (role !== undefined && role !== 'serif' && role !== 'sans' && role !== 'mono') throw new WorkspaceError('字体的 role 只能是 serif（标题和正文）、sans（界面控件）或 mono（数字和标签）')
    if (out.some((entry) => entry.family.toLowerCase() === family.toLowerCase())) continue
    out.push({family, ...(role ? {role} : {})})
  }
  return out
}

/** 宽松读取（导入、升级时）：坏的丢掉，不抛错。 */
export function readFonts(raw: unknown): ThemeFont[] {
  try {
    return cleanFonts(raw)
  } catch {
    return []
  }
}

/** 字体 → CSS 变量。同一类有多个字体时，前面的优先。 */
export function fontVars(fonts: ThemeFont[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const byRole = new Map<FontRole, string[]>()
  for (const font of fonts ?? []) if (font.role) byRole.set(font.role, [...(byRole.get(font.role) ?? []), `'${font.family}'`])
  for (const [role, names] of byRole) out[`font-${role}`] = `${names.join(', ')}, ${DEFAULT_STACKS[role]}`
  return out
}

const href = (family: string) => `https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, '+')}:400,500,600,700&display=swap`

const loaded = new Map<string, HTMLLinkElement>()

/**
 * 让页面只加载当前主题要用的字体：新增的插入 <link>，不再需要的移除。
 * 样式表请求失败（名字不存在、断网）时回调，让界面能提示。
 */
export function syncFonts(fonts: ThemeFont[] | undefined, onError: (family: string) => void) {
  const wanted = new Set((fonts ?? []).map((font) => font.family))
  for (const [family, link] of loaded) {
    if (wanted.has(family)) continue
    link.remove()
    loaded.delete(family)
  }
  for (const family of wanted) {
    if (loaded.has(family)) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href(family)
    link.dataset.themeFont = family
    link.onerror = () => {
      link.remove()
      loaded.delete(family)
      onError(family)
    }
    document.head.appendChild(link)
    loaded.set(family, link)
  }
}
