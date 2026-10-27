import {WorkspaceError} from './errors'
import {getDefinition, normalizeConfig} from './registry'
import {insertPageComponent, normalizePageSections} from './pageSections'
import {MAX_APPLICATIONS, MAX_STATUS_ITEMS, instanceId, type ApplicationOpenMode, type ApplicationSettingField, type ApplicationStatusMode, type ApplicationSurface, type ComponentInstance, type ComponentSpan, type GeneratedApplication, type Page, type Workspace} from './workspace'

const SPANS = ['full', 'half', 'third', 'two-thirds'] as const
const MODES = ['modal', 'drawer', 'page'] as const
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const isApplicationType = (type: string): type is 'app' | 'applet' => type === 'app' || type === 'applet'

function cleanSchema(raw: unknown): Record<string, ApplicationSettingField> {
  const source = record(raw)
  if (!source) throw new WorkspaceError('settingsSchema 必须是设置字段对象')
  if (Object.keys(source).length > 24) throw new WorkspaceError('应用设置最多 24 项')
  const fields: Record<string, ApplicationSettingField> = {}
  for (const [key, value] of Object.entries(source)) {
    const field = record(value)
    if (!KEY.test(key) || ['constructor', 'prototype', '__proto__'].includes(key)) throw new WorkspaceError(`设置键不合法：${key}`)
    if (!field || !['string', 'number', 'boolean', 'select'].includes(String(field.kind))) throw new WorkspaceError(`设置 ${key} 的 kind 不合法`)
    if (typeof field.label !== 'string' || !field.label.trim()) throw new WorkspaceError(`设置 ${key} 需要 label`)
    const next: ApplicationSettingField = {kind: field.kind as ApplicationSettingField['kind'], label: field.label.trim().slice(0, 40)}
    if (typeof field.description === 'string') next.description = field.description.slice(0, 200)
    if (next.kind === 'number') {
      if (typeof field.min === 'number' && Number.isFinite(field.min)) next.min = field.min
      if (typeof field.max === 'number' && Number.isFinite(field.max)) next.max = field.max
      if (next.min !== undefined && next.max !== undefined && next.min > next.max) throw new WorkspaceError(`设置 ${key} 的 min 不能大于 max`)
    }
    if (next.kind === 'select') {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 40) throw new WorkspaceError(`设置 ${key} 需要 1～40 个 options`)
      const seen = new Set<string>()
      next.options = field.options.map((option) => {
        const item = record(option)
        if (!item || typeof item.value !== 'string' || typeof item.label !== 'string' || !item.value || seen.has(item.value)) throw new WorkspaceError(`设置 ${key} 的选项不合法或重复`)
        seen.add(item.value)
        return {value: item.value.slice(0, 120), label: item.label.slice(0, 40)}
      })
    }
    if (field.default !== undefined) next.default = settingValue(key, next, field.default)
    fields[key] = next
  }
  return fields
}

function settingValue(key: string, field: ApplicationSettingField, raw: unknown): string | number | boolean {
  if (field.kind === 'boolean' && typeof raw === 'boolean') return raw
  if (field.kind === 'number' && typeof raw === 'number' && Number.isFinite(raw)) return Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, raw))
  if (field.kind === 'string' && typeof raw === 'string') return raw.slice(0, 2000)
  if (field.kind === 'select' && typeof raw === 'string' && field.options?.some((item) => item.value === raw)) return raw
  throw new WorkspaceError(`设置 ${key} 的值不符合 ${field.kind} 类型`)
}

function cleanSettings(schema: Record<string, ApplicationSettingField>, raw: unknown, strict = true): Record<string, string | number | boolean> {
  const source = raw === undefined ? {} : record(raw)
  if (!source) throw new WorkspaceError('settings 必须是设置值对象')
  if (strict) for (const key of Object.keys(source)) if (!(key in schema)) throw new WorkspaceError(`没有这个应用设置：${key}`)
  const values: Record<string, string | number | boolean> = {}
  for (const [key, field] of Object.entries(schema)) {
    if (source[key] !== undefined) {
      try { values[key] = settingValue(key, field, source[key]) } catch (error) { if (strict) throw error }
    }
    if (values[key] === undefined && field.default !== undefined) values[key] = field.default
  }
  return values
}

function applicationConfig(type: 'app' | 'applet', raw: unknown): Record<string, unknown> {
  const definition = getDefinition(type)
  if (!definition) throw new WorkspaceError(`应用运行器 ${type} 尚未注册`)
  const input = record(raw)
  if (raw !== undefined && !input) throw new WorkspaceError('应用 config 必须是对象')
  // settings/surface 是宿主按本次展示注入的，不保存进源码配置。
  const {settings: _settings, surface: _surface, ...config} = input ?? {}
  const {settings: _normalizedSettings, surface: _normalizedSurface, ...normalized} = normalizeConfig(definition, config)
  return normalized
}

/** 导入时严格规整目录，旧页面中的应用按原 id 纳入；坏记录不会让整个工作空间失效。 */
export function readApplications(raw: unknown, pages: Page[]): GeneratedApplication[] {
  const out: GeneratedApplication[] = []
  for (const value of Array.isArray(raw) ? raw.slice(0, MAX_APPLICATIONS) : []) {
    const item = record(value)
    const instance = record(item?.instance)
    if (!item || typeof item.id !== 'string' || !item.id || !instance || !isApplicationType(String(instance.type)) || out.some((entry) => entry.id === item.id)) continue
    try {
      const settingsSchema = item.settingsSchema === undefined ? {} : cleanSchema(item.settingsSchema)
      const settings = cleanSettings(settingsSchema, item.settings, false)
      const type = instance.type as 'app' | 'applet'
      out.push({
        id: item.id,
        instance: {id: item.id, type, title: typeof instance.title === 'string' ? instance.title.slice(0, 24) : type === 'applet' ? '小程序' : '应用', config: applicationConfig(type, instance.config), ...(SPANS.includes(instance.span as ComponentSpan) ? {span: instance.span as ComponentSpan} : {})},
        description: typeof item.description === 'string' ? item.description.slice(0, 200) : '',
        group: typeof item.group === 'string' ? item.group.trim().slice(0, 24) : '',
        openMode: MODES.includes(item.openMode as ApplicationOpenMode) ? item.openMode as ApplicationOpenMode : 'modal',
        dock: item.dock === true, status: item.status === true,
        statusMode: item.statusMode === 'compact' ? 'compact' : 'launcher',
        ...(Object.keys(settingsSchema).length ? {settingsSchema} : {}),
        ...(Object.keys(settings).length ? {settings} : {}),
      })
    } catch { /* 无效安装记录由已有页面内容兜底，不执行其源码。 */ }
  }
  for (const page of pages) for (const instance of page.components) {
    if (!isApplicationType(instance.type) || out.some((entry) => entry.id === instance.id) || out.length >= MAX_APPLICATIONS) continue
    try {
      out.push({id: instance.id, instance: {...instance, config: applicationConfig(instance.type, instance.config)}, description: '', group: '', openMode: 'modal', dock: false, status: false, statusMode: 'launcher'})
    } catch { /* 已失效的运行器不纳入应用目录。 */ }
  }
  return out
}

export function listApplications(workspace: Workspace): GeneratedApplication[] {
  return workspace.applications ?? readApplications(undefined, workspace.pages)
}

export function findApplication(workspace: Workspace, ref: string): GeneratedApplication {
  const list = listApplications(workspace)
  const exact = list.find((item) => item.id === ref)
  if (exact) return exact
  const needle = ref.trim().toLowerCase()
  const named = list.filter((item) => item.instance.title?.toLowerCase() === needle)
  if (named.length === 1) return named[0]
  if (named.length > 1) throw new WorkspaceError(`「${ref}」对应多个应用，请用 id：${named.map((item) => item.id).join('、')}`)
  throw new WorkspaceError(`找不到应用：${ref}`)
}

export type ApplicationPatch = {
  title?: string; name?: string; description?: string; group?: string; openMode?: string; dock?: boolean; status?: boolean; statusMode?: string
  settingsSchema?: unknown; settings?: unknown; config?: unknown; span?: string
}

function patchApplication(application: GeneratedApplication, patch: ApplicationPatch): GeneratedApplication {
  const next: GeneratedApplication = {...application, instance: {...application.instance}}
  const title = patch.name ?? patch.title
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) throw new WorkspaceError('应用名称不能为空')
    next.instance.title = title.trim().slice(0, 24)
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== 'string') throw new WorkspaceError('description 必须是文字')
    next.description = patch.description.trim().slice(0, 200)
  }
  if (patch.group !== undefined) {
    if (typeof patch.group !== 'string') throw new WorkspaceError('group 必须是文字')
    next.group = patch.group.trim().slice(0, 24)
  }
  if (patch.openMode !== undefined) {
    if (!MODES.includes(patch.openMode as ApplicationOpenMode)) throw new WorkspaceError('openMode 只能是 modal、drawer 或 page')
    next.openMode = patch.openMode as ApplicationOpenMode
  }
  for (const field of ['dock', 'status'] as const) if (patch[field] !== undefined) {
    if (typeof patch[field] !== 'boolean') throw new WorkspaceError(`${field} 必须是布尔值`)
    next[field] = patch[field]
  }
  if (patch.statusMode !== undefined) {
    if (patch.statusMode !== 'launcher' && patch.statusMode !== 'compact') throw new WorkspaceError('statusMode 只能是 launcher 或 compact')
    next.statusMode = patch.statusMode as ApplicationStatusMode
  }
  if (patch.span !== undefined) {
    if (!SPANS.includes(patch.span as ComponentSpan)) throw new WorkspaceError('应用宽度只能是 full、half、third 或 two-thirds')
    next.instance.span = patch.span as ComponentSpan
  }
  if (patch.config !== undefined) {
    const config = record(patch.config)
    if (!config) throw new WorkspaceError('应用 config 必须是对象')
    next.instance.config = applicationConfig(application.instance.type as 'app' | 'applet', {...application.instance.config, ...config})
  }
  if (patch.settingsSchema !== undefined || patch.settings !== undefined) {
    const schema = patch.settingsSchema === undefined ? application.settingsSchema ?? {} : cleanSchema(patch.settingsSchema)
    const incoming = patch.settings === undefined ? {} : record(patch.settings)
    if (!incoming) throw new WorkspaceError('settings 必须是设置值对象')
    const previous = cleanSettings(schema, application.settings, false)
    const values = cleanSettings(schema, {...previous, ...incoming})
    if (Object.keys(schema).length) next.settingsSchema = schema
    else delete next.settingsSchema
    if (Object.keys(values).length) next.settings = values
    else delete next.settings
  }
  return next
}

function putApplication(workspace: Workspace, application: GeneratedApplication): Workspace {
  const applications = listApplications(workspace).map((item) => item.id === application.id ? application : item)
  const previous = listApplications(workspace).find((item) => item.id === application.id)
  if (application.status && !previous?.status && applications.filter((item) => item.status).length + workspace.statusbar.length > MAX_STATUS_ITEMS) throw new WorkspaceError(`状态栏最多 ${MAX_STATUS_ITEMS} 项，请先关闭一个入口`)
  return {
    ...workspace, applications,
    pages: workspace.pages.map((page) => ({...page, components: page.components.map((item) => item.id === application.id ? {...item, type: application.instance.type, title: application.instance.title, config: application.instance.config} : item)})),
  }
}

export function createApplication(workspace: Workspace, input: ApplicationPatch & {type: string}): {workspace: Workspace; application: GeneratedApplication} {
  if (!isApplicationType(input.type)) throw new WorkspaceError('应用 type 只能是 app 或 applet')
  const applications = listApplications(workspace)
  if (applications.length >= MAX_APPLICATIONS) throw new WorkspaceError(`应用最多安装 ${MAX_APPLICATIONS} 个`)
  const id = instanceId(input.type)
  const application = patchApplication({id, instance: {id, type: input.type, config: applicationConfig(input.type, input.config), title: input.type === 'applet' ? '小程序' : '应用', span: 'half'}, description: '', group: '', openMode: 'modal', dock: false, status: false, statusMode: 'launcher'}, input)
  const base = {...workspace, applications: [...applications, application]}
  if (application.status && applications.filter((item) => item.status).length + workspace.statusbar.length >= MAX_STATUS_ITEMS) throw new WorkspaceError(`状态栏最多 ${MAX_STATUS_ITEMS} 项，请先关闭一个入口`)
  return {workspace: base, application}
}

export function updateApplication(workspace: Workspace, ref: string, patch: ApplicationPatch): {workspace: Workspace; application: GeneratedApplication} {
  const application = patchApplication(findApplication(workspace, ref), patch)
  return {workspace: putApplication(workspace, application), application}
}

export function configureApplication(workspace: Workspace, ref: string, patch: ApplicationPatch): Workspace {
  return updateApplication(workspace, ref, patch).workspace
}

/** 卸载移除所有入口和页面挂载；不接触应用的本地私有数据，撤销可完整找回。 */
export function removeApplication(workspace: Workspace, ref: string): Workspace {
  const application = findApplication(workspace, ref)
  return {...workspace, applications: listApplications(workspace).filter((item) => item.id !== application.id), pages: workspace.pages.map((page) => normalizePageSections({...page, components: page.components.filter((item) => item.id !== application.id)}))}
}

/** 一个应用只挂载一个页面实例，避免多份逻辑同时改同一份私有数据。 */
export function mountApplication(workspace: Workspace, ref: string, pageId: string | null, span?: string): Workspace {
  const application = findApplication(workspace, ref)
  const page = pageId === null ? undefined : workspace.pages.find((item) => item.id === pageId)
  if (pageId !== null && !page) throw new WorkspaceError(`找不到页面：${pageId}`)
  if (span !== undefined && !SPANS.includes(span as ComponentSpan)) throw new WorkspaceError('应用宽度不合法')
  if (page && page.components.filter((item) => item.id !== application.id).length >= 24) throw new WorkspaceError('这一页组件太多了，最多 24 个')
  const placed = workspace.pages.flatMap((item) => item.components).find((item) => item.id === application.id)
  const instance = {...application.instance, ...(placed ? {span: placed.span, ...(placed.look ? {look: placed.look} : {})} : {}), ...(span ? {span: span as ComponentSpan} : {})}
  return {...workspace, applications: listApplications(workspace), pages: workspace.pages.map((item) => {
    const contains = item.components.some((child) => child.id === application.id)
    // 已在本页时保留位置和槽位，只同步 canonical 内容与显式宽度。
    if (item.id === pageId) return contains
      ? {...item, components: item.components.map((child) => child.id === application.id ? instance : child)}
      : insertPageComponent(item, instance)
    return contains ? normalizePageSections({...item, components: item.components.filter((child) => child.id !== application.id)}) : item
  })}
}

/** 每种展示复用 canonical id/config，设置只在渲染时注入。 */
export function applicationInstance(workspace: Workspace, ref: string, surface: ApplicationSurface): ComponentInstance {
  const application = findApplication(workspace, ref)
  return {...application.instance, config: {...application.instance.config, settings: clone(application.settings ?? {}), surface}}
}
