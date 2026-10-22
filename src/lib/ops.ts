import {getDefinition, normalizeConfig} from './registry'
import {
  DEFAULT_LAYOUT,
  WORKSPACE_VERSION,
  instanceId,
  type ComponentInstance,
  type ComponentSpan,
  type ComponentType,
  type Page,
  type Wallpaper,
  type Workspace,
} from './workspace'

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
  const definition = getDefinition(input.type as ComponentType)
  if (!definition) throw new WorkspaceError(`没有这种组件：${input.type}`)
  if (!definition.multiple && workspace.pages.some((p) => p.components.some((c) => c.type === definition.type))) {
    throw new WorkspaceError(`「${definition.name}」只能放一个，已经存在了`)
  }
  if (page.components.length >= 24) throw new WorkspaceError('这一页组件太多了，最多 24 个')
  const span = SPANS.includes(input.span as ComponentSpan) ? (input.span as ComponentSpan) : definition.defaultSpan
  const instance: ComponentInstance = {
    id: instanceId(definition.type),
    type: definition.type,
    config: normalizeConfig(definition, input.config),
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
  patch: {config?: unknown; span?: string; title?: string | null},
  pageId?: string,
): {workspace: Workspace; instance: ComponentInstance} {
  const {page, instance} = locate(workspace, ref, pageId)
  const definition = getDefinition(instance.type)
  if (!definition) throw new WorkspaceError(`组件类型已失效：${instance.type}`)
  const next: ComponentInstance = {...instance}
  if (patch.config !== undefined) next.config = normalizeConfig(definition, {...instance.config, ...(patch.config as object)})
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
