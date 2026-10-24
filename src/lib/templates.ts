import {WorkspaceError} from './errors'
import {findPreset, PRESETS} from './presets'
import {instanceId, DEFAULT_THEME, DEFAULT_THEME_ID, MAX_TEMPLATES, MAX_THEMES, type Page, type StatusItem, type TemplateEntry, type TemplateSnapshot, type ThemeEntry, type Workspace} from './workspace'

/**
 * 模板库的纯函数。
 *
 * 模板是整套页面设计的快照（页面、组件、状态条、版式、自定义组件、已装的市场组件，可选配色），
 * 存在 Workspace.templates 里，随工作空间一起导出、可撤销。
 * 套用模板会整体替换当前设计，但组件里的数据（待办、便签、书签…）不动：
 * 切回自己存过的模板，数据还在原处。
 */

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 把当前的设计拍成快照。 */
export function snapshotOf(workspace: Workspace, withTheme = true): TemplateSnapshot {
  const active = workspace.themes.find((item) => item.id === workspace.theme.active)
  return clone({
    pages: workspace.pages,
    statusbar: workspace.statusbar,
    layout: workspace.layout,
    widgets: workspace.widgets,
    addons: workspace.addons,
    ...(workspace.dock ? {dock: workspace.dock} : {}),
    ...(withTheme && active ? {theme: active} : {}),
  })
}

function uniqueId(workspace: Workspace, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'template'
  let id = base
  for (let n = 2; workspace.templates.some((item) => item.id === id) || findPreset(id); n += 1) id = `${base}-${n}`
  return id
}

function findOwn(workspace: Workspace, ref: string): TemplateEntry | undefined {
  const needle = ref.trim().toLowerCase()
  return workspace.templates.find((item) => item.id === ref) ?? workspace.templates.find((item) => item.name.toLowerCase() === needle)
}

/** 用户存过的模板里按 id 或名字找；找不到再看内置预设。 */
export function lookupTemplate(workspace: Workspace, ref: string): {kind: 'own'; entry: TemplateEntry} | {kind: 'preset'; preset: (typeof PRESETS)[number]} {
  const own = findOwn(workspace, ref)
  if (own) return {kind: 'own', entry: own}
  const preset = findPreset(ref)
  if (preset) return {kind: 'preset', preset}
  const names = [...workspace.templates.map((item) => `${item.id}（${item.name}）`), ...PRESETS.map((item) => `${item.id}（${item.name}，内置）`)]
  throw new WorkspaceError(`没有这个模板：${ref}。现有：${names.join('、')}`)
}

/** 存一个模板：同名或同 id 的会被更新，否则新建。默认存的是当前设计（带配色）。 */
export function saveTemplate(
  workspace: Workspace,
  input: {id?: string; name?: string; description?: string; withTheme?: boolean},
): {workspace: Workspace; template: TemplateEntry; created: boolean} {
  const name = input.name?.trim().slice(0, 20)
  const existing = (input.id ? workspace.templates.find((item) => item.id === input.id) : undefined) ?? (name ? findOwn(workspace, name) : undefined)
  if (name && PRESETS.some((item) => item.name === name)) throw new WorkspaceError(`「${name}」是内置预设的名字，换个名字另存。`)
  const now = Date.now()
  const snapshot = snapshotOf(workspace, input.withTheme !== false)

  if (existing) {
    const template: TemplateEntry = {
      ...existing,
      name: name || existing.name,
      description: input.description !== undefined ? input.description.trim().slice(0, 120) : existing.description,
      updatedAt: now,
      snapshot,
    }
    return {workspace: {...workspace, templates: workspace.templates.map((item) => (item.id === existing.id ? template : item)), template: template.id}, template, created: false}
  }
  if (!name) throw new WorkspaceError('新模板需要一个名字')
  if (workspace.templates.length >= MAX_TEMPLATES) throw new WorkspaceError(`模板库满了，最多 ${MAX_TEMPLATES} 个，先删掉不用的。`)
  const template: TemplateEntry = {id: uniqueId(workspace, name), name, description: (input.description ?? '').trim().slice(0, 120), createdAt: now, updatedAt: now, snapshot}
  return {workspace: {...workspace, templates: [...workspace.templates, template], template: template.id}, template, created: true}
}

/** 改名与说明，不动快照。 */
export function renameTemplate(workspace: Workspace, ref: string, input: {name?: string; description?: string}): Workspace {
  const entry = findOwn(workspace, ref)
  if (!entry) throw new WorkspaceError(`没有这个模板：${ref}`)
  const name = input.name?.trim().slice(0, 20) || entry.name
  if (workspace.templates.some((item) => item.id !== entry.id && item.name === name)) throw new WorkspaceError(`已经有叫「${name}」的模板了`)
  const next = {...entry, name, description: input.description !== undefined ? input.description.trim().slice(0, 120) : entry.description, updatedAt: Date.now()}
  return {...workspace, templates: workspace.templates.map((item) => (item.id === entry.id ? next : item))}
}

export function removeTemplate(workspace: Workspace, ref: string): {workspace: Workspace; removed: TemplateEntry} {
  const removed = findOwn(workspace, ref)
  if (!removed) throw new WorkspaceError(`没有这个模板：${ref}。内置预设不能删除。`)
  const {template, ...rest} = workspace
  return {workspace: {...rest, templates: workspace.templates.filter((item) => item.id !== removed.id), ...(template && template !== removed.id ? {template} : {})}, removed}
}

/** 给预设里的页面和组件换上全新的 id，避免两次套用共用同一份组件数据。 */
function freshIds(snapshot: TemplateSnapshot): TemplateSnapshot {
  const pages: Page[] = snapshot.pages.map((page) => ({...page, components: page.components.map((item) => ({...item, id: instanceId(item.type)}))}))
  const statusbar: StatusItem[] = snapshot.statusbar.map((item) => ({...item, id: instanceId(`status-${item.type}`)}))
  return {...snapshot, pages, statusbar}
}

/** 把模板里带的配色放进主题库并启用；库里已有一模一样的就直接用它。 */
function adoptTheme(workspace: Workspace, theme: ThemeEntry): Workspace {
  if (theme.id === DEFAULT_THEME_ID || theme.builtin) {
    return {...workspace, theme: {...workspace.theme, active: DEFAULT_THEME_ID, mode: workspace.theme.base}}
  }
  const same = workspace.themes.find((item) => item.name === theme.name && JSON.stringify(item.overrides) === JSON.stringify(theme.overrides) && JSON.stringify(item.fonts ?? []) === JSON.stringify(theme.fonts ?? []) && item.mode === theme.mode)
  let themes = workspace.themes
  let entry = same
  if (!entry) {
    if (themes.length >= MAX_THEMES) return workspace
    let id = theme.id
    for (let n = 2; themes.some((item) => item.id === id); n += 1) id = `${theme.id}-${n}`
    entry = {...clone(theme), id, builtin: undefined}
    delete entry.builtin
    themes = [...themes, entry]
  }
  return {...workspace, themes, theme: {...workspace.theme, active: entry.id, mode: entry.mode ?? workspace.theme.base}}
}

/** 套用模板（用户存的或内置预设）。整体替换页面、状态条、版式、自定义组件和已装组件。 */
export function applyTemplate(workspace: Workspace, ref: string): {workspace: Workspace; name: string; id: string} {
  const hit = lookupTemplate(workspace, ref)
  const base = hit.kind === 'own' ? clone(hit.entry.snapshot) : freshIds(hit.preset.build())
  const id = hit.kind === 'own' ? hit.entry.id : hit.preset.id
  const name = hit.kind === 'own' ? hit.entry.name : hit.preset.name
  let next: Workspace = {
    ...workspace,
    pages: base.pages,
    statusbar: base.statusbar,
    layout: base.layout,
    widgets: base.widgets,
    addons: base.addons,
    template: id,
  }
  // 模板里没有 Dock 设置就回到默认的玻璃，别把上一套的留下来
  if (base.dock) next.dock = base.dock
  else delete next.dock
  if (base.theme) next = adoptTheme(next, base.theme)
  return {workspace: next, name, id}
}

/** 当前设计和模板里存的是否一致（不比配色）。预设每次现场生成，没法比，当作一致。 */
export function isSynced(workspace: Workspace, entry: TemplateEntry): boolean {
  const now = snapshotOf(workspace, false)
  const saved = entry.snapshot
  return JSON.stringify([now.pages, now.statusbar, now.layout, now.widgets, now.addons, now.dock ?? null]) === JSON.stringify([saved.pages, saved.statusbar, saved.layout, saved.widgets, saved.addons, saved.dock ?? null])
}

/** 一句话说清模板里有什么，列表里和给 AI 看都用它。 */
export function summarize(snapshot: TemplateSnapshot): string {
  const pages = snapshot.pages.length
  const parts = snapshot.pages.reduce((n, page) => n + page.components.length, 0)
  return `${pages} 个页面 · ${parts} 个组件${snapshot.theme && snapshot.theme.id !== DEFAULT_THEME.id ? ` · 主题「${snapshot.theme.name}」` : ''}`
}
