import {DEFAULT_DOCK_PRESET} from './dock'
import {WorkspaceError} from './errors'
import {DEFAULT_STACKS, fontVars} from './fonts'
import {DEFAULT_THEME_PALETTES, resolveThemeOverrides} from './themes'
import {DEFAULT_HOME_LAYERS, DEFAULT_THEME, DEFAULT_THEME_ID, FROZEN_PAGE_ID, activeTheme, type Page, type Workspace} from './workspace'
import {assertFxBudgetChange} from '../fx/policy'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const stable = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** 默认外观的可查询说明；首页图层与真正的初始化使用同一份定义。 */
export function defaultAppearance() {
  return {
    theme: {
      id: DEFAULT_THEME_ID,
      name: DEFAULT_THEME.name,
      description: DEFAULT_THEME.description,
      mode: 'light',
      shared: {radius: '0px', 'radius-lg': '0px', frame: '7px', 'side-width': '84px', gutter: '28px', 'frame-gap': 'var(--frame)', 'frame-color': 'var(--main)'},
      ...clone(DEFAULT_THEME_PALETTES),
      fonts: {...DEFAULT_STACKS},
    },
    home: {wallpaper: {mode: 'off'}, layers: clone(DEFAULT_HOME_LAYERS), css: '', align: 'center'},
    otherPages: {wallpaper: {mode: 'off'}, layers: [], css: '', align: 'start'},
    dock: {preset: DEFAULT_DOCK_PRESET, css: ''},
    componentLook: {
      variant: 'card', tone: 'neutral', titleSize: 'md', css: '', animation: 'none',
      description: '这是 PageView 在组件未设置 look 时使用的容器属性。实际外观由组件结构和主题 CSS 决定：时钟、搜索没有通用卡片容器，保持自身布局；普通内容块默认透明底加顶线，独占页面的舞台组件也会采用自身布局。还原时移除 look，让这些默认规则重新生效。',
    },
    resetPolicy: {
      all: '恢复默认配色、字体、外框、Dock、所有页面的壁纸/图层/页面 CSS 与组件外观；首页恢复默认波纹线。默认保留用户当前明暗，可显式指定 mode。',
      home: '仅恢复首页壁纸、默认波纹线、页面 CSS 和组件外观，不改变全局主题与 Dock。',
      preserved: '页面与组件内容、名称、顺序、宽度、对齐和布局、配置、业务数据、主题库与模板库保留。独立特效组件与 App 内源码属于内容，不能通过外观还原自动改写。',
      budget: '默认图层与保留的特效内容块共同计预算。若还原会增加超限负荷，整体拒绝且不部分修改；先减少或移动相关特效块后再还原。旧超限设计仍可执行不加重负荷的还原。',
    },
  }
}

const pageAppearance = (page: Page) => ({
  id: page.id, name: page.name,
  wallpaper: page.wallpaper ?? {mode: 'off'}, layers: page.layers ?? [], css: page.css ?? '', align: page.align ?? 'start',
  components: page.components.filter((item) => item.look && Object.keys(item.look).length).map((item) => ({id: item.id, type: item.type, look: item.look})),
  embeddedVisuals: page.components.filter((item) => ['fx', 'app', 'applet'].includes(item.type)).map((item) => ({id: item.id, type: item.type, title: item.title ?? '', note: '独立内容，外观还原保留；需单独检查其配置或源码'})),
})

/** 让 Agent 同时看到默认定义、当前生效值和背景/样式差异，不靠猜测逐项回退。 */
export function getAppearance(workspace: Workspace) {
  const defaults = defaultAppearance()
  const currentTheme = activeTheme(workspace)
  const pages = workspace.pages.map(pageAppearance)
  return {
    defaults,
    current: {
      mode: workspace.theme.mode,
      theme: {...currentTheme, resolved: {
        ...defaults.theme.shared,
        ...DEFAULT_THEME_PALETTES[workspace.theme.mode],
        ...Object.fromEntries(Object.entries(DEFAULT_STACKS).map(([role, stack]) => [`font-${role}`, stack])),
        ...fontVars(currentTheme.fonts),
        ...resolveThemeOverrides(currentTheme, workspace.theme.mode),
      }},
      dock: workspace.dock ?? defaults.dock,
      pages,
    },
    differences: {
      theme: currentTheme.id !== DEFAULT_THEME_ID,
      dock: Boolean(workspace.dock?.css || workspace.dock && workspace.dock.preset !== DEFAULT_DOCK_PRESET),
      pages: pages.map((page) => ({
        id: page.id,
        wallpaper: page.wallpaper.mode !== 'off',
        layers: stable(page.layers) !== stable(page.id === FROZEN_PAGE_ID ? defaults.home.layers : []),
        css: Boolean(page.css.trim()),
        componentLooks: page.components.map((item) => item.id),
        embeddedVisuals: page.embeddedVisuals.map((item) => item.id),
      })),
    },
  }
}

/** 一个可撤销的外观操作。保留内容和布局，不用默认工作区整包覆盖用户数据。 */
export function resetAppearance(workspace: Workspace, input: {scope?: string; mode?: string} = {}): Workspace {
  const scope = input.scope ?? 'all'
  if (scope !== 'all' && scope !== 'home') throw new WorkspaceError('scope 只能是 all 或 home')
  if (input.mode !== undefined && input.mode !== 'light' && input.mode !== 'dark') throw new WorkspaceError('mode 只能是 light 或 dark')
  if (scope === 'home' && input.mode !== undefined) throw new WorkspaceError('仅还原首页时不切换全局明暗；请省略 mode，或使用 scope:all')
  if (scope === 'home' && !workspace.pages.some((page) => page.id === FROZEN_PAGE_ID)) throw new WorkspaceError('没有找到首页')
  const pages = workspace.pages.map((page) => {
    if (scope === 'home' && page.id !== FROZEN_PAGE_ID) return page
    const {wallpaper: _wallpaper, layers: _layers, css: _css, ...rest} = page
    const next: Page = {
      ...rest,
      ...(page.id === FROZEN_PAGE_ID ? {layers: clone(DEFAULT_HOME_LAYERS)} : {}),
      components: page.components.map(({look: _look, ...item}) => item),
    }
    assertFxBudgetChange(page, next)
    return next
  })
  if (scope === 'home') return {...workspace, pages}
  const {dock: _dock, ...rest} = workspace
  const mode = input.mode ?? workspace.theme.mode
  return {
    ...rest, pages,
    themes: [clone(DEFAULT_THEME), ...workspace.themes.filter((theme) => theme.id !== DEFAULT_THEME_ID)],
    theme: {...workspace.theme, active: DEFAULT_THEME_ID, mode, base: mode},
  }
}
