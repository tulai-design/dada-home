import {WorkspaceError} from '../errors'
import {cleanFonts} from '../fonts'
import type {ThemeEntry} from '../workspace'
import {themeDesignLayers} from '../themeResolution'
import {THEME_FIELDS, listThemeFields, type ThemeField, type ThemeScope} from './catalog'

export type ThemePatchOperation = {path: string; scope: ThemeScope; value: unknown}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function fail(path: string, reason: string): never {throw new WorkspaceError(`${path}：${reason}`)}
const number = (value: string, min: number, max: number) => /^[-+]?\d*\.?\d+$/.test(value) && Number(value) >= min && Number(value) <= max
const unit = (value: string, min: number, max: number, percentage = false) => value.endsWith('%')
  ? percentage && number(value.slice(0, -1), 0, 100) : number(value, min, max)

/** 支持明确的颜色子集；校验分隔符而非过滤空分量，防止保存浏览器实际忽略的值。 */
export function isThemeColor(value: string): boolean {
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) || /^(?:transparent|black|white|red|blue|green)$/i.test(value)) return true
  const match = /^(rgb|rgba|hsl|hsla|oklch)\(([^()]*)\)$/i.exec(value)
  if (!match || !/^[\d\s.,%/+\-]+$/.test(match[2])) return false
  const kind = match[1].toLowerCase(), body = match[2].trim()
  let channels: string[], alpha: string | undefined
  if (body.includes(',')) {
    if (body.includes('/') || kind === 'oklch') return false
    const parts = body.split(',').map(part => part.trim())
    if (parts.length !== 3 && parts.length !== 4 || parts.some(part => !part || /\s/.test(part))) return false
    channels = parts.slice(0, 3)
    alpha = parts[3]
    if (kind.startsWith('rgb') && channels.some(part => part.endsWith('%')) && !channels.every(part => part.endsWith('%'))) return false
  } else {
    const parts = body.split('/')
    if (parts.length > 2 || parts.some(part => !part.trim())) return false
    channels = parts[0].trim().split(/\s+/)
    if (channels.length !== 3) return false
    alpha = parts[1]?.trim()
  }
  if (kind.startsWith('rgb') && !channels.every(part => unit(part, 0, 255, true))) return false
  if (kind.startsWith('hsl') && (!unit(channels[0], 0, 360) || !channels[1].endsWith('%') || !channels[2].endsWith('%')
    || !unit(channels[1], 0, 100, true) || !unit(channels[2], 0, 100, true))) return false
  if (kind === 'oklch' && (!unit(channels[0], 0, 1, true) || !unit(channels[1], 0, 0.5) || !unit(channels[2], 0, 360))) return false
  return alpha === undefined || unit(alpha, 0, 1, true)
}

export function validateThemeFieldValue(field: ThemeField, value: unknown, stored = false): string | number | ReturnType<typeof cleanFonts> {
  if (field.type === 'fonts') {
    if (!Array.isArray(value) || value.some(item => !object(item) || Object.keys(item).some(key => key !== 'family' && key !== 'role'))) fail(field.path, '字体必须是结构化 family/role 数组')
    return cleanFonts(value)
  }
  if (stored && typeof value !== 'string') fail(field.path, '保存的token必须是字符串')
  if (field.type === 'number' || field.type === 'length') {
    const parsed = stored && field.type === 'length' && typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value) ? Number(value.slice(0, -2)) : value
    if (stored && field.path === 'frame-gap' && value === 'var(--frame)') return 'var(--frame)'
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < (field.min ?? 0) || parsed > (field.max ?? Infinity)
      || field.group === 'shell' && !Number.isInteger(parsed)) fail(field.path, `需要 ${field.min}–${field.max} 范围的${field.type === 'length' ? 'px尺寸' : '数值'}`)
    return field.type === 'length' ? `${parsed}px` : parsed
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 160) fail(field.path, '需要有效文本值')
  const text = value.trim()
  if (field.type === 'color' && !isThemeColor(text) && !(field.path === 'frame-color' && text === 'var(--main)')) fail(field.path, '需要合法颜色，不接受 URL、任意变量或 CSS 表达式')
  if (field.type === 'font-stack') {
    const option = field.options?.find(item => item.value === text || stored && item.storedValue === text)
    if (!option) fail(field.path, '只接受目录提供的系统字体栈或角色别名；网络字体用fonts资源')
    return option.storedValue ?? option.value
  }
  return text
}

/** 所有即时工具/导入分支的变量格式也由作者目录验证。 */
export function validateOverrideMap(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (!object(raw) || Object.keys(raw).length > THEME_FIELDS.length) fail('overrides', '需要有限字段对象')
  const out: Record<string, string> = {}
  for (const [path, value] of Object.entries(raw)) {
    const field = THEME_FIELDS.find(item => item.path === path && item.group === 'tokens')
    if (!field) fail(path, '未知主题字段')
    out[path] = String(validateThemeFieldValue(field, value, true))
  }
  return out
}
export function validateThemeDesign(theme: ThemeEntry): void {
  const fields = listThemeFields(theme)
  for (const scope of ['overrides', 'light', 'dark'] as const) for (const [path, value] of Object.entries(theme[scope] ?? {})) {
    const field = fields.find(item => item.path === path && item.group === 'tokens')
    // 固定Win98造型不公开frame编辑，内置快照仍记录零外框。
    if (!field && theme.skin === 'win98' && ['frame', 'frame-gap'].includes(path) && value === '0px') continue
    if (!field) fail(path, '当前造型不支持该主题字段')
    const allowed = scope === 'overrides' ? 'shared' : scope
    if (!field.scopes.includes(allowed) && !(scope === 'overrides' && field.storedShared)) fail(path, `不能放在 ${scope}，请显式选择正确作用域`)
    validateThemeFieldValue(field, value, true)
  }
  if (theme.fonts !== undefined) validateThemeFieldValue(THEME_FIELDS.find(field => field.path === 'fonts')!, theme.fonts)
  for (const [group, raw] of [['recipes', theme.recipes], ['shell', theme.shellConfig]] as const) {
    if (raw === undefined) continue
    if (!object(raw)) fail(group, '需要对象')
    const entries = group === 'recipes' ? Object.entries(raw).flatMap(([part, value]) => {
      if (!fields.some(field => field.group === 'recipes' && field.path.startsWith(`${part}.`))) fail(part, '未知recipe部件')
      if (!object(value)) fail(part, 'recipe需要对象')
      return Object.entries(value).map(([key, item]) => [`${part}.${key}`, item] as const)
    }) : Object.entries(raw)
    for (const [path, value] of entries) {
      const field = fields.find(item => item.group === (group === 'recipes' ? 'recipes' : 'shell') && item.path === path)
      if (!field) fail(path, '当前造型或外壳不支持该字段')
      validateThemeFieldValue(field, value)
    }
  }
  // 字体层为三个角色提供完整栈；不能另按skin猜测被资源或快照覆盖掉的默认别名。
  const aliases = new Map<string, string>()
  const effectiveFonts = Object.assign({}, ...themeDesignLayers(theme, 'light').map(layer => layer.values)) as Record<string, string>
  for (const [path, value] of Object.entries(effectiveFonts)) {
    const match = /^var\(--(font-(?:sans|serif|mono))\)$/.exec(value)
    if (match) aliases.set(path, match[1])
  }
  for (const path of aliases.keys()) {
    const visited = new Set<string>()
    let next: string | undefined = path
    while (next && aliases.has(next)) {
      if (visited.has(next)) fail(path, '字体别名存在循环')
      visited.add(next)
      next = aliases.get(next)
    }
  }
}
export function applyThemeOperations(theme: ThemeEntry, operations: readonly ThemePatchOperation[]): ThemeEntry {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 32) fail('operations', '一次需要1–32项修改')
  const next = structuredClone(theme), fields = listThemeFields(theme), seen = new Set<string>()
  const fontOperation = operations.find(operation => operation?.path === 'fonts' && operation.scope === 'resource')
  const fontRoles = fontOperation ? (fontOperation.value === null || Array.isArray(fontOperation.value) && !fontOperation.value.length
    ? ['sans', 'serif', 'mono'] : cleanFonts(fontOperation.value).flatMap(font => font.role ? [font.role] : [])) : []
  if (operations.some(operation => fontRoles.some(role => operation?.path === `font-${role}`))) fail('fonts', '不能同时修改字体资源和它接管的字体栈')
  for (const operation of operations) {
    if (!object(operation) || Object.keys(operation).some(key => !['path', 'scope', 'value'].includes(key)) || !Object.hasOwn(operation, 'value')) fail('operations', '修改包含未知字段或缺少value')
    if (typeof operation.path !== 'string' || typeof operation.scope !== 'string') fail('operations', 'path/scope需要字符串')
    const {path, scope, value} = operation as ThemePatchOperation
    const field = fields.find(item => item.path === path && item.scopes.includes(scope))
    if (!field) fail(String(path), '未知字段、错误作用域或当前造型不支持')
    const scopes = scope === 'both' ? ['light', 'dark'] as const : [scope]
    for (const branch of scopes) {
      const key = `${path}:${branch}`
      if (seen.has(key)) fail(path, '同一请求不能重复写相同字段/作用域')
      seen.add(key)
    }
    const cleaned = value === null ? null : validateThemeFieldValue(field, value)
    if (scope === 'resource') {
      if (cleaned === null) delete next.fonts
      else next.fonts = cleaned as ThemeEntry['fonts']
      for (const role of fontRoles) delete next.overrides[`font-${role}`]
      continue
    }
    if (scope === 'recipe') {
      const [part, key] = path.split('.') as ['button' | 'input', 'radius']
      const recipes = next.recipes ??= {}, recipe = recipes[part] ??= {}
      if (cleaned === null) delete recipe[key]
      else recipe[key] = cleaned as number
    } else if (scope === 'shell') {
      const config = next.shellConfig ??= {}
      if (cleaned === null) delete config[path as keyof typeof config]
      else config[path as keyof typeof config] = cleaned as number
    } else for (const branch of scopes) {
      const record = branch === 'shared' ? next.overrides : (next[branch as 'light' | 'dark'] ??= {})
      if (cleaned === null) delete record[path]
      else record[path] = cleaned as string
    }
  }
  validateThemeDesign(next)
  return next
}
