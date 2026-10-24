import {WorkspaceError} from './errors'
import {DEFAULT_THEME, DEFAULT_THEME_ID, MAX_THEMES, activeTheme, type ThemeEntry, type Workspace} from './workspace'

/**
 * 主题库的纯函数。
 *
 * 主题是「名字 + 说明 + 变量差异」的一条记录，存在 Workspace.themes 里，随工作空间一起导出、可撤销。
 * 默认主题永远在库里，且不可改：AI 在默认主题上调色，会先另存成新主题再改，
 * 所以无论怎么折腾，都能一键回到最初的样子。
 */

const NAME = /^[a-z][a-z0-9-]*$/
const MAX_VARS = 40

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

/** 导入或升级时读主题库：坏条目丢掉，默认主题保证在第一位。 */
export function readThemes(raw: unknown): ThemeEntry[] {
  const list: ThemeEntry[] = [DEFAULT_THEME]
  if (!Array.isArray(raw)) return list
  for (const item of raw.slice(0, MAX_THEMES)) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || item.id === DEFAULT_THEME_ID) continue
    if (list.some((entry) => entry.id === item.id)) continue
    try {
      list.push({
        id: item.id,
        name: item.name.trim().slice(0, 20) || '未命名',
        description: typeof item.description === 'string' ? item.description.slice(0, 120) : '',
        overrides: cleanOverrides(item.overrides),
        ...(item.mode === 'light' || item.mode === 'dark' ? {mode: item.mode} : {}),
      })
    } catch {
      /* 变量不合法的主题直接丢掉 */
    }
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
  return {...workspace, theme: {...workspace.theme, active: entry.id, mode: entry.mode ?? workspace.theme.base}}
}

/** 存一个主题：id 或同名的已有主题会被更新，否则新建；默认启用。 */
export function saveTheme(
  workspace: Workspace,
  input: {id?: string; name?: string; description?: string; overrides?: unknown; mode?: string; activate?: boolean},
): {workspace: Workspace; theme: ThemeEntry; created: boolean} {
  if (input.mode !== undefined && input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('mode 只能是 light 或 dark')
  const name = input.name?.trim().slice(0, 20)
  const existing =
    (input.id ? workspace.themes.find((item) => item.id === input.id) : undefined) ??
    (name ? workspace.themes.find((item) => item.name.toLowerCase() === name.toLowerCase()) : undefined)
  if (name?.toLowerCase() === DEFAULT_THEME_ID) throw new WorkspaceError('「default」是默认主题的 id，换个名字。')
  if (existing?.builtin) throw new WorkspaceError('默认主题不能修改。换个名字另存为新主题。')

  let theme: ThemeEntry
  let themes: ThemeEntry[]
  if (existing) {
    theme = {
      ...existing,
      name: name || existing.name,
      description: input.description !== undefined ? input.description.trim().slice(0, 120) : existing.description,
      overrides: input.overrides !== undefined ? cleanOverrides(input.overrides) : existing.overrides,
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
      overrides: cleanOverrides(input.overrides),
      ...(input.mode ? {mode: input.mode} : {}),
    }
    themes = [...workspace.themes, theme]
  }
  const next = {...workspace, themes}
  return {workspace: input.activate === false ? next : activate(next, theme), theme, created: !existing}
}

/** 切换到某个主题（按 id 或名字）。 */
export function applyTheme(workspace: Workspace, ref: string): {workspace: Workspace; theme: ThemeEntry} {
  const theme = find(workspace, ref)
  return {workspace: activate(workspace, theme), theme}
}

/** 删掉一个主题；正在用的会回到默认主题。默认主题删不掉。 */
export function removeTheme(workspace: Workspace, ref: string): {workspace: Workspace; removed: ThemeEntry} {
  const removed = find(workspace, ref)
  if (removed.builtin) throw new WorkspaceError('默认主题不能删除。')
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
export function tweakTheme(workspace: Workspace, input: {mode?: string; overrides?: Record<string, unknown> | null}): {workspace: Workspace; forked?: ThemeEntry} {
  let next = workspace
  if (input.mode !== undefined) {
    if (input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('主题模式只能是 light 或 dark')
    next = setMode(next, input.mode)
  }
  if (input.overrides === undefined) return {workspace: next}

  const current = activeTheme(next)
  if (input.overrides === null) {
    if (current.builtin) return {workspace: next}
    return {workspace: {...next, themes: next.themes.map((item) => (item.id === current.id ? {...item, overrides: {}} : item))}}
  }
  const patch = cleanOverrides(input.overrides)
  if (current.builtin) {
    if (next.themes.length >= MAX_THEMES) throw new WorkspaceError(`主题库满了，最多 ${MAX_THEMES} 个，先删掉不用的。`)
    let n = 1
    while (next.themes.some((item) => item.name === `自定义 ${n}`)) n += 1
    const forked: ThemeEntry = {id: uniqueId(next, `custom-${n}`), name: `自定义 ${n}`, description: '', overrides: patch}
    return {workspace: {...next, themes: [...next.themes, forked], theme: {...next.theme, active: forked.id}}, forked}
  }
  return {workspace: {...next, themes: next.themes.map((item) => (item.id === current.id ? {...item, overrides: {...item.overrides, ...patch}} : item))}}
}

/** 列表里的色块：从主题变量里取背景、文字、主色；没覆盖的用默认主题的值。 */
export function swatch(theme: ThemeEntry, mode: 'light' | 'dark'): {bg: string; text: string; main: string} {
  const base = mode === 'dark' ? {bg: '#151210', text: '#efe9df', main: '#ff5a4f'} : {bg: '#f4f0e6', text: '#1c1815', main: '#e5372e'}
  return {bg: theme.overrides.bg ?? base.bg, text: theme.overrides.text ?? base.text, main: theme.overrides.main ?? base.main}
}
