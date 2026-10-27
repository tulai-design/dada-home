import {WorkspaceError} from './errors'
import {setPageSections} from './ops'
import {FROZEN_PAGE_ID, type Page, type PageSection, type Workspace} from './workspace'

export const HOMEPAGE_RECIPES = [
  {id: 'minimal', name: '极简启动页', description: '时钟和搜索居中，快捷入口与其他内容依次展开。', order: 'clock/search主视觉，links/bookmarks单列，其余单列。'},
  {id: 'productivity', name: '效率工作台', description: '搜索置前，工作内容与日程信息形成主次栏。', order: 'search主视觉，其余工作内容主栏，clock/weather/calendar/agenda/countdown辅栏。'},
  {id: 'editorial', name: '编辑式内容页', description: '突出一份内容，其余阅读与辅助信息分栏。', order: '首个feeds/note/quote/custom优先焦点，回落clock/首项；搜索/快捷/信息类为辅栏。'},
  {id: 'showcase', name: '视觉展示页', description: '已有视觉或应用作为焦点，其余内容两列展示。', order: '首个fx/custom/app/applet优先焦点，回落clock/首项；其余两列。'},
] as const
export type HomepageRecipeId = (typeof HOMEPAGE_RECIPES)[number]['id']

export function listHomepageRecipes() {
  return {
    recipes: HOMEPAGE_RECIPES,
    focus: 'focusId可选，只能引用当前首页已有组件；显式焦点优先。',
    content: '只重排首页已有组件并设置分区；保留ID、配置、业务数据与所有其他页面，不安装或新建内容。',
    empty: '空首页保持空态，内容不足时省略空组，不补假数据。',
    compact: '实际内容容器小于720px时按分区阅读顺序单列，主次栏先主后辅。',
    theme: '沿用当前主题和组件配色，浅深模式由宿主主题决定。',
    effects: '保留现有图层、壁纸和特效参数；不添加动画，继续执行现有页面预算。',
    preview: '布局预览使用静态表示，不运行应用、业务组件或动态特效；不读取私有业务数据，不能确认组件内部行为或审美。',
  }
}

export function buildHomepageRecipe(workspace: Workspace, input: {recipeId: unknown; focusId?: unknown}): Page {
  if (!HOMEPAGE_RECIPES.some((recipe) => recipe.id === input.recipeId)) throw new WorkspaceError('recipeId 必须是 minimal / productivity / editorial / showcase')
  const page = workspace.pages.find((item) => item.id === FROZEN_PAGE_ID)
  if (!page) throw new WorkspaceError('找不到首页，无法生成首页组合')
  if (input.focusId !== undefined && (typeof input.focusId !== 'string' || !page.components.some((item) => item.id === input.focusId))) throw new WorkspaceError('focusId 必须引用当前首页已有组件')
  const components = page.components
  const focus = components.find((item) => item.id === input.focusId)
  const ids = (items: typeof components) => items.map((item) => item.id)
  const sections: PageSection[] = []
  const hero = (items: typeof components, align: 'start' | 'center' = 'start') => {
    if (items.length) sections.push({id: 'intro', kind: 'hero', items: ids(items), align})
  }
  const section = (id: string, items: typeof components, columns: 1 | 2) => {
    if (items.length) sections.push({id, kind: 'section', items: ids(items), columns})
  }
  const split = (primary: typeof components, secondary: typeof components) => {
    if (primary.length && secondary.length) sections.push({id: 'work', kind: 'split', primary: ids(primary), secondary: ids(secondary), ratio: 'wide-primary'})
    else section('content', primary.length ? primary : secondary, 1)
  }
  const info = new Set(['clock', 'weather', 'calendar', 'agenda', 'countdown'])
  if (input.recipeId === 'minimal') {
    const core = focus ? [focus] : components.filter((item) => item.type === 'clock' || item.type === 'search')
    const intro = core.length ? core : components.slice(0, 1)
    const rest = components.filter((item) => !intro.includes(item))
    const quick = rest.filter((item) => item.type === 'links' || item.type === 'bookmarks')
    hero(intro, 'center')
    section('quick', quick, 1)
    section('content', rest.filter((item) => !quick.includes(item)), 1)
  } else if (input.recipeId === 'productivity') {
    const intro = focus ?? components.find((item) => item.type === 'search')
    hero(intro ? [intro] : [])
    const rest = components.filter((item) => item !== intro)
    split(rest.filter((item) => !info.has(item.type)), rest.filter((item) => info.has(item.type)))
  } else if (input.recipeId === 'editorial') {
    const intro = focus ?? components.find((item) => ['feeds', 'note', 'quote'].includes(item.type) || item.type.startsWith('custom:')) ?? components.find((item) => item.type === 'clock') ?? components[0]
    hero(intro ? [intro] : [])
    const rest = components.filter((item) => item !== intro)
    const auxiliary = (type: string) => info.has(type) || ['search', 'links', 'bookmarks'].includes(type)
    split(rest.filter((item) => !auxiliary(item.type)), rest.filter((item) => auxiliary(item.type)))
  } else {
    const intro = focus ?? components.find((item) => ['fx', 'app', 'applet'].includes(item.type) || item.type.startsWith('custom:')) ?? components.find((item) => item.type === 'clock') ?? components[0]
    hero(intro ? [intro] : [])
    section('content', components.filter((item) => item !== intro), 2)
  }
  return setPageSections(workspace, page.id, sections).pages.find((item) => item.id === page.id)!
}
