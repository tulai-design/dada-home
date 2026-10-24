import {defaultWorkspace, addComponent, installAddon, removePage, saveTheme} from './ops'
import {DEFAULT_THEME, type TemplateSnapshot, type Workspace} from './workspace'

/**
 * 内置预设模板。
 *
 * 它们不存进工作空间（不占模板名额、不随导出走），每次套用时现场用 ops 搭出来，
 * 所以始终和当前版本的组件、市场保持一致，不会因为升级而过期。
 */

export type Preset = {
  id: string
  name: string
  description: string
  /** 一眼看出这套模板里有什么 */
  tags: string[]
  build: () => TemplateSnapshot
}

const snap = (ws: Workspace, theme: TemplateSnapshot['theme'] = DEFAULT_THEME): TemplateSnapshot => ({
  pages: ws.pages,
  statusbar: ws.statusbar,
  layout: ws.layout,
  widgets: ws.widgets,
  addons: ws.addons,
  theme,
})

const withAddons = (ws: Workspace, ids: string[]): Workspace => ids.reduce((acc, id) => installAddon(acc, id).workspace, ws)

export const PRESETS: Preset[] = [
  {
    id: 'preset-minimal',
    name: '极简起始页',
    description: '只有时钟和一个搜索框，留白最多。',
    tags: ['时钟', '搜索'],
    build: () => snap(defaultWorkspace()),
  },
  {
    id: 'preset-desk',
    name: '效率桌面',
    description: '首页带书签，另有一页书桌放待办和便签。',
    tags: ['搜索', '书签', '待办', '便签'],
    build: () => {
      // 书签只能放一个：装上后把它自带的页面拆掉，改放到首页
      let ws = withAddons(defaultWorkspace(), ['desk', 'bookmarks'])
      ws = removePage(ws, 'marks')
      ws = addComponent(ws, {pageId: 'home', type: 'bookmarks', span: 'full'}).workspace
      return snap(ws)
    },
  },
  {
    id: 'preset-reader',
    name: '资讯阅读',
    description: '热榜和订阅各占一页，打开就是今天的新闻。',
    tags: ['热榜', '订阅', '搜索'],
    build: () => snap(withAddons(defaultWorkspace(), ['hot', 'feeds'])),
  },
  {
    id: 'preset-night',
    name: '深夜工作台',
    description: '深海蓝配色，书桌、书签和订阅，适合晚上用。',
    tags: ['深色', '书桌', '书签', '订阅'],
    build: () => {
      const ws = withAddons(defaultWorkspace(), ['desk', 'bookmarks', 'feeds'])
      const themed = saveTheme(ws, {
        name: '深海',
        description: '深海蓝底、浅灰蓝字、天蓝点缀。',
        mode: 'dark',
        overrides: {bg: '#0d1520', bg2: '#131f2e', bg3: '#1b2c40', text: '#e6edf6', text2: '#a3b2c6', text3: '#6f8199', main: '#4f9dff'},
        activate: false,
      })
      return snap(ws, themed.theme)
    },
  },
]

export function findPreset(ref: string): Preset | undefined {
  const needle = ref.trim().toLowerCase()
  return PRESETS.find((item) => item.id === ref || item.id === `preset-${ref}` || item.name.toLowerCase() === needle)
}
