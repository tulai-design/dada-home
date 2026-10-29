import {useCallback, useSyncExternalStore} from 'react'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'
import {defaultWorkspace} from './ops'
import {getDefinition, normalizeConfig} from './registry'
import {DEFAULT_THEME, DEFAULT_THEME_ID, FROZEN_PAGE_ID, MAX_STATUS_ITEMS, MAX_TEMPLATES, WORKSPACE_VERSION, type StatusItem, type TemplateEntry, type ThemeEntry, type ThemeConfig, type CustomWidget, type Layer, type Page, type Wallpaper, type Workspace} from './workspace'
import {normalizeWidget, sanitizeCss} from './customWidget'
import {normalizeLayer} from '../fx/catalog'
import {isPageIcon} from './pageIcons'
import {readDock} from './dock'
import {ADDONS} from './market'
import {cleanOverrides, readThemes} from './themes'
import {isApplicationType, readApplications} from './applications'
import {normalizePageSections} from './pageSections'

/** 旧数据里没有 icon 的页面，按 id 补回当初的图标，别全变成同一个。 */
const LEGACY_ICONS: Record<string, string> = {home: 'home', feeds: 'newspaper', desk: 'notebook-pen', marks: 'bookmark', hot: 'flame'}

/**
 * 工作空间 store。
 *
 * 职责：读写本地存储、版本迁移、撤销/重做、订阅变更。
 * 编辑逻辑不在这里（见 ops.ts）；这里只负责「把一个新的工作空间提交为当前状态」。
 */

const STORAGE_KEY = 'fp.workspace'
const HISTORY_LIMIT = 50

type Listener = () => void

let current: Workspace | null = null
let past: Workspace[] = []
let future: Workspace[] = []
const listeners = new Set<Listener>()
/** 订阅用的版本戳，每次状态变化自增，useSyncExternalStore 靠它判断是否要重渲。 */
let stamp = 0

function emit() {
  stamp += 1
  listeners.forEach((fn) => fn())
}

/**
 * 读到旧版本数据时在这里升级。
 * 按当前合同兜底；没有 sections 的旧页面保持原布局，坏引用在过滤组件后清理。
 */
export function migrate(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<Workspace>
  if (!Array.isArray(data.pages) || data.pages.length === 0) return null

  // 自定义组件必须先解析出来：过滤页面组件时要靠它判断 custom:* 是否仍然有效
  const widgets: CustomWidget[] = []
  for (const raw of Array.isArray(data.widgets) ? data.widgets : []) {
    if (!raw || typeof raw.id !== 'string') continue
    const checked = normalizeWidget(raw, raw.id)
    if (checked.ok) widgets.push(checked.widget)
  }
  const customTypes = new Set(widgets.map((w) => `custom:${w.id}`))

  const pages: Page[] = []
  for (const page of data.pages) {
    if (!page || typeof page.id !== 'string' || !Array.isArray(page.components)) continue
    pages.push(normalizePageSections({
      id: page.id,
      name: typeof page.name === 'string' ? page.name : page.id,
      label: typeof page.label === 'string' ? page.label : page.id,
      // 丢掉已失效的组件类型：内置的看注册表，自定义的看 widgets 列表
      components: page.components.filter(
        (item) => item && typeof item.id === 'string' && (getDefinition(item.type) || customTypes.has(item.type)),
      ),
      ...(page.sections !== undefined ? {sections: page.sections} : {}),
      ...(readWallpaper(page.wallpaper) ? { wallpaper: readWallpaper(page.wallpaper) } : {}),
      ...readPageStyle(page),
      ...readIcon(page),
      ...readLayers(page.layers),
      ...(typeof page.dock === 'boolean' ? {dock: page.dock} : !Array.isArray(data.applications) && page.id !== FROZEN_PAGE_ID && page.components.length > 0 && page.components.every((item) => item && isApplicationType(item.type)) ? {dock: false} : {}),
    }))
  }
  if (!pages.length) return null

  const fallback = defaultWorkspace()
  // 首页是固定项：丢了就补回最前面；不在最前就挪回去
  const homeAt = pages.findIndex((page) => page.id === FROZEN_PAGE_ID)
  if (homeAt < 0) pages.unshift(fallback.pages[0])
  else if (homeAt > 0) pages.unshift(...pages.splice(homeAt, 1))
  const theme = readThemeState(data)
  const statusbar = readStatusbar(data.statusbar, fallback.statusbar)
  let statusSlots = Math.max(0, MAX_STATUS_ITEMS - statusbar.length)
  const applications = readApplications(data.applications, pages).map((application) => application.status && statusSlots-- <= 0 ? {...application, status: false} : application)
  const canonical = new Map(applications.map((application) => [application.id, application.instance]))
  return {
    version: WORKSPACE_VERSION,
    pages: pages.map((page) => ({...page, components: page.components.map((item) => {
      const app = canonical.get(item.id)
      return app ? {...item, type: app.type, title: app.title, config: app.config} : item
    })})),
    applications,
    addons: readAddons((data as { addons?: unknown }).addons, pages, statusbar),
    theme: theme.config,
    themes: theme.themes,
    layout: {
      columns: Number.isFinite(data.layout?.columns) ? Number(data.layout!.columns) : fallback.layout.columns,
      maxWidth: Number.isFinite(data.layout?.maxWidth) ? Number(data.layout!.maxWidth) : fallback.layout.maxWidth,
    },
    widgets,
    network: Array.isArray(data.network) ? data.network.filter((g) => g && typeof g.host === 'string') : [],
    statusbar,
    ...(readDock((data as {dock?: unknown}).dock) ? {dock: readDock((data as {dock?: unknown}).dock)} : {}),
    templates: readTemplates((data as { templates?: unknown }).templates),
    ...(typeof (data as { template?: unknown }).template === 'string' ? { template: (data as { template: string }).template } : {}),
  }
}

/**
 * 读模板库。每个模板的快照照工作空间的规矩重新过一遍（丢掉失效组件、补默认值），
 * 所以导入来的、旧版本的、手改过的模板都不会把页面弄坏。
 */
export function readTemplates(raw: unknown): TemplateEntry[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateEntry[] = []
  for (const item of raw.slice(0, MAX_TEMPLATES)) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || out.some((entry) => entry.id === item.id)) continue
    const snap = item.snapshot as Partial<TemplateEntry['snapshot']> | undefined
    if (!snap) continue
    const checked = migrate({
      pages: snap.pages,
      widgets: snap.widgets,
      statusbar: snap.statusbar,
      addons: snap.addons ?? [],
      applications: snap.applications,
      layout: snap.layout,
      themes: snap.theme ? [snap.theme] : undefined,
    })
    if (!checked) continue
    const theme = snap.theme?.id === DEFAULT_THEME_ID ? DEFAULT_THEME : checked.themes.find((entry) => entry.id !== DEFAULT_THEME_ID)
    const now = Date.now()
    out.push({
      id: item.id,
      name: item.name.trim().slice(0, 20) || '未命名',
      description: typeof item.description === 'string' ? item.description.slice(0, 120) : '',
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : now,
      snapshot: {
        pages: checked.pages,
        statusbar: checked.statusbar,
        layout: checked.layout,
        widgets: checked.widgets,
        addons: checked.addons,
        applications: checked.applications,
        ...(readDock(snap.dock) ? {dock: readDock(snap.dock)} : {}),
        ...(theme ? { theme } : {}),
      },
    })
  }
  return out
}

function readIcon(page: Partial<Page>): Partial<Page> {
  if (typeof page.icon === 'string' && isPageIcon(page.icon)) return { icon: page.icon }
  const legacy = typeof page.id === 'string' ? LEGACY_ICONS[page.id] : undefined
  return legacy ? { icon: legacy } : {}
}

/**
 * 已安装的市场组件。新数据直接读；旧数据没有这个字段，
 * 就按「页面上正在用什么」推断，已有的东西不会因为升级而消失。
 */
function readAddons(raw: unknown, pages: Page[], statusbar: StatusItem[]): string[] {
  const known = new Set(ADDONS.map((addon) => addon.id))
  if (Array.isArray(raw)) return [...new Set(raw.filter((id): id is string => typeof id === 'string' && known.has(id)))]
  const used = new Set<string>([...pages.flatMap((page) => page.components.map((item) => item.type as string)), ...statusbar.map((item) => item.type as string)])
  return ADDONS.filter((addon) => addon.types.some((type) => used.has(type))).map((addon) => addon.id)
}

/**
 * 主题库与当前主题。旧数据只有 theme.overrides：有改动就收成一个「我的主题」并保持启用，没有就用默认。
 */
function readThemeState(data: Partial<Workspace>): { themes: ThemeEntry[]; config: ThemeConfig } {
  const raw = (data.theme ?? {}) as { active?: unknown; overrides?: unknown; mode?: unknown; base?: unknown }
  const mode: 'light' | 'dark' = raw.mode === 'dark' ? 'dark' : 'light'
  const base: 'light' | 'dark' = raw.base === 'dark' ? 'dark' : raw.base === 'light' ? 'light' : mode
  const themes = readThemes(data.themes, mode)
  if (!Array.isArray(data.themes) && raw.overrides && typeof raw.overrides === 'object') {
    try {
      const overrides = cleanOverrides(raw.overrides)
      if (Object.keys(overrides).length) {
        const migrated = readThemes([{ id: 'mine', name: '我的主题', description: '升级前你调过的配色', overrides, mode }], mode).find((item) => item.id === 'mine')
        if (migrated) themes.push(migrated)
        return { themes, config: { active: 'mine', mode, base } }
      }
    } catch {
      /* 旧的变量不合法就当没有 */
    }
  }
  const frameOff = (data.theme as {frameOff?: unknown} | undefined)?.frameOff === true
  const active = typeof raw.active === 'string' && themes.some((item) => item.id === raw.active) ? raw.active : DEFAULT_THEME_ID
  const entry = themes.find((item) => item.id === active)
  // 初始偏好只在 applyTheme 时采用；刷新必须尊重用户已保存的实际模式。
  return { themes, config: { active, mode: raw.mode === 'light' || raw.mode === 'dark' ? raw.mode : entry?.mode ?? mode, base, ...(frameOff ? {frameOff: true} : {}) } }
}

/** 状态条：旧数据没有这个字段，用默认；有就逐项校验，失效的组件丢掉。 */
function readStatusbar(raw: unknown, fallback: StatusItem[]): StatusItem[] {
  if (!Array.isArray(raw)) return fallback
  const items: StatusItem[] = []
  for (const entry of raw.slice(0, MAX_STATUS_ITEMS)) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.type !== 'string') continue
    const definition = getDefinition(entry.type)
    if (!definition?.status) continue
    items.push({ id: entry.id, type: entry.type, config: normalizeConfig(definition, entry.config) })
  }
  return items
}

/** 页面级 CSS 与对齐：导入数据不可信，CSS 重新过一遍检查。 */
function readPageStyle(page: Partial<Page>): Partial<Page> {
  const out: Partial<Page> = {}
  if (typeof page.css === 'string') {
    const checked = sanitizeCss(page.css)
    if (checked.ok && checked.css) out.css = checked.css
  }
  if (page.align === 'start' || page.align === 'center') out.align = page.align
  return out
}

/** 特效图层：逐层重新校验，失效的效果直接丢掉而不是让整页白屏。 */
function readLayers(raw: unknown): Partial<Page> {
  if (!Array.isArray(raw)) return {}
  const layers: Layer[] = []
  for (const item of raw.slice(0, 3)) {
    try {
      layers.push(normalizeLayer(item))
    } catch {
      // 素材库里没有的效果（旧版本或被篡改），忽略
    }
  }
  return layers.length ? { layers } : {}
}

/** 导入的数据不可信：壁纸只接受结构完整、地址合规的值。 */
function readWallpaper(raw: unknown): Wallpaper | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as { mode?: unknown; index?: unknown; url?: unknown }
  if (value.mode === 'off') return { mode: 'off' }
  if (value.mode === 'unsplash') return { mode: 'unsplash', index: Number.isFinite(value.index) ? Math.max(0, Math.trunc(Number(value.index))) : 0 }
  if (value.mode === 'custom' && typeof value.url === 'string' && /^https?:\/\/[^\s"'()<>\\]+$/i.test(value.url)) {
    return { mode: 'custom', url: value.url }
  }
  return undefined
}

function load(rethrow = false, failedAt = stamp): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = migrate(JSON.parse(raw))
      if (migrated) {
        clearPersistenceError('workspace-read')
        return migrated
      }
    }
    clearPersistenceError('workspace-read')
  } catch (error) {
    reportPersistenceError('workspace-read', error, error instanceof SyntaxError ? undefined : () => {
      // 绕过 current 缓存重读；有后续编辑时保留当前值，让保存重试写最新快照。
      const loaded = load(true, failedAt)
      if (stamp === failedAt) {current = loaded; emit()}
    }, !(error instanceof SyntaxError))
    if (rethrow) throw error
  }
  return defaultWorkspace()
}

function persist(workspace: Workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    clearPersistenceError('workspace')
    clearPersistenceError('workspace-read')
  } catch (error) {
    reportPersistenceError('workspace', error, () => {
      // 重试时读取当前状态，不能把失败时的旧快照写回。
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getWorkspace()))
      clearPersistenceError('workspace')
      clearPersistenceError('workspace-read')
    })
  }
}

export function getWorkspace(): Workspace {
  if (!current) current = load()
  return current
}

/** 提交一个新的工作空间；进入撤销栈。 */
export function commit(next: Workspace) {
  assertPersistenceWritable()
  const prev = getWorkspace()
  if (next === prev) return
  past = [...past.slice(-(HISTORY_LIMIT - 1)), prev]
  future = []
  current = next
  persist(next)
  emit()
}

/** 整体替换（导入、重置），同样可撤销。 */
export function replaceWorkspace(next: Workspace) {
  commit(next)
}

export function undo(): boolean {
  assertPersistenceWritable()
  const prev = past[past.length - 1]
  if (!prev) return false
  future = [getWorkspace(), ...future]
  past = past.slice(0, -1)
  current = prev
  persist(prev)
  emit()
  return true
}

export function redo(): boolean {
  assertPersistenceWritable()
  const next = future[0]
  if (!next) return false
  past = [...past, getWorkspace()]
  future = future.slice(1)
  current = next
  persist(next)
  emit()
  return true
}

export function canUndo(): boolean {
  return past.length > 0
}

export function canRedo(): boolean {
  return future.length > 0
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React 订阅：返回当前工作空间，以及撤销/重做状态。 */
export function useWorkspace() {
  useSyncExternalStore(subscribe, () => stamp)
  const workspace = getWorkspace()
  const edit = useCallback((fn: (workspace: Workspace) => Workspace) => commit(fn(getWorkspace())), [])
  return {workspace, edit, undo, redo, canUndo: canUndo(), canRedo: canRedo()}
}
