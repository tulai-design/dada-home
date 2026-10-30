import {WorkspaceError} from './errors'
import {cleanLocalThemeFontRef, localThemeFontFamily, verifyLocalThemeFontBytes} from './fontResource'
import type {LocalThemeFontRef, LocalThemeResourceReader} from './themePackages/contracts'

/**
 * 主题字体：从 Google Fonts 引入，并（可选）指定接管哪一类字体。
 *
 * 为什么是结构化字段而不是让 AI 直接写 @import：
 * 字体名会被拼进样式表地址，必须严格校验；加载失败要能提示；切换主题时要能卸掉不用的。
 */

export type FontRole = 'serif' | 'sans' | 'mono'
export type ThemeFont = {family: string; role?: FontRole; resource?: LocalThemeFontRef}

export const MAX_FONTS = 4

/** 系统后备不会触发远端资源；网络字体只由 document lease 加载。 */
export const DEFAULT_STACKS: Record<FontRole, string> = {
  serif: "'Songti SC', 'STSong', Georgia, serif",
  sans: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
  mono: "'SF Mono', ui-monospace, Menlo, monospace",
}
export const DEFAULT_THEME_FONTS: readonly ThemeFont[] = [
  {family: 'Noto Sans SC', role: 'sans'}, {family: 'Source Serif 4', role: 'serif'},
  {family: 'Noto Serif SC', role: 'serif'}, {family: 'JetBrains Mono', role: 'mono'},
]

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
    const resource = source && 'resource' in source && source.resource !== undefined ? cleanLocalThemeFontRef(source.resource) : undefined
    const identity = resource ? JSON.stringify(resource) : family.toLowerCase()
    if (out.some((entry) => (entry.resource ? JSON.stringify(entry.resource) : entry.family.toLowerCase()) === identity && entry.role === role)) continue
    out.push({family, ...(role ? {role} : {}), ...(resource ? {resource} : {})})
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
  const out: Record<string, string> = Object.fromEntries(Object.entries(DEFAULT_STACKS).map(([role, value]) => [`font-${role}`, value]))
  const byRole = new Map<FontRole, string[]>()
  for (const font of fonts ?? DEFAULT_THEME_FONTS) if (font.role) byRole.set(font.role, [...(byRole.get(font.role) ?? []), `'${font.resource ? localThemeFontFamily(font.resource) : font.family}'`])
  for (const [role, names] of byRole) out[`font-${role}`] = `${names.join(', ')}, ${DEFAULT_STACKS[role]}`
  return out
}

const href = (family: string) => `https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, '+')}:400,500,600,700&display=swap`

export type ThemeFontStatus = {family: string; status: 'ready' | 'error'; reason?: string}
export type ThemeFontReadiness = {ready: boolean; fonts: ThemeFontStatus[]}
export type ThemeFontLease = {ready: Promise<ThemeFontReadiness>; release: () => void}
type FontEntry = {family: string; font: ThemeFont; reader: LocalThemeResourceReader; controller: AbortController; refs: number; started: boolean; settled: boolean; result?: ThemeFontStatus; link: HTMLLinkElement | null; face: FontFace | null; timer?: ReturnType<typeof setTimeout>; ready: Promise<ThemeFontStatus>; settle: (result: ThemeFontStatus) => void; dispose: () => void}
type FontScope = {entries: Map<string, FontEntry>; active: number; pump: () => void}
const scopes = new WeakMap<Document, FontScope>()
const FONT_SAMPLE = '搭搭 Aa0123'
const MAX_ACTIVE = 4
const MAX_DOCUMENT_FONTS = 32

/** 每个 document 独立计数。旧请求只持有自己的 entry，不能移除后来的同名字体。 */
function scopeFor(doc: Document): FontScope {
  const existing = scopes.get(doc)
  if (existing) return existing
  const scope: FontScope = {entries: new Map(), active: 0, pump: () => {}}
  scopes.set(doc, scope)
  return scope
}

const defaultLocalReader: LocalThemeResourceReader = async (ref, signal) => (await import('./themePackages/repository')).readLocalThemeFont(ref, signal)
const fontKey = (font: ThemeFont): string => font.resource ? `local:${JSON.stringify(font.resource)}` : `google:${font.family.toLowerCase()}`
function createEntry(doc: Document, scope: FontScope, font: ThemeFont, timeoutMs: number, reader: LocalThemeResourceReader): FontEntry {
  const family = font.family
  let resolve!: (status: ThemeFontStatus) => void
  const entry: FontEntry = {family, font, reader, controller: new AbortController(), refs: 0, started: false, settled: false, link: null, face: null, ready: new Promise(done => {resolve = done}), settle: () => {}, dispose: () => {}}
  const detach = () => {
    entry.controller.abort()
    if (entry.link) {entry.link.onload = null; entry.link.onerror = null; entry.link.remove(); entry.link = null}
    if (entry.face) {doc.fonts.delete(entry.face); entry.face = null}
  }
  entry.settle = (result) => {
    if (entry.settled) return
    entry.settled = true
    entry.result = result
    clearTimeout(entry.timer)
    if (entry.started) scope.active -= 1
    if (result.status === 'error') detach()
    resolve(result)
    scope.pump()
  }
  entry.dispose = () => {
    detach()
    entry.settle({family, status: 'error', reason: '字体请求已释放'})
  }
  // 排队也有上限时间，等待中的取消不启动网络。
  entry.timer = setTimeout(() => entry.settle({family, status: 'error', reason: '字体加载超时'}), timeoutMs)
  scope.pump = () => {
    for (const pending of scope.entries.values()) {
      if (scope.active >= MAX_ACTIVE) break
      if (pending.started || pending.settled || pending.refs === 0) continue
      pending.started = true
      scope.active += 1
      if (pending.font.resource) {
        const ref = pending.font.resource
        void Promise.resolve().then(() => pending.reader(ref, pending.controller.signal)).then(bytes => verifyLocalThemeFontBytes(ref, bytes, pending.controller.signal)).then(async bytes => {
          if (pending.settled) return
          const Constructor = doc.defaultView?.FontFace
          if (!Constructor || !doc.fonts?.add) throw new WorkspaceError('当前文档不支持本地字体加载')
          const face = new Constructor(localThemeFontFamily(ref), bytes)
          await face.load()
          if (pending.settled) return
          if (face.status !== 'loaded') throw new WorkspaceError('本地 WOFF2 字体无法解码')
          doc.fonts.add(face)
          pending.face = face
          if (!doc.fonts.check(`16px "${localThemeFontFamily(ref)}"`, FONT_SAMPLE)) throw new WorkspaceError('本地字体未能在当前文档就绪')
          pending.settle({family: pending.family, status: 'ready'})
        }).catch(error => pending.settle({family: pending.family, status: 'error', reason: error instanceof Error ? error.message : String(error)}))
        continue
      }
      const link = doc.createElement('link')
      pending.link = link
      link.rel = 'stylesheet'
      link.href = href(pending.family)
      link.dataset.themeFont = pending.family
      link.onerror = () => pending.settle({family: pending.family, status: 'error', reason: '字体样式表加载失败（网络、字体不存在或 CSP）'})
      link.onload = () => {
        if (pending.settled) return
        if (!doc.fonts?.load || !doc.fonts?.check) {pending.settle({family: pending.family, status: 'error', reason: '当前文档不支持字体加载检查'}); return}
        const descriptions = [400, 500, 600, 700].map(weight => `${weight} 16px "${pending.family}"`)
        void Promise.all(descriptions.map(description => doc.fonts.load(description, FONT_SAMPLE))).then((faces) => {
          if (pending.settled) return
          const ready = faces.every(list => list.length > 0 && list.every(face => face.status === 'loaded')) && descriptions.every(description => doc.fonts.check(description, FONT_SAMPLE))
          pending.settle({family: pending.family, status: ready ? 'ready' : 'error', ...(ready ? {} : {reason: '字体文件未能加载，正在使用系统后备'})})
        }, () => pending.settle({family: pending.family, status: 'error', reason: '字体文件加载失败（网络或 CSP）'}))
      }
      doc.head.appendChild(link)
    }
  }
  return entry
}

/** 只准备字体，不写 root 或主题变量。undefined 使用默认字体，[] 明确系统后备。 */
export function acquireThemeFonts(doc: Document, fonts: ThemeFont[] | undefined, options: {signal?: AbortSignal; timeoutMs?: number; localResources?: LocalThemeResourceReader} = {}): ThemeFontLease {
  // 设计保留各角色，资源 lease 仍只按物理字体身份计数、加载与检查。
  const wanted = [...new Map(cleanFonts(fonts ?? [...DEFAULT_THEME_FONTS]).map(font => [fontKey(font), font])).values()]
  const scope = scopeFor(doc)
  const keys = wanted.map(fontKey)
  const newCount = keys.filter(key => !scope.entries.has(key)).length
  if (scope.entries.size + newCount > MAX_DOCUMENT_FONTS) return {ready: Promise.resolve({ready: false, fonts: wanted.map(({family}) => ({family, status: 'error', reason: '当前文档字体资源数量超出上限'}))}), release: () => {}}
  const timeoutMs = Math.max(1, Math.min(30_000, options.timeoutMs ?? 8_000))
  const reader = options.localResources ?? defaultLocalReader
  const access = new Map<FontEntry, Promise<ThemeFontStatus | null>>()
  const accessController = new AbortController()
  const entries = wanted.map((font, index) => {
    const key = keys[index]
    let entry = scope.entries.get(key)
    if (!entry || entry.result?.status === 'error') {entry = createEntry(doc, scope, font, timeoutMs, reader); scope.entries.set(key, entry)}
    // 已缓存字节不代表当前仍有启用权限；每个新consumer重查本机资源门禁。
    else if (font.resource) access.set(entry, Promise.resolve().then(() => reader(font.resource!, accessController.signal)).then(bytes => verifyLocalThemeFontBytes(font.resource!, bytes, accessController.signal)).then(() => null, error => ({family: font.family, status: 'error' as const, reason: error instanceof Error ? error.message : String(error)})))
    entry.refs += 1
    return entry
  })
  let released = false
  let finish!: (value: ThemeFontReadiness) => void
  const ready = new Promise<ThemeFontReadiness>(resolve => {finish = resolve})
  const accessTimer = setTimeout(() => {accessController.abort(); finish({ready: false, fonts: wanted.map(({family}) => ({family, status: 'error', reason: '字体资源权限检查超时'}))})}, timeoutMs)
  const release = () => {
    if (released) return
    released = true
    clearTimeout(accessTimer)
    accessController.abort()
    options.signal?.removeEventListener('abort', release)
    for (const entry of entries) entry.refs -= 1
    for (const [index, entry] of entries.entries()) {
      if (entry.refs === 0 && scope.entries.get(keys[index]) === entry) {scope.entries.delete(keys[index]); entry.dispose()}
    }
    finish({ready: false, fonts: wanted.map(({family}) => ({family, status: 'error', reason: options.signal?.aborted ? '字体请求已取消' : '字体请求已释放'}))})
    scope.pump()
  }
  void Promise.all(entries.map(async entry => (await access.get(entry)) ?? await entry.ready)).then(results => {if (!released) {clearTimeout(accessTimer); finish({ready: results.every(font => font.status === 'ready'), fonts: results})}})
  options.signal?.addEventListener('abort', release, {once: true})
  if (options.signal?.aborted) release()
  else scope.pump()
  return {ready, release}
}
