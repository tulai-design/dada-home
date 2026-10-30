import {assertBoundedJson, assertRendererContract, assertThemePackageRef, boundedText, exact} from './themePackages/boundary'
import {getThemePackageAvailability} from './themePackages/availability'
import type {ThemePackageAvailability} from './themePackages/contracts'
import {validateOverrideMap, validateThemeDesign} from './themeAuthoring/validation'
import {WorkspaceError} from './errors'
import {cleanFonts, fontVars} from './fonts'
import {themeDesignLayers} from './themeResolution'
import {isThemeRenderer, themeCapabilities} from './themeCatalog'
import {DEFAULT_APPEARANCE_THEME, DEFAULT_THEME, DEFAULT_THEME_ID, IOS_THEME, PIXEL_THEME, SWITCH_THEME, WIN98_THEME, MAX_THEMES, activeTheme, type ThemeEntry, type ThemeSkin, type ThemeShell, type Workspace} from './workspace'

/**
 * 主题库的纯函数。
 *
 * 主题是「独立设计快照 + 实现引用」的一条记录，存在 Workspace.themes 里，随工作空间一起导出、可撤销。
 * 默认主题永远在库里，且不可改：AI 在默认主题上调色，会先另存成新主题再改，
 * 所以无论怎么折腾，都能一键回到最初的样子。
 */

type Mode = 'light' | 'dark'
type Overrides = Record<string, string>

/** 对应 theme.css 的基础配色，外观查询与缩略图共用；浏览器回归检查两者一致。 */
export const DEFAULT_THEME_PALETTES = {
  light: {bg: '#f4f0e6', bg2: '#ebe5d8', bg3: '#ddd5c4', text: '#1c1815', text2: '#5a5248', text3: '#8d8478', text4: '#cbc2b2', border: 'rgba(28, 24, 21, 0.08)', rule: '#1c1815', main: '#e5372e'},
  dark: {bg: '#151210', bg2: '#1e1a17', bg3: '#2b2622', text: '#efe9df', text2: '#b3a99b', text3: '#7f766a', text4: '#3a342e', border: 'rgba(239, 233, 223, 0.09)', rule: '#efe9df', main: '#ff5a4f'},
} satisfies Record<Mode, Overrides>

// 这些中性色不能作为两个模式共用的固定值，否则内联样式会锁住深浅色切换。
const MODE_COLORS = new Set(['bg', 'bg2', 'bg3', 'text', 'text2', 'text3', 'text4', 'border', 'rule', 'main'])

function splitOverrides(overrides: Overrides): {shared: Overrides; colors: Overrides} {
  const shared: Overrides = {}
  const colors: Overrides = {}
  for (const [name, value] of Object.entries(overrides)) (MODE_COLORS.has(name) ? colors : shared)[name] = value
  return {shared, colors}
}

/** 共用变量 → 当前模式；缺失分支由样式表提供该模式的系统配色。 */
export function resolveThemeOverrides(theme: ThemeEntry, mode: Mode): Overrides {
  const entry = theme
  return {...entry.overrides, ...entry[mode]}
}

const BASE_SHARED = {radius: '0px', 'radius-lg': '0px', frame: '7px', 'side-width': '84px', gutter: '28px', 'frame-gap': 'var(--frame)', 'frame-color': 'var(--main)'}
export type ThemeValueSource = 'default' | 'font' | 'shared' | 'light' | 'dark' | 'preference'

/** 全部消费者共用的有效主题；values 是语义 CSS 值，不是浏览器 computedStyle。 */
export function resolveTheme(theme: ThemeEntry, mode: Mode, preferences: {frameOff?: boolean; packageAvailability?: ThemePackageAvailability} = {}) {
  const availability = preferences.packageAvailability ?? getThemePackageAvailability(theme)
  const available = availability.status === 'available' && isThemeRenderer(theme.skin, theme.shell)
  const entry = available ? theme : {...DEFAULT_THEME, fonts: []}
  const skin = entry.skin as ThemeSkin
  const shell = entry.shell as ThemeShell
  const capabilities = themeCapabilities(skin)
  const host = {paper: DEFAULT_THEME, ios: IOS_THEME, pixel: PIXEL_THEME, switch: SWITCH_THEME, win98: WIN98_THEME}[skin]
  // 固定实现的默认合同，不读取 origin；用户快照和模式层仍优先。
  const hostOverrides: Overrides = {...fontVars(host.fonts), ...host.overrides, ...host[mode]}
  const defaults: Overrides = {...BASE_SHARED, ...DEFAULT_THEME_PALETTES[mode], ...fontVars(undefined), ...hostOverrides}
  const values = {...defaults}
  const sources: Record<string, ThemeValueSource> = Object.fromEntries(Object.keys(defaults).map(key => [key, 'default']))
  const overrides: Overrides = {...hostOverrides}
  const layer = (input: Overrides, source: ThemeValueSource) => {
    for (const [key, value] of Object.entries(input)) {values[key] = value; overrides[key] = value; sources[key] = source}
  }
  for (const design of themeDesignLayers(entry, mode)) layer(design.values, design.source)
  for (const [part, recipe] of Object.entries(entry.recipes ?? {})) if (recipe.radius !== undefined) layer({[`recipe-${part}-radius`]: `${recipe.radius}px`}, 'shared')
  if (entry.shellConfig?.coverScale !== undefined) layer({'switch-cover-scale': String(entry.shellConfig.coverScale / 100)}, 'shared')
  if (preferences.frameOff) layer({frame: '0px', 'frame-gap': '0px'}, 'preference')
  return {id: theme.id, skin, shell, requested: {id: theme.id, skin: theme.skin, shell: theme.shell, ...(theme.packageRef ? {packageRef: {...theme.packageRef}} : {})}, availability, effectiveFonts: entry.fonts, ...(theme.origin ? {origin: {...theme.origin}} : {}), mode, values, sources, overrides, capabilities, shellConfig: entry.shellConfig ?? {}, recipes: entry.recipes ?? {}}
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const BUILTIN_THEMES = new Map([DEFAULT_THEME, IOS_THEME, PIXEL_THEME, SWITCH_THEME, WIN98_THEME].map(theme => [theme.id, theme]))
const BUILTIN_IDS = new Set(BUILTIN_THEMES.keys())
const ENTRY_FIELDS = new Set(['id', 'name', 'description', 'overrides', 'light', 'dark', 'fonts', 'mode', 'builtin', 'skin', 'shell', 'origin', 'recipes', 'shellConfig', 'packageRef', 'rendererContract', 'opaqueDesign'])

/** 所有 unknown 主题入口共用校验；不从自定义实例 ID 推断实现。 */
export function assertThemeEntry(raw: unknown): asserts raw is ThemeEntry {
  if (!object(raw) || Object.keys(raw).some(key => !ENTRY_FIELDS.has(key)) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 120 || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 20 || typeof raw.description !== 'string' || raw.description.length > 120) throw new WorkspaceError('主题身份、名称或造型/外壳引用无效')
  boundedText(raw.skin, 80, 'skin'); boundedText(raw.shell, 80, 'shell')
  if (raw.packageRef !== undefined) {assertThemePackageRef(raw.packageRef); assertRendererContract(raw.rendererContract); assertBoundedJson(raw)}
  else if (raw.rendererContract !== undefined || raw.opaqueDesign !== undefined || !isThemeRenderer(raw.skin, raw.shell)) throw new WorkspaceError('非包主题需要已知造型/外壳')
  const contract = raw.rendererContract as ThemeEntry['rendererContract']
  const knownDesign = isThemeRenderer(raw.skin, raw.shell) && (!contract || contract.schemaVersion === 1 && contract.skinVersion === 1 && contract.shellVersion === 1) && raw.opaqueDesign === undefined
  const builtin = BUILTIN_THEMES.get(raw.id)
  if (builtin && (raw.packageRef !== undefined || Array.isArray(raw.fonts) && raw.fonts.some(font => object(font) && font.resource !== undefined))) throw new WorkspaceError('内置主题ID不能冒用包或本地字体依赖')
  if (builtin && (raw.skin !== builtin.skin || raw.shell !== builtin.shell || raw.builtin === false)) throw new WorkspaceError('内置主题 ID 与实现身份不一致')
  if (!object(raw.overrides)) throw new WorkspaceError('主题 overrides 必须是对象')
  if (knownDesign) cleanOverrides(raw.overrides)
  else if (Object.values(raw.overrides).some(value => typeof value !== 'string')) throw new WorkspaceError('不可用主题变量必须为字符串')
  for (const key of ['light', 'dark']) if (raw[key] !== undefined) {if (!object(raw[key])) throw new WorkspaceError(`主题 ${key} 必须是对象`); if (knownDesign) cleanOverrides(raw[key]); else if (Object.values(raw[key]).some(value => typeof value !== 'string')) throw new WorkspaceError('不可用主题模式变量必须为字符串')}
  if (raw.mode !== undefined && raw.mode !== 'light' && raw.mode !== 'dark') throw new WorkspaceError('主题 mode 只能是 light 或 dark')
  if (raw.builtin !== undefined && (typeof raw.builtin !== 'boolean' || raw.builtin && !BUILTIN_IDS.has(raw.id))) throw new WorkspaceError('主题 builtin 身份无效')
  if (raw.fonts !== undefined) {
    if (!Array.isArray(raw.fonts) || raw.fonts.some(font => !object(font) || Object.keys(font).some(key => key !== 'family' && key !== 'role' && key !== 'resource'))) throw new WorkspaceError('主题 fonts 必须是字体对象数组')
    cleanFonts(raw.fonts)
  }
  if (raw.packageRef && (!Array.isArray(raw.fonts) || raw.fonts.some(font => !object(font) || font.resource === undefined))) throw new WorkspaceError('包主题必须显式使用系统字体fonts:[]或精确本地资源，不能默认联网')
  if (knownDesign) validateThemeDesign(raw as ThemeEntry)
  if (raw.opaqueDesign !== undefined) {
    if (!object(raw.opaqueDesign)) throw new WorkspaceError('opaqueDesign必须为对象')
    exact(raw.opaqueDesign, ['schemaVersion', 'payload'])
    if (!Number.isSafeInteger(raw.opaqueDesign.schemaVersion) || Number(raw.opaqueDesign.schemaVersion) < 1 || !object(raw.opaqueDesign.payload)) throw new WorkspaceError('opaqueDesign schema/payload无效')
    assertBoundedJson(raw.opaqueDesign)
  } else if (raw.rendererContract && (raw.rendererContract as {schemaVersion: number}).schemaVersion !== 1) throw new WorkspaceError('未知schema需要保留opaqueDesign')
  if (raw.origin !== undefined && (!object(raw.origin) || Object.keys(raw.origin).some(key => key !== 'definitionId' && key !== 'version') || typeof raw.origin.definitionId !== 'string' || !BUILTIN_IDS.has(raw.origin.definitionId) || !Number.isSafeInteger(raw.origin.version) || Number(raw.origin.version) < 1)) throw new WorkspaceError('主题 origin 必须指向合法定义与正整数版本')
}

/** 备份/显式导入也走同一主题边界，避免 migrate 过滤坏主题后仍报告成功。 */
export function assertWorkspaceThemes(raw: unknown): void {
  if (!object(raw) || !Array.isArray(raw.themes) || raw.themes.length > MAX_THEMES || !Array.isArray(raw.templates)) throw new WorkspaceError('工作空间主题库或模板库无效')
  const ids = new Set<string>()
  for (const theme of raw.themes) {assertThemeEntry(theme); if (ids.has(theme.id)) throw new WorkspaceError('主题 ID 重复'); ids.add(theme.id)}
  if (BUILTIN_IDS.size + [...ids].filter(id => !BUILTIN_IDS.has(id)).length > MAX_THEMES) throw new WorkspaceError(`补齐内置主题后主题库超过 ${MAX_THEMES} 个`)
  for (const template of raw.templates) {
    if (!object(template) || !object(template.snapshot)) throw new WorkspaceError('模板快照无效')
    if (template.snapshot.theme !== undefined) assertThemeEntry(template.snapshot.theme)
  }
}

/** 校验并规整一组变量覆盖。AI 和导入的数据都不可信。 */
export function cleanOverrides(raw: unknown): Record<string, string> {return validateOverrideMap(raw)}

/** 导入或升级时读主题库：坏条目丢掉，内置预设始终用当前定义。 */
export function readThemes(raw: unknown, _fallbackMode: Mode = 'light'): ThemeEntry[] {
  const list: ThemeEntry[] = [DEFAULT_THEME, IOS_THEME, PIXEL_THEME, SWITCH_THEME, WIN98_THEME]
  if (Array.isArray(raw)) for (const item of raw.slice(0, MAX_THEMES)) {
    if (object(item) && typeof item.id === 'string' && BUILTIN_IDS.has(item.id)) continue
    try {
      assertThemeEntry(item)
      if (list.some(entry => entry.id === item.id) || list.length >= MAX_THEMES) continue
      const {builtin: _builtin, ...entry} = item
      list.push({...entry, overrides: {...entry.overrides}, ...(entry.light ? {light: {...entry.light}} : {}), ...(entry.dark ? {dark: {...entry.dark}} : {}), ...(entry.fonts ? {fonts: cleanFonts(entry.fonts)} : {}), ...(entry.origin ? {origin: {...entry.origin}} : {})})
    } catch { /* 宽松本地读取跳过损坏条目；导入/同步/备份必须先严格校验。 */ }
  }
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

/** 外框偏好属于当前工作空间，变体沿用相同造型能力。 */
export function setSkinFrame(workspace: Workspace, on: boolean): Workspace {
  const active = activeTheme(workspace)
  if (themeCapabilities(active.skin).frame !== 'toggle') return workspace
  const theme = {...workspace.theme}
  if (on) delete theme.frameOff
  else theme.frameOff = true
  return {...workspace, theme}
}

/** fonts 字段：空数组表示清掉，所以不写进主题。 */
function fontsField(raw: unknown): {fonts?: ReturnType<typeof cleanFonts>} {
  const fonts = cleanFonts(raw)
  return {fonts}
}

/** 存一个主题：id 或同名的已有主题会被更新，否则新建；默认启用。 */
export function saveTheme(
  workspace: Workspace,
  input: {id?: string; from?: string; name?: string; description?: string; overrides?: unknown; light?: unknown; dark?: unknown; fonts?: unknown; recipes?: ThemeEntry['recipes'] | null; shellConfig?: ThemeEntry['shellConfig'] | null; mode?: string; activate?: boolean},
): {workspace: Workspace; theme: ThemeEntry; created: boolean} {
  if (input.mode !== undefined && input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('mode 只能是 light 或 dark')
  const name = input.name?.trim().slice(0, 20)
  const existing = (input.id ? workspace.themes.find(item => item.id === input.id) : undefined) ?? (name ? workspace.themes.find(item => item.name.toLowerCase() === name.toLowerCase()) : undefined)
  if (name?.toLowerCase() === DEFAULT_THEME_ID) throw new WorkspaceError('「default」是默认主题的 id，换个名字。')
  if (existing?.builtin) throw new WorkspaceError('内置主题不能修改。换个名字另存为新主题。')
  if (existing && input.from !== undefined) throw new WorkspaceError('更新主题时不能重选 from 来源；请换个名字另存。')
  if (!existing && !name) throw new WorkspaceError('新主题需要一个名字')
  if (!existing && workspace.themes.length >= MAX_THEMES) throw new WorkspaceError(`主题库满了，最多 ${MAX_THEMES} 个，先删掉不用的。`)
  const original = existing ?? (input.from !== undefined ? find(workspace, input.from) : activeTheme(workspace))
  assertThemeEditable(original)
  const old = cloneTheme(original)
  const supplied = cleanOverrides(input.overrides)
  const {shared, colors} = splitOverrides(supplied)
  const fonts = input.fonts === undefined ? undefined : cleanFonts(input.fonts)
  const fontKeys = fontOverrideKeys(fonts)
  const colorMode = input.mode ?? workspace.theme.mode
  const palettes: Pick<ThemeEntry, 'light' | 'dark'> = {}
  for (const mode of ['light', 'dark'] as const) {
    const inherited = withoutKeys(old[mode], [...Object.keys(shared), ...fontKeys])
    const shortcuts = {...(colors.main !== undefined ? {main: colors.main} : {}), ...(mode === colorMode ? colors : {})}
    const merged = input[mode] === null ? {} : input[mode] !== undefined ? {...shortcuts, ...cleanOverrides(input[mode])} : {...inherited, ...shortcuts}
    if (Object.keys(merged).length) palettes[mode] = merged
  }
  const theme: ThemeEntry = {
    ...old,
    id: existing?.id ?? uniqueId(workspace, name!),
    name: name || old.name,
    description: input.description !== undefined ? input.description.trim().slice(0, 120) : existing ? old.description : '',
    overrides: input.overrides !== undefined ? shared : withoutKeys(old.overrides, fontKeys),
    ...palettes,
    ...(input.fonts !== undefined ? fontsField(input.fonts) : {}),
    ...(input.mode ? {mode: input.mode} : {}),
    ...(input.recipes !== undefined ? {recipes: input.recipes ?? undefined} : {}),
    ...(input.shellConfig !== undefined ? {shellConfig: input.shellConfig ?? undefined} : {}),
  }
  delete theme.builtin
  if (!palettes.light) delete theme.light
  if (!palettes.dark) delete theme.dark
  assertThemeEntry(theme)
  const themes = existing ? workspace.themes.map(item => item.id === existing.id ? theme : item) : [...workspace.themes, theme]
  const next = {...workspace, themes}
  const preserveMode = existing?.id === workspace.theme.active && input.mode === undefined
  return {workspace: input.activate === false || preserveMode ? next : activate(next, theme), theme, created: !existing}
}

const cloneTheme = (entry: ThemeEntry): ThemeEntry => JSON.parse(JSON.stringify(entry)) as ThemeEntry
const withoutKeys = (input: Overrides | undefined, keys: string[]): Overrides => Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => !keys.includes(key)))
const fontOverrideKeys = (fonts: ReturnType<typeof cleanFonts> | undefined): string[] => [...new Set((fonts ?? []).flatMap(font => font.role ? [`font-${font.role}`] : []))]

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
  return {workspace: workspace.theme.active === removed.id ? activate(next, DEFAULT_APPEARANCE_THEME) : next, removed}
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
  if (input.mode !== undefined && input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('主题模式只能是 light 或 dark')
  // 全部设计参数先校验，清空也不能掩盖其他非法输入。
  const {shared: patch, colors} = splitOverrides(cleanOverrides(input.overrides))
  const branches = {light: cleanOverrides(input.light), dark: cleanOverrides(input.dark)}
  const fonts = input.fonts === undefined ? undefined : cleanFonts(input.fonts)
  const fontKeys = fontOverrideKeys(fonts)
  const next = input.mode !== undefined ? setMode(workspace, input.mode) : workspace
  if (input.overrides === undefined && input.light === undefined && input.dark === undefined && input.fonts === undefined) return {workspace: next}
  assertThemeEditable(activeTheme(next))
  const current = cloneTheme(activeTheme(next))
  if (input.overrides === null) {
    if (current.builtin) return {workspace: next}
    const {fonts: _fonts, light: _light, dark: _dark, ...rest} = current
    return {workspace: {...next, themes: next.themes.map(item => item.id === current.id ? {...rest, ...(current.packageRef ? {fonts: []} : {}), overrides: {}} : item)}}
  }
  const palettes: Pick<ThemeEntry, 'light' | 'dark'> = {}
  for (const mode of ['light', 'dark'] as const) {
    const branch = input[mode] === null ? {} : {...withoutKeys(current[mode], [...Object.keys(patch), ...fontKeys]), ...(colors.main !== undefined ? {main: colors.main} : {}), ...(mode === next.theme.mode ? colors : {}), ...branches[mode]}
    if (Object.keys(branch).length) palettes[mode] = branch
  }
  const merged: ThemeEntry = {...current, overrides: {...withoutKeys(current.overrides, fontKeys), ...patch}, ...palettes}
  if (!palettes.light) delete merged.light
  if (!palettes.dark) delete merged.dark
  if (fonts) merged.fonts = fonts
  if (current.builtin) {
    if (next.themes.length >= MAX_THEMES) throw new WorkspaceError(`主题库满了，最多 ${MAX_THEMES} 个，先删掉不用的。`)
    let n = 1
    while (next.themes.some(item => item.name === `自定义 ${n}`)) n += 1
    const forked: ThemeEntry = {...merged, id: uniqueId(next, `custom-${n}`), name: `自定义 ${n}`}
    delete forked.builtin
    assertThemeEntry(forked)
    return {workspace: {...next, themes: [...next.themes, forked], theme: {...next.theme, active: forked.id}}, forked}
  }
  assertThemeEntry(merged)
  return {workspace: {...next, themes: next.themes.map(item => item.id === current.id ? merged : item)}}
}

/** 列表里的色块：从主题变量里取背景、文字、主色；没覆盖的用默认主题的值。 */
export function swatch(theme: ThemeEntry, mode: 'light' | 'dark'): {bg: string; text: string; main: string} {
  const {values} = resolveTheme(theme, mode)
  return {bg: values.bg, text: values.text, main: values.main}
}

/** 数据可以保留缺依赖设计，但作者与即时编辑不能猜未知schema或覆盖不可用来源。 */
export function assertThemeEditable(theme: ThemeEntry): void {
  const availability = getThemePackageAvailability(theme)
  if (theme.opaqueDesign || !isThemeRenderer(theme.skin, theme.shell) || availability.status !== 'available') throw new WorkspaceError(`主题当前不可编辑：${availability.reason ?? availability.status}`)
}
