import {getDefinition, normalizeConfig} from './registry'
import {
  DEFAULT_LAYOUT,
  WORKSPACE_VERSION,
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

/**
 * 工作空间的全部编辑操作。
 *
 * 每个操作都是纯函数：(工作空间, 参数) → 新工作空间，失败则抛出带中文说明的错误。
 * 不读写存储、不碰 React —— 这样 AI 工具、界面按钮、撤销栈、预览
 * 都能共用同一份实现，行为不会各写各的。
 */

export class WorkspaceError extends Error {}

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
  return {...workspace, pages: workspace.pages.map((page) => (page.id === next.id ? next : page))}
}

export function addPage(workspace: Workspace, input: {name: string; label?: string; id?: string}): {workspace: Workspace; page: Page} {
  const name = input.name.trim()
  if (!name) throw new WorkspaceError('页面需要名称')
  if (workspace.pages.length >= 12) throw new WorkspaceError('页面太多了，最多 12 页')
  const base = (input.id ?? name).trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'page'
  let id = base
  for (let n = 2; workspace.pages.some((page) => page.id === id); n += 1) id = `${base}-${n}`
  const label = (input.label ?? name).trim().slice(0, 4) || name.slice(0, 4)
  const page: Page = {id, name, label, components: []}
  return {workspace: {...workspace, pages: [...workspace.pages, page]}, page}
}

export function renamePage(workspace: Workspace, pageId: string, input: {name?: string; label?: string}): Workspace {
  const page = findPage(workspace, pageId)
  const name = input.name?.trim() || page.name
  const label = input.label?.trim().slice(0, 4) || page.label
  return replacePage(workspace, {...page, name, label})
}

export function removePage(workspace: Workspace, pageId: string): Workspace {
  findPage(workspace, pageId)
  if (workspace.pages.length <= 1) throw new WorkspaceError('至少要保留一个页面')
  return {...workspace, pages: workspace.pages.filter((page) => page.id !== pageId)}
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
  const to = Math.max(0, Math.min(workspace.pages.length - 1, Math.trunc(toIndex)))
  const pages = [...workspace.pages]
  const [moved] = pages.splice(from, 1)
  pages.splice(to, 0, moved)
  return {...workspace, pages}
}

export function addComponent(
  workspace: Workspace,
  input: {pageId: string; type: string; config?: unknown; span?: string; title?: string; index?: number},
): {workspace: Workspace; instance: ComponentInstance} {
  const page = findPage(workspace, input.pageId)
  // 内置组件来自注册表，自定义组件来自工作空间自身
  const custom = isCustomType(input.type) ? workspace.widgets.find((w) => `custom:${w.id}` === input.type) : undefined
  const definition = getDefinition(input.type as ComponentType)
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
  const components = [...page.components]
  const at = input.index === undefined ? components.length : Math.max(0, Math.min(components.length, Math.trunc(input.index)))
  components.splice(at, 0, instance)
  return {workspace: replacePage(workspace, {...page, components}), instance}
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
  if (patch.config !== undefined && definition) next.config = normalizeConfig(definition, {...instance.config, ...(patch.config as object)})
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
  return {
    workspace: replacePage(workspace, {...page, components: page.components.map((item) => (item.id === instance.id ? next : item))}),
    instance: next,
  }
}

export function removeComponent(workspace: Workspace, ref: string, pageId?: string): {workspace: Workspace; removed: ComponentInstance} {
  const {page, instance} = locate(workspace, ref, pageId)
  return {
    workspace: replacePage(workspace, {...page, components: page.components.filter((item) => item.id !== instance.id)}),
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
  const removed = {...from, components: from.components.filter((item) => item.id !== instance.id)}
  const base = target.id === from.id ? removed : target
  const components = [...base.components]
  const at = input.toIndex === undefined ? components.length : Math.max(0, Math.min(components.length, Math.trunc(input.toIndex)))
  components.splice(at, 0, instance)
  if (target.id === from.id) return replacePage(workspace, {...removed, components})
  return replacePage(replacePage(workspace, removed), {...target, components})
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
    return kept.length === page.components.length ? page : {...page, components: kept}
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

export function setTheme(
  workspace: Workspace,
  input: {mode?: string; preset?: string; overrides?: Record<string, string> | null},
): Workspace {
  const theme = {...workspace.theme}
  if (input.mode !== undefined) {
    if (input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('主题模式只能是 light 或 dark')
    theme.mode = input.mode
  }
  if (input.preset !== undefined) theme.preset = input.preset
  if (input.overrides === null) theme.overrides = {}
  else if (input.overrides) {
    const next = {...theme.overrides}
    for (const [name, value] of Object.entries(input.overrides)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new WorkspaceError(`变量名不合法：${name}`)
      if (typeof value !== 'string' || value.length > 120 || /[;{}]/.test(value)) throw new WorkspaceError(`变量值不合法：${name}`)
      next[name] = value
    }
    theme.overrides = next
  }
  return {...workspace, theme}
}

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
    theme: {preset: 'paper', overrides: {}, mode: 'light'},
    layout: {...DEFAULT_LAYOUT},
    widgets: [],
    network: [],
    pages: [
      {
        id: 'home',
        name: '首页',
        label: '首页',
        wallpaper: {mode: 'unsplash', index: 0},
        components: [
          make('clock'),
          make('search'),
          make('weather', {}, 'third'),
          make('todos', {limit: 5}, 'third', '待办'),
          make('feeds', {limit: 5, compact: true}, 'third', '今日'),
        ],
      },
      {id: 'feeds', name: '订阅', label: '订阅', components: [make('feeds', {limit: 80})]},
      {id: 'desk', name: '书桌', label: '书桌', components: [make('todos', {}, 'half'), make('note', {}, 'half')]},
      {id: 'marks', name: '书签', label: '书签', components: [make('bookmarks')]},
      {id: 'hot', name: '热榜', label: '热榜', components: [make('hot')]},
    ],
  }
}
