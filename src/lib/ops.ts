import {DEFAULT_DOCK_PRESET, DOCK_PRESETS, isDockPreset, scopeDockCss} from './dock'
import {getDefinition, listDefinitions, normalizeConfig} from './registry'
import {WorkspaceError} from './errors'
import {normalizeLayer} from '../fx/catalog'
import {assertFxBudgetChange} from '../fx/policy'
import {insertPageComponent, normalizePageSections, setPageSections as setSections} from './pageSections'
import {
  DEFAULT_LAYOUT,
  DEFAULT_HOME_LAYERS,
  DEFAULT_THEME,
  DEFAULT_APPEARANCE_THEME,
  IOS_THEME,
  PIXEL_THEME,
  SWITCH_THEME,
  WIN98_THEME,
  FROZEN_PAGE_ID,
  MAX_PAGES,
  MAX_STATUS_ITEMS,
  MAX_APPLICATIONS,
  WORKSPACE_VERSION,
  type StatusItem,
  instanceId,
  type ComponentInstance,
  type ComponentSpan,
  type ComponentType,
  type Appearance,
  type CustomWidget,
  type Page,
  type Wallpaper,
  type Workspace,
  isCustomType,
} from './workspace'
import {ANIMATIONS, normalizeHost, normalizeWidget, sanitizeCss} from './customWidget'
import {isPageIcon, PAGE_ICON_KEYS} from './pageIcons'
import {tweakTheme} from './themes'
import {ADDONS, addonOfType, getAddon, isInstalled, typeAvailable} from './market'
import {isApplicationType, listApplications, readApplications, updateApplication} from './applications'

/**
 * 工作空间的全部编辑操作。
 *
 * 每个操作都是纯函数：(工作空间, 参数) → 新工作空间，失败则抛出带中文说明的错误。
 * 不读写存储、不碰 React —— 这样 AI 工具、界面按钮、撤销栈、预览
 * 都能共用同一份实现，行为不会各写各的。
 */

export {WorkspaceError}

const SPANS: ComponentSpan[] = ['full', 'half', 'third', 'two-thirds']

function findPage(workspace: Workspace, pageId: string): Page {
  const page = workspace.pages.find((item) => item.id === pageId)
  if (!page) throw new WorkspaceError(`没有这个页面：${pageId}。现有页面：${workspace.pages.map((p) => `${p.id}（${p.name}）`).join('、') || '无'}`)
  return page
}

/** 按 id 找；找不到再按别名/类型模糊匹配，方便模型用「天气那块」这种说法。 */
export function locate(workspace: Workspace, ref: string, pageId?: string): {page: Page; instance: ComponentInstance} {
  const pages = pageId ? [findPage(workspace, pageId)] : workspace.pages
  const needle = ref.trim().toLowerCase()
  for (const page of pages) {
    const exact = page.components.find((item) => item.id === ref)
    if (exact) return {page, instance: exact}
  }
  const loose: {page: Page; instance: ComponentInstance}[] = []
  for (const page of pages) {
    for (const instance of page.components) {
      if ((instance.title ?? '').toLowerCase() === needle || instance.type === needle) loose.push({page, instance})
    }
  }
  if (loose.length === 1) return loose[0]
  if (loose.length > 1) throw new WorkspaceError(`「${ref}」对应不止一个组件，请用具体 id：${loose.map((hit) => hit.instance.id).join('、')}`)
  throw new WorkspaceError(`找不到组件：${ref}`)
}

function replacePage(workspace: Workspace, next: Page): Workspace {
  next = normalizePageSections(next)
  assertFxBudgetChange(workspace.pages.find((page) => page.id === next.id), next)
  return {...workspace, pages: workspace.pages.map((page) => (page.id === next.id ? next : page))}
}

/** 设置一页的分区；只安排原实例，不改变内容或应用身份。 */
export function setPageSections(workspace: Workspace, pageId: string, raw: unknown): Workspace {
  return replacePage(workspace, setSections(findPage(workspace, pageId), raw))
}

function readIcon(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !isPageIcon(value)) {
    throw new WorkspaceError(`没有这个图标：${String(value)}。可选：${PAGE_ICON_KEYS.join('、')}`)
  }
  return value
}

export function addPage(
  workspace: Workspace,
  input: {name: string; label?: string; id?: string; icon?: string},
): {workspace: Workspace; page: Page} {
  const name = input.name.trim()
  if (!name) throw new WorkspaceError('页面需要名称')
  if (workspace.pages.length >= MAX_PAGES) throw new WorkspaceError(`页面太多了，最多 ${MAX_PAGES} 页`)
  const base = (input.id ?? name).trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'page'
  let id = base
  for (let n = 2; workspace.pages.some((page) => page.id === id); n += 1) id = `${base}-${n}`
  const label = (input.label ?? name).trim().slice(0, 4) || name.slice(0, 4)
  const icon = readIcon(input.icon)
  const page: Page = {id, name, label, components: [], ...(icon ? {icon} : {})}
  return {workspace: {...workspace, pages: [...workspace.pages, page]}, page}
}

export function renamePage(
  workspace: Workspace,
  pageId: string,
  input: {name?: string; label?: string; icon?: string},
): Workspace {
  const page = findPage(workspace, pageId)
  if (page.id === FROZEN_PAGE_ID) throw new WorkspaceError('首页是固定项，不能修改名称和图标。')
  const name = input.name?.trim() || page.name
  const label = input.label?.trim().slice(0, 4) || page.label
  const icon = input.icon === undefined ? page.icon : readIcon(input.icon)
  const next: Page = {...page, name, label}
  if (icon) next.icon = icon
  else delete next.icon
  return replacePage(workspace, next)
}

export function removePage(workspace: Workspace, pageId: string): Workspace {
  findPage(workspace, pageId)
  if (pageId === FROZEN_PAGE_ID) throw new WorkspaceError('首页是固定项，不能删除。')
  if (workspace.pages.length <= 1) throw new WorkspaceError('至少要保留一个页面')
  return {...workspace, applications: listApplications(workspace), pages: workspace.pages.filter((page) => page.id !== pageId)}
}

/** 页面级样式：整页背景、对齐、自定义 CSS。 */
export function setPageStyle(
  workspace: Workspace,
  pageId: string,
  input: {css?: string | null; align?: string},
): Workspace {
  const page = findPage(workspace, pageId)
  const next: Page = {...page}
  if (input.css === null) delete next.css
  else if (typeof input.css === 'string' && input.css.trim()) {
    const checked = sanitizeCss(input.css)
    if (!checked.ok) throw new WorkspaceError(`页面样式没通过检查：${checked.reason}`)
    next.css = checked.css
  }
  if (input.align !== undefined) {
    if (input.align !== 'start' && input.align !== 'center') throw new WorkspaceError('align 只能是 start 或 center')
    next.align = input.align
  }
  return replacePage(workspace, next)
}

export function movePage(workspace: Workspace, pageId: string, toIndex: number): Workspace {
  const from = workspace.pages.findIndex((page) => page.id === pageId)
  if (from < 0) findPage(workspace, pageId)
  if (pageId === FROZEN_PAGE_ID) throw new WorkspaceError('首页是固定项，始终排第一。')
  // 首页固定在最前，其他页面最靠前也只能排第二
  const floor = workspace.pages[0]?.id === FROZEN_PAGE_ID ? 1 : 0
  const to = Math.max(floor, Math.min(workspace.pages.length - 1, Math.trunc(toIndex)))
  const pages = [...workspace.pages]
  const [moved] = pages.splice(from, 1)
  pages.splice(to, 0, moved)
  return {...workspace, pages}
}

/**
 * 整体设置状态条。每项必须是声明了 status 形态的组件；配置经组件自己的 schema 规整。
 */
export function setStatusbar(workspace: Workspace, raw: unknown): Workspace {
  if (!Array.isArray(raw)) throw new WorkspaceError('items 必须是数组')
  if (raw.length + listApplications(workspace).filter((application) => application.status).length > MAX_STATUS_ITEMS) throw new WorkspaceError(`状态条最多 ${MAX_STATUS_ITEMS} 项（包含应用入口）`)
  const items: StatusItem[] = raw.map((entry, index) => {
    const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const type = typeof value.type === 'string' ? value.type : ''
    const definition = getDefinition(type as ComponentType)
    if (!definition) throw new WorkspaceError(`第 ${index + 1} 项：没有这个组件类型「${type}」`)
    if (!typeAvailable(workspace, type)) throw new WorkspaceError(notInstalled(type))
    if (!definition.status) {
      const ok = listStatusTypes(workspace).map((d) => `${d.type}（${d.name}）`).join('、')
      throw new WorkspaceError(`「${definition.name}」没有状态条形态，不能放进状态条。可放的有：${ok}`)
    }
    const id = typeof value.id === 'string' && value.id ? value.id : instanceId(`status-${type}`)
    return {id, type: type as ComponentType, config: normalizeConfig(definition, value.config)}
  })
  return {...workspace, statusbar: items}
}

/**
 * 设置 Dock 的样式：选预设，和 / 或 换上一份完整的自定义 CSS。
 *   - preset 不填：沿用现在的预设
 *   - css 不填：沿用现在的自定义样式；传空字符串：清掉，回到预设本身的样子
 *   - reset：整个回到默认的玻璃 Dock
 */
export function setDock(workspace: Workspace, patch: {preset?: string; css?: string; reset?: boolean}): Workspace {
  const {dock: _old, ...rest} = workspace
  void _old
  if (patch.reset) return rest
  const now = workspace.dock ?? {preset: DEFAULT_DOCK_PRESET}
  let preset = now.preset
  if (patch.preset !== undefined) {
    if (!isDockPreset(patch.preset)) throw new WorkspaceError(`没有这个预设「${patch.preset}」。可选：${DOCK_PRESETS.map((item) => `${item.id}（${item.name}）`).join('、')}`)
    preset = patch.preset
  }
  let css = now.css
  if (patch.css !== undefined) {
    if (!patch.css.trim()) css = undefined
    else {
      const checked = scopeDockCss(patch.css)
      if (!checked.ok) throw new WorkspaceError(checked.reason)
      css = patch.css.trim()
    }
  }
  if (preset === DEFAULT_DOCK_PRESET && !css) return rest
  return {...rest, dock: {preset, ...(css ? {css} : {})}}
}

/** 声明了状态条形态的组件。 */
export function listStatusTypes(workspace?: Workspace) {
  return listDefinitions().filter((definition) => definition.status && (!workspace || typeAvailable(workspace, definition.type)))
}

function notInstalled(type: string): string {
  const addon = addonOfType(type)
  return addon ? `「${addon.name}」来自组件市场，还没安装。先用 install_addon 安装（id：${addon.id}），再来用它。` : `组件 ${type} 不可用`
}

/** 安装一个市场组件：登记为已安装，需要页面的话顺手建好。 */
export function installAddon(workspace: Workspace, id: string): {workspace: Workspace; addon: (typeof ADDONS)[number]} {
  const addon = getAddon(id)
  if (!addon) throw new WorkspaceError(`市场里没有「${id}」。现有：${ADDONS.map((item) => `${item.id}（${item.name}）`).join('、')}`)
  if (isInstalled(workspace, id)) throw new WorkspaceError(`「${addon.name}」已经安装过了。`)
  let next: Workspace = {...workspace, addons: [...workspace.addons, id]}
  if (addon.page && !next.pages.some((page) => page.id === addon.page!.id)) {
    if (next.pages.length >= MAX_PAGES) throw new WorkspaceError(`页面太多了，最多 ${MAX_PAGES} 页，先删掉不用的再装。`)
    const spec = addon.page
    const components: ComponentInstance[] = spec.components.map((item) => {
      const definition = getDefinition(item.type)!
      return {id: instanceId(item.type), type: item.type, config: normalizeConfig(definition, item.config), span: item.span ?? definition.defaultSpan}
    })
    const page: Page = {id: spec.id, name: spec.name, label: spec.label, icon: spec.icon, components}
    assertFxBudgetChange(undefined, page)
    next = {...next, pages: [...next.pages, page]}
  }
  return {workspace: next, addon}
}

/**
 * 卸载：页面和状态条上这个组件的实例都会移除；它建的页面空了就一并删掉。
 * 组件自己存的数据（待办、便签…）留在本机，重装不会找回旧实例，但也不会误删。
 */
export function uninstallAddon(workspace: Workspace, id: string): {workspace: Workspace; addon: (typeof ADDONS)[number]} {
  const addon = getAddon(id)
  if (!addon) throw new WorkspaceError(`市场里没有「${id}」`)
  if (!isInstalled(workspace, id)) throw new WorkspaceError(`「${addon.name}」没有安装。`)
  const owned = new Set<string>(addon.types)
  const pages = workspace.pages
    .map((page) => normalizePageSections({...page, components: page.components.filter((item) => !owned.has(item.type))}))
    .filter((page) => !(page.id === addon.page?.id && page.components.length === 0))
  return {
    workspace: {
      ...workspace,
      addons: workspace.addons.filter((item) => item !== id),
      pages,
      statusbar: workspace.statusbar.filter((item) => !owned.has(item.type)),
    },
    addon,
  }
}


export function addComponent(
  workspace: Workspace,
  input: {pageId: string; type: string; config?: unknown; span?: string; title?: string; index?: number},
): {workspace: Workspace; instance: ComponentInstance} {
  const page = findPage(workspace, input.pageId)
  // 内置组件来自注册表，自定义组件来自工作空间自身
  const custom = isCustomType(input.type) ? workspace.widgets.find((w) => `custom:${w.id}` === input.type) : undefined
  const definition = getDefinition(input.type as ComponentType)
  if (definition && !typeAvailable(workspace, input.type)) throw new WorkspaceError(notInstalled(input.type))
  if (!custom && !definition) throw new WorkspaceError(`没有这种组件：${input.type}。先用 create_widget 建一个，或用 list_component_types 看有哪些。`)
  const single = definition ? !definition.multiple : false
  if (single && workspace.pages.some((p) => p.components.some((c) => c.type === input.type))) {
    throw new WorkspaceError(`「${definition!.name}」只能放一个，已经存在了`)
  }
  if (page.components.length >= 24) throw new WorkspaceError('这一页组件太多了，最多 24 个')
  const fallbackSpan = definition?.defaultSpan ?? 'half'
  const span = SPANS.includes(input.span as ComponentSpan) ? (input.span as ComponentSpan) : fallbackSpan
  const instance: ComponentInstance = {
    id: instanceId(input.type),
    type: input.type as ComponentInstance['type'],
    // 自定义组件没有配置字段，config 保持为空
    config: definition ? normalizeConfig(definition, input.config) : {},
    span,
    ...(input.title?.trim() ? {title: input.title.trim().slice(0, 24)} : {}),
  }
  const next = replacePage(workspace, insertPageComponent(page, instance, input.index))
  if (isApplicationType(instance.type)) {
    if (listApplications(workspace).length >= MAX_APPLICATIONS) throw new WorkspaceError(`应用最多安装 ${MAX_APPLICATIONS} 个`)
    return {workspace: {...next, applications: readApplications(listApplications(workspace), next.pages)}, instance}
  }
  return {workspace: next, instance}
}

export function updateComponent(
  workspace: Workspace,
  ref: string,
  patch: {config?: unknown; span?: string; title?: string | null; look?: unknown},
  pageId?: string,
): {workspace: Workspace; instance: ComponentInstance} {
  const {page, instance} = locate(workspace, ref, pageId)
  const definition = getDefinition(instance.type)
  const exists = definition || (isCustomType(instance.type) && workspace.widgets.some((w) => `custom:${w.id}` === instance.type))
  if (!exists) throw new WorkspaceError(`组件类型已失效：${instance.type}`)
  const next: ComponentInstance = {...instance}
  if (patch.config !== undefined && definition) {
    const incoming = patch.config && typeof patch.config === 'object' ? (patch.config as Record<string, unknown>) : {}
    const merged: Record<string, unknown> = {...instance.config, ...incoming}
    // json 字段按键浅合并：AI 只改一个参数时，不应把其余参数冲掉
    for (const [key, field] of Object.entries(definition.configSchema)) {
      const before = instance.config[key]
      const after = incoming[key]
      if (field.kind === 'json' && before && after && typeof before === 'object' && typeof after === 'object') {
        merged[key] = {...(before as object), ...(after as object)}
      }
    }
    next.config = normalizeConfig(definition, merged)
  }
  if (patch.look !== undefined) {
    const look = normalizeLook(patch.look)
    if (Object.keys(look).length) next.look = {...instance.look, ...look}
    else delete next.look
  }
  if (patch.span !== undefined) {
    if (!SPANS.includes(patch.span as ComponentSpan)) throw new WorkspaceError(`不支持的宽度：${patch.span}，可选 ${SPANS.join('/')}`)
    next.span = patch.span as ComponentSpan
  }
  if (patch.title !== undefined) {
    if (patch.title === null || !patch.title.trim()) delete next.title
    else next.title = patch.title.trim().slice(0, 24)
  }
  let updated = replacePage(workspace, {...page, components: page.components.map((item) => (item.id === instance.id ? next : item))})
  if (isApplicationType(instance.type)) {
    updated = updateApplication({...updated, applications: listApplications(workspace)}, instance.id, {
      config: next.config, ...(next.title ? {title: next.title} : {}), ...(next.span ? {span: next.span} : {}),
    }).workspace
  }
  return {workspace: updated, instance: next}
}

export function removeComponent(workspace: Workspace, ref: string, pageId?: string): {workspace: Workspace; removed: ComponentInstance} {
  const {page, instance} = locate(workspace, ref, pageId)
  return {
    workspace: replacePage(isApplicationType(instance.type) ? {...workspace, applications: listApplications(workspace)} : workspace, {...page, components: page.components.filter((item) => item.id !== instance.id)}),
    removed: instance,
  }
}

/** 在页内改顺序，或移到另一个页面。 */
export function moveComponent(
  workspace: Workspace,
  ref: string,
  input: {toPageId?: string; toIndex?: number},
  pageId?: string,
): Workspace {
  const {page: from, instance} = locate(workspace, ref, pageId)
  const target = input.toPageId ? findPage(workspace, input.toPageId) : from
  if (target.id === from.id) return replacePage(workspace, insertPageComponent(from, instance, input.toIndex))
  const removed = {...from, components: from.components.filter((item) => item.id !== instance.id)}
  return replacePage(replacePage(workspace, removed), insertPageComponent(target, instance, input.toIndex))
}

/** 设置页面壁纸。custom 只接受 http(s) 图片地址，防止 javascript: 之类的 URL 进入 CSS。 */
const VARIANTS = ['plain', 'card', 'accent', 'quiet'] as const
const TONES = ['neutral', 'main', 'green', 'blue', 'amber', 'violet'] as const
const TITLE_SIZES = ['sm', 'md', 'lg'] as const

/**
 * 外观覆盖：只接受声明过的取值。
 * 非法 CSS 会抛出可读错误——写错了要让 AI 知道，不能悄悄丢掉装作成功。
 */
function normalizeLook(raw: unknown): Appearance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const look: Appearance = {}
  if (typeof value.variant === 'string' && VARIANTS.includes(value.variant as never)) look.variant = value.variant as Appearance['variant']
  if (typeof value.tone === 'string' && TONES.includes(value.tone as never)) look.tone = value.tone as Appearance['tone']
  if (typeof value.titleSize === 'string' && TITLE_SIZES.includes(value.titleSize as never)) look.titleSize = value.titleSize as Appearance['titleSize']
  if (typeof value.animation === 'string' && ANIMATIONS.includes(value.animation as never)) look.animation = value.animation
  if (typeof value.css === 'string' && value.css.trim()) {
    const checked = sanitizeCss(value.css)
    if (!checked.ok) throw new WorkspaceError(`样式没通过检查：${checked.reason}`)
    look.css = checked.css
  }
  return look
}

/** 创建一个自定义组件。规格经 normalizeWidget 校验后才写入。 */
export function createWidget(workspace: Workspace, raw: unknown): {workspace: Workspace; widget: CustomWidget} {
  if (workspace.widgets.length >= 20) throw new WorkspaceError('自定义组件太多了，最多 20 个')
  const base = `w${(workspace.widgets.length + 1).toString(36)}${Date.now().toString(36).slice(-3)}`
  const checked = normalizeWidget(raw, base)
  if (!checked.ok) throw new WorkspaceError(checked.reason)
  let id = base
  for (let n = 2; workspace.widgets.some((w) => w.id === id); n += 1) id = `${base}${n}`
  const widget = {...checked.widget, id}
  return {workspace: {...workspace, widgets: [...workspace.widgets, widget]}, widget}
}

/** 改一个自定义组件的规格；id 不变，引用它的实例自动跟着变。 */
export function updateWidget(workspace: Workspace, id: string, raw: unknown): {workspace: Workspace; widget: CustomWidget} {
  const current = workspace.widgets.find((w) => w.id === id)
  if (!current) throw new WorkspaceError(`没有这个自定义组件：${id}`)
  const checked = normalizeWidget(raw, id)
  if (!checked.ok) throw new WorkspaceError(checked.reason)
  return {workspace: {...workspace, widgets: workspace.widgets.map((w) => (w.id === id ? checked.widget : w))}, widget: checked.widget}
}

/** 删一个自定义组件，连同引用它的实例。 */
export function removeWidget(workspace: Workspace, id: string): {workspace: Workspace; removed: CustomWidget; instances: string[]} {
  const widget = workspace.widgets.find((w) => w.id === id)
  if (!widget) throw new WorkspaceError(`没有这个自定义组件：${id}`)
  const type = `custom:${id}`
  const instances: string[] = []
  const pages = workspace.pages.map((page) => {
    const kept = page.components.filter((c) => {
      if (c.type !== type) return true
      instances.push(c.id)
      return false
    })
    return kept.length === page.components.length ? page : normalizePageSections({...page, components: kept})
  })
  return {workspace: {...workspace, pages, widgets: workspace.widgets.filter((w) => w.id !== id)}, removed: widget, instances}
}

/** 授权一个域名。 */export function grantHost(workspace: Workspace, host: string): Workspace {
  const normalized = normalizeHost(host)
  if (!normalized) throw new WorkspaceError(`域名不合法：${host}`)
  if (workspace.network.some((grant) => grant.host === normalized)) return workspace
  return {...workspace, network: [...workspace.network, {host: normalized, grantedAt: Date.now()}]}
}

/** 撤销一个域名的授权。 */
export function revokeHost(workspace: Workspace, host: string): Workspace {
  return {...workspace, network: workspace.network.filter((grant) => grant.host !== host)}
}

export function setWallpaper(
  workspace: Workspace,
  pageId: string,
  input: {mode: string; index?: number; url?: string},
): Workspace {
  const page = findPage(workspace, pageId)
  let wallpaper: Wallpaper
  if (input.mode === 'off') wallpaper = {mode: 'off'}
  else if (input.mode === 'unsplash') wallpaper = {mode: 'unsplash', index: Math.max(0, Math.trunc(input.index ?? 0))}
  else if (input.mode === 'custom') {
    const url = (input.url ?? '').trim()
    if (!/^https?:\/\/[^\s"'()<>\\]+$/i.test(url)) throw new WorkspaceError('自定义壁纸需要 http(s) 图片地址，且不能含空格、引号或括号')
    wallpaper = {mode: 'custom', url}
  } else throw new WorkspaceError(`壁纸模式只能是 off / unsplash / custom，收到：${input.mode}`)
  return replacePage(workspace, {...page, wallpaper})
}

/** 整体替换一页的特效图层（最多 3 层）。传空数组即清空。 */
export function setLayers(workspace: Workspace, pageId: string, layers: unknown[]): Workspace {
  const page = findPage(workspace, pageId)
  if (!Array.isArray(layers)) throw new WorkspaceError('layers 必须是数组')
  if (layers.length > 3) throw new WorkspaceError('一页最多叠 3 层特效')
  const next = layers.map((layer) => normalizeLayer(layer))
  const rest = {...page}
  if (next.length) rest.layers = next
  else delete rest.layers
  return replacePage(workspace, rest)
}

/** 改当前主题（明暗、变量）。当前是默认主题时会先另存为新主题，默认主题不会被改坏。 */
export function setTheme(workspace: Workspace, input: {mode?: string; overrides?: Record<string, unknown> | null; light?: Record<string, unknown> | null; dark?: Record<string, unknown> | null; fonts?: unknown}) {
  return tweakTheme(workspace, input)
}

export {applyTheme, removeTheme, saveTheme, setMode} from './themes'
export {applyTemplate, removeTemplate, renameTemplate, saveTemplate} from './templates'

/** 一份完整的默认工作空间，也是「重置」的目标。 */
export function defaultWorkspace(): Workspace {
  const make = (type: ComponentType, config?: Record<string, unknown>, span?: ComponentSpan, title?: string): ComponentInstance => {
    const definition = getDefinition(type)
    return {
      id: instanceId(type),
      type,
      config: normalizeConfig(definition!, config),
      span: span ?? definition!.defaultSpan,
      ...(title ? {title} : {}),
    }
  }
  return {
    version: WORKSPACE_VERSION,
    theme: {active: DEFAULT_APPEARANCE_THEME.id, mode: 'light', base: 'light'},
    themes: [DEFAULT_THEME, IOS_THEME, PIXEL_THEME, SWITCH_THEME, WIN98_THEME],
    layout: {...DEFAULT_LAYOUT},
    widgets: [],
    applications: [],
    network: [],
    // 状态条默认只放一个时钟；天气、监控等想看的，让搭搭放上来
    statusbar: [{id: instanceId('status-clock'), type: 'clock', config: normalizeConfig(getDefinition('clock')!, {showSeconds: true})}],
    // 热榜、订阅、书桌、书签、监控都在组件市场里，默认一个都不装
    addons: [],
    templates: [],
    pages: [
      {
        id: 'home',
        name: '首页',
        label: '首页',
        icon: 'home',
        // 默认不铺照片，沿用当前主题底色。想要壁纸，对搭搭说一声即可。
        align: 'center',
        // 一层很淡的波纹线做装饰，不抢时钟和搜索框；在设置 › 外观里可换可关
        layers: DEFAULT_HOME_LAYERS.map((layer) => ({...layer, params: {...layer.params}})),
        components: [
          // 首页像一个搜索页：时钟（含一行天气）+ 搜索/对话框 + 一排常用网站。
          // 其他功能在组件市场里，装了再说。
          make('clock'),
          make('search'),
          make('links'),
        ],
      },
    ],
  }
}
