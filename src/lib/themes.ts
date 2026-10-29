import {WorkspaceError} from './errors'
import {cleanFonts, readFonts} from './fonts'
import {DEFAULT_THEME, DEFAULT_THEME_ID, IOS_THEME, IOS_THEME_ID, PIXEL_THEME, PIXEL_THEME_ID, SWITCH_THEME, SWITCH_THEME_ID, WIN98_THEME, WIN98_THEME_ID, MAX_THEMES, activeTheme, type ThemeEntry, type Workspace} from './workspace'

/**
 * 主题库的纯函数。
 *
 * 主题是「名字 + 说明 + 变量差异」的一条记录，存在 Workspace.themes 里，随工作空间一起导出、可撤销。
 * 默认主题永远在库里，且不可改：AI 在默认主题上调色，会先另存成新主题再改，
 * 所以无论怎么折腾，都能一键回到最初的样子。
 */

const NAME = /^[a-z][a-z0-9-]*$/
const MAX_VARS = 40
type Mode = 'light' | 'dark'
type Overrides = Record<string, string>

/** 对应 theme.css 的基础配色，外观查询与缩略图共用；浏览器回归检查两者一致。 */
export const DEFAULT_THEME_PALETTES = {
  light: {bg: '#f4f0e6', bg2: '#ebe5d8', bg3: '#ddd5c4', text: '#1c1815', text2: '#5a5248', text3: '#8d8478', text4: '#cbc2b2', border: 'rgba(28, 24, 21, 0.08)', rule: '#1c1815', main: '#e5372e'},
  dark: {bg: '#151210', bg2: '#1e1a17', bg3: '#2b2622', text: '#efe9df', text2: '#b3a99b', text3: '#7f766a', text4: '#3a342e', border: 'rgba(239, 233, 223, 0.09)', rule: '#efe9df', main: '#ff5a4f'},
} satisfies Record<Mode, Overrides>

// 这些中性色不能作为两个模式共用的固定值，否则内联样式会锁住深浅色切换。
const MODE_COLORS = new Set(['bg', 'bg2', 'bg3', 'text', 'text2', 'text3', 'text4', 'border', 'rule'])

/** 旧主题没有 mode 时，用可判定的背景明度归属原配色；动态 CSS 值沿用调用方模式。 */
function legacyMode(overrides: Overrides, fallback: Mode): Mode {
  const bg = overrides.bg?.trim().toLowerCase()
  if (!bg) return fallback
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(bg)?.[1]
  let rgb: number[] | undefined
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    rgb = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255)
  } else if (/^rgba?\(/.test(bg)) {
    const channels = bg.slice(bg.indexOf('(') + 1).split(/[,\s/]+/).filter(Boolean).slice(0, 3)
    if (channels.length === 3) rgb = channels.map((value) => Number.parseFloat(value) / (value.endsWith('%') ? 100 : 255))
  } else if (bg === 'black') return 'dark'
  else if (bg === 'white') return 'light'
  if (rgb?.every(Number.isFinite)) return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 0.5 ? 'dark' : 'light'
  const lightness = /^oklch\(\s*([\d.]+)(%)?/.exec(bg)
  if (lightness) return Number(lightness[1]) / (lightness[2] ? 100 : 1) < 0.5 ? 'dark' : 'light'
  const hsl = /^hsla?\(.*?([\d.]+)%\s*(?:[,/]\s*[\d.%]+)?\s*\)$/.exec(bg)
  return hsl ? Number(hsl[1]) < 50 ? 'dark' : 'light' : fallback
}

function splitOverrides(overrides: Overrides): {shared: Overrides; colors: Overrides} {
  const shared: Overrides = {}
  const colors: Overrides = {}
  for (const [name, value] of Object.entries(overrides)) (MODE_COLORS.has(name) ? colors : shared)[name] = value
  return {shared, colors}
}

/** 宽松读取和运行解析共用旧格式兼容规则，显式模式分支优先。 */
function normalizeEntry(entry: ThemeEntry, fallback: Mode): ThemeEntry {
  const {shared, colors} = splitOverrides(entry.overrides)
  if (!Object.keys(colors).length) return entry
  const mode = entry.mode ?? legacyMode(entry.overrides, fallback)
  return {...entry, overrides: shared, [mode]: {...colors, ...entry[mode]}, mode}
}

/** 共用变量 → 当前模式；缺失分支由样式表提供该模式的系统配色。 */
export function resolveThemeOverrides(theme: ThemeEntry, mode: Mode): Overrides {
  const entry = normalizeEntry(theme, mode)
  return {...entry.overrides, ...entry[mode]}
}

/** 校验并规整一组变量覆盖。AI 和导入的数据都不可信。 */
export function cleanOverrides(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceError('overrides 必须是对象，例如 {"main":"#2b6cf6"}')
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_VARS) throw new WorkspaceError(`一个主题最多改 ${MAX_VARS} 个变量`)
  const out: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (!NAME.test(name)) throw new WorkspaceError(`变量名不合法：${name}`)
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[;{}]/.test(value)) throw new WorkspaceError(`变量值不合法：${name}`)
    out[name] = value.trim()
  }
  return out
}

/** 导入或升级时读主题库：坏条目丢掉，内置预设始终用当前定义。 */
export function readThemes(raw: unknown, fallbackMode: Mode = 'light'): ThemeEntry[] {
  const list: ThemeEntry[] = [DEFAULT_THEME]
  if (Array.isArray(raw)) for (const item of raw.slice(0, MAX_THEMES)) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || item.id === DEFAULT_THEME_ID || item.id === IOS_THEME_ID || item.id === PIXEL_THEME_ID || item.id === SWITCH_THEME_ID || item.id === WIN98_THEME_ID) continue
    if (list.some((entry) => entry.id === item.id)) continue
    try {
      list.push(normalizeEntry({
        id: item.id,
        name: item.name.trim().slice(0, 20) || '未命名',
        description: typeof item.description === 'string' ? item.description.slice(0, 120) : '',
        overrides: cleanOverrides(item.overrides),
        ...(item.light !== undefined ? {light: cleanOverrides(item.light)} : {}),
        ...(item.dark !== undefined ? {dark: cleanOverrides(item.dark)} : {}),
        ...(readFonts(item.fonts).length ? {fonts: readFonts(item.fonts)} : {}),
        ...(item.mode === 'light' || item.mode === 'dark' ? {mode: item.mode} : {}),
      }, fallbackMode))
    } catch {
      /* 变量不合法的主题直接丢掉 */
    }
  }
  list.splice(1, 0, IOS_THEME, PIXEL_THEME, SWITCH_THEME, WIN98_THEME)
  return list
}

function find(workspace: Workspace, ref: string): ThemeEntry {
  const needle = ref.trim().toLowerCase()
  const hit = workspace.themes.find((item) => item.id === ref) ?? workspace.themes.find((item) => item.name.toLowerCase() === needle)
  if (!hit) throw new WorkspaceError(`没有这个主题：${ref}。现有：${workspace.themes.map((item) => `${item.id}（${item.name}）`).join('、')}`)
  return hit
}

function uniqueId(workspace: Workspace, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'theme'
  let id = base === DEFAULT_THEME_ID ? 'theme' : base
  for (let n = 2; workspace.themes.some((item) => item.id === id); n += 1) id = `${base}-${n}`
  return id
}

function activate(workspace: Workspace, entry: ThemeEntry): Workspace {
  const {frameOff: _frameOff, ...theme} = workspace.theme
  return {...workspace, theme: {...theme, active: entry.id, mode: entry.mode ?? workspace.theme.base}}
}

/** 掌机和 iOS 的外框开关留在当前主题上。另存会丢掉皮肤。 */
export function setSkinFrame(workspace: Workspace, on: boolean): Workspace {
  const active = activeTheme(workspace)
  if (!active.builtin || (active.id !== IOS_THEME_ID && active.id !== PIXEL_THEME_ID && active.id !== SWITCH_THEME_ID)) return workspace
  const theme = {...workspace.theme}
  if (on) delete theme.frameOff
  else theme.frameOff = true
  return {...workspace, theme}
}

/** fonts 字段：空数组表示清掉，所以不写进主题。 */
function fontsField(raw: unknown): {fonts?: ReturnType<typeof cleanFonts>} {
  const fonts = cleanFonts(raw)
  return fonts.length ? {fonts} : {}
}

/** 存一个主题：id 或同名的已有主题会被更新，否则新建；默认启用。 */
export function saveTheme(
  workspace: Workspace,
  input: {id?: string; name?: string; description?: string; overrides?: unknown; light?: unknown; dark?: unknown; fonts?: unknown; mode?: string; activate?: boolean},
): {workspace: Workspace; theme: ThemeEntry; created: boolean} {
  if (input.mode !== undefined && input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('mode 只能是 light 或 dark')
  const name = input.name?.trim().slice(0, 20)
  const existing =
    (input.id ? workspace.themes.find((item) => item.id === input.id) : undefined) ??
    (name ? workspace.themes.find((item) => item.name.toLowerCase() === name.toLowerCase()) : undefined)
  if (name?.toLowerCase() === DEFAULT_THEME_ID) throw new WorkspaceError('「default」是默认主题的 id，换个名字。')
  if (existing?.builtin) throw new WorkspaceError('内置主题不能修改。换个名字另存为新主题。')

  const old = existing ? normalizeEntry(existing, workspace.theme.mode) : undefined
  const supplied = cleanOverrides(input.overrides)
  const {shared, colors} = splitOverrides(supplied)
  const colorMode = input.mode ?? old?.mode ?? legacyMode(supplied, workspace.theme.mode)
  const palettes: Pick<ThemeEntry, 'light' | 'dark'> = {}
  for (const mode of ['light', 'dark'] as const) {
    // save 的显式分支整组替换；没传则保留。旧 overrides 中的中性色只更新它原属的模式。
    const legacyColors = mode === colorMode ? colors : {}
    const merged = input[mode] === null ? {} : input[mode] !== undefined
      ? {...legacyColors, ...cleanOverrides(input[mode])}
      : {...old?.[mode], ...legacyColors}
    if (Object.keys(merged).length) palettes[mode] = merged
  }

  let theme: ThemeEntry
  let themes: ThemeEntry[]
  if (existing) {
    theme = {
      ...old!,
      name: name || existing.name,
      description: input.description !== undefined ? input.description.trim().slice(0, 120) : existing.description,
      overrides: input.overrides !== undefined ? shared : old!.overrides,
      ...palettes,
      ...(input.fonts !== undefined ? fontsField(input.fonts) : old!.fonts ? {fonts: old!.fonts} : {}),
      ...(input.mode ? {mode: input.mode} : {}),
    }
    themes = workspace.themes.map((item) => (item.id === existing.id ? theme : item))
  } else {
    if (!name) throw new WorkspaceError('新主题需要一个名字')
    if (workspace.themes.length >= MAX_THEMES) throw new WorkspaceError(`主题库满了，最多 ${MAX_THEMES} 个，先删掉不用的。`)
    theme = {
      id: uniqueId(workspace, name),
      name,
      description: (input.description ?? '').trim().slice(0, 120),
      overrides: shared,
      ...palettes,
      ...fontsField(input.fonts),
      ...(input.mode ? {mode: input.mode} : Object.keys(colors).length ? {mode: colorMode} : {}),
    }
    themes = [...workspace.themes, theme]
  }
  // 展开旧条目后显式清空也必须生效，不能把旧字段带回来。
  if (!palettes.light) delete theme.light
  if (!palettes.dark) delete theme.dark
  if (input.fonts !== undefined && !cleanFonts(input.fonts).length) delete theme.fonts
  const next = {...workspace, themes}
  // 编辑当前主题不等于重新应用它，不能悄悄撤销用户手选的明暗。
  const preserveMode = existing?.id === workspace.theme.active && input.mode === undefined
  return {workspace: input.activate === false || preserveMode ? next : activate(next, theme), theme, created: !existing}
}

/** 切换到某个主题（按 id 或名字）。 */
export function applyTheme(workspace: Workspace, ref: string): {workspace: Workspace; theme: ThemeEntry} {
  const theme = find(workspace, ref)
  return {workspace: activate(workspace, theme), theme}
}

/** 删掉一个主题；正在用的会回到默认主题。默认主题删不掉。 */
export function removeTheme(workspace: Workspace, ref: string): {workspace: Workspace; removed: ThemeEntry} {
  const removed = find(workspace, ref)
  if (removed.builtin) throw new WorkspaceError('内置主题不能删除。')
  const next = {...workspace, themes: workspace.themes.filter((item) => item.id !== removed.id)}
  return {workspace: workspace.theme.active === removed.id ? activate(next, DEFAULT_THEME) : next, removed}
}

/** 用户手动切明暗：同时记成基准，之后切到不指定明暗的主题会回到它。 */
export function setMode(workspace: Workspace, mode: 'light' | 'dark'): Workspace {
  return {...workspace, theme: {...workspace.theme, mode, base: mode}}
}

/**
 * 改当前主题的明暗或变量。
 * 当前是默认主题时先另存一份「自定义 N」再改，默认主题保持原样。
 */
export function tweakTheme(workspace: Workspace, input: {mode?: string; overrides?: Record<string, unknown> | null; light?: unknown; dark?: unknown; fonts?: unknown}): {workspace: Workspace; forked?: ThemeEntry} {
  let next = workspace
  if (input.mode !== undefined) {
    if (input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('主题模式只能是 light 或 dark')
    next = setMode(next, input.mode)
  }
  if (input.overrides === undefined && input.light === undefined && input.dark === undefined && input.fonts === undefined) return {workspace: next}

  const current = normalizeEntry(activeTheme(next), next.theme.mode)
  if (input.overrides === null) {
    if (current.builtin) return {workspace: next}
    const {fonts: _fonts, light: _light, dark: _dark, ...rest} = current
    return {workspace: {...next, themes: next.themes.map((item) => (item.id === current.id ? {...rest, overrides: {}} : item))}}
  }
  const {shared: patch, colors} = splitOverrides(cleanOverrides(input.overrides))
  const palettes: Pick<ThemeEntry, 'light' | 'dark'> = {}
  for (const mode of ['light', 'dark'] as const) {
    const branch = input[mode] === null ? {} : {
      ...current[mode],
      ...(mode === next.theme.mode ? colors : {}),
      ...cleanOverrides(input[mode]),
    }
    if (Object.keys(branch).length) palettes[mode] = branch
  }
  const fonts = input.fonts === undefined ? undefined : cleanFonts(input.fonts)
  if (current.builtin) {
    if (next.themes.length >= MAX_THEMES) throw new WorkspaceError(`主题库满了，最多 ${MAX_THEMES} 个，先删掉不用的。`)
    let n = 1
    while (next.themes.some((item) => item.name === `自定义 ${n}`)) n += 1
    const forked: ThemeEntry = {id: uniqueId(next, `custom-${n}`), name: `自定义 ${n}`, description: '', overrides: patch, ...palettes, ...(fonts?.length ? {fonts} : {})}
    return {workspace: {...next, themes: [...next.themes, forked], theme: {...next.theme, active: forked.id}}, forked}
  }
  return {
    workspace: {
      ...next,
      themes: next.themes.map((item) => {
        if (item.id !== current.id) return item
        const merged: ThemeEntry = {...current, overrides: {...current.overrides, ...patch}, ...palettes}
        if (!palettes.light) delete merged.light
        if (!palettes.dark) delete merged.dark
        if (fonts) {
          if (fonts.length) merged.fonts = fonts
          else delete merged.fonts
        }
        return merged
      }),
    },
  }
}

/** 列表里的色块：从主题变量里取背景、文字、主色；没覆盖的用默认主题的值。 */
export function swatch(theme: ThemeEntry, mode: 'light' | 'dark'): {bg: string; text: string; main: string} {
  const base = DEFAULT_THEME_PALETTES[mode]
  const vars = resolveThemeOverrides(theme, mode)
  return {bg: vars.bg ?? base.bg, text: vars.text ?? base.text, main: vars.main ?? base.main}
}
