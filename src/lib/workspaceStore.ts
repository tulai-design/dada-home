import {useCallback, useSyncExternalStore} from 'react'
import {defaultWorkspace} from './ops'
import {getDefinition, normalizeConfig} from './registry'
import {FROZEN_PAGE_ID, MAX_STATUS_ITEMS, WORKSPACE_VERSION, type StatusItem, type CustomWidget, type Layer, type Page, type Wallpaper, type Workspace} from './workspace'
import {normalizeWidget, sanitizeCss} from './customWidget'
import {normalizeLayer} from '../fx/catalog'
import {isPageIcon} from './pageIcons'
import {ADDONS} from './market'

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
 * 目前只有版本 1，所以只做结构兜底；以后改结构就在这里加 `if (version < 2)`。
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
    pages.push({
      id: page.id,
      name: typeof page.name === 'string' ? page.name : page.id,
      label: typeof page.label === 'string' ? page.label : page.id,
      // 丢掉已失效的组件类型：内置的看注册表，自定义的看 widgets 列表
      components: page.components.filter(
        (item) => item && typeof item.id === 'string' && (getDefinition(item.type) || customTypes.has(item.type)),
      ),
      ...(readWallpaper(page.wallpaper) ? { wallpaper: readWallpaper(page.wallpaper) } : {}),
      ...readPageStyle(page),
      ...readIcon(page),
      ...readLayers(page.layers),
    })
  }
  if (!pages.length) return null

  const fallback = defaultWorkspace()
  // 首页是固定项：丢了就补回最前面；不在最前就挪回去
  const homeAt = pages.findIndex((page) => page.id === FROZEN_PAGE_ID)
  if (homeAt < 0) pages.unshift(fallback.pages[0])
  else if (homeAt > 0) pages.unshift(...pages.splice(homeAt, 1))
  const statusbar = readStatusbar(data.statusbar, fallback.statusbar)
  return {
    version: WORKSPACE_VERSION,
    pages,
    addons: readAddons((data as { addons?: unknown }).addons, pages, statusbar),
    theme: {
      preset: typeof data.theme?.preset === 'string' ? data.theme.preset : fallback.theme.preset,
      mode: data.theme?.mode === 'dark' ? 'dark' : 'light',
      overrides: data.theme?.overrides && typeof data.theme.overrides === 'object' ? data.theme.overrides : {},
    },
    layout: {
      columns: Number.isFinite(data.layout?.columns) ? Number(data.layout!.columns) : fallback.layout.columns,
      maxWidth: Number.isFinite(data.layout?.maxWidth) ? Number(data.layout!.maxWidth) : fallback.layout.maxWidth,
    },
    widgets,
    network: Array.isArray(data.network) ? data.network.filter((g) => g && typeof g.host === 'string') : [],
    statusbar,
  }
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

function load(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = migrate(JSON.parse(raw))
      if (migrated) return migrated
    }
  } catch {
    /* 存储损坏时回落到默认 */
  }
  return defaultWorkspace()
}

function persist(workspace: Workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
  } catch {
    /* 无痕模式或超额，只在内存里保留 */
  }
}

export function getWorkspace(): Workspace {
  if (!current) current = load()
  return current
}

/** 提交一个新的工作空间；进入撤销栈。 */
export function commit(next: Workspace) {
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
