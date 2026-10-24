import {BookMarked, CalendarDays, Flame, Monitor, Music, Newspaper, NotebookPen, Timer} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import type {BuiltinType, ComponentSpan, ComponentType, Workspace} from './workspace'

/**
 * 组件市场（小组件市场）的目录。
 *
 * 系统自带的这些功能不再默认出现：热榜、订阅、书桌、书签、监控都是「组件」，
 * 先放在市场里，用户手动安装，或者让搭搭用 install_addon 装。
 * 安装状态存在工作空间里（Workspace.addons），所以能撤销、能导出。
 *
 * 目录是写死的数据，不是代码：以后做用户共享，只需要让这份目录可以从别处加载。
 */
export type Addon = {
  id: string
  name: string
  icon: LucideIcon
  /** 图标底色 */
  color: string
  /** 一句话卖点 */
  tagline: string
  /** 详细说明，也会给 AI 看 */
  description: string
  /** 这个组件包含的组件类型；卸载时这些类型的实例会从页面里移除 */
  types: BuiltinType[]
  /** 安装时自动建一个页面，并放上这些组件 */
  page?: {
    id: string
    name: string
    label: string
    icon: string
    components: {type: BuiltinType; config?: Record<string, unknown>; span?: ComponentSpan}[]
  }
  /** 对应设置页「应用」分组里的哪一项；没装时那一项不显示 */
  settingsId?: string
  /** 安装后在侧栏底部多一个系统入口 */
  rail?: 'monitor'
  /** 安装后要做的事，写给用户和 AI 的一句话 */
  after: string
}

export const ADDONS: Addon[] = [
  {
    id: 'hot',
    name: '热榜',
    icon: Flame,
    color: '#ff453a',
    tagline: '各大平台的实时热搜',
    description: '聚合微博、知乎、B 站等平台的热榜，一页看完。可以选关注哪些榜单。',
    types: ['hot'],
    page: {id: 'hot', name: '热榜', label: '热榜', icon: 'flame', components: [{type: 'hot'}]},
    settingsId: 'hot',
    after: '侧栏多了「热榜」页面，在 设置 › 热榜 里选关注的榜单。',
  },
  {
    id: 'feeds',
    name: '订阅',
    icon: Newspaper,
    color: '#ff9f0a',
    tagline: 'RSS 订阅阅读',
    description: '添加 RSS / Atom 源，在页面里阅读、标已读，也可以让搭搭总结。',
    types: ['feeds'],
    page: {id: 'feeds', name: '订阅', label: '订阅', icon: 'newspaper', components: [{type: 'feeds', config: {limit: 80}}]},
    settingsId: 'feeds',
    after: '侧栏多了「订阅」页面，在 设置 › 订阅 里添加源。',
  },
  {
    id: 'desk',
    name: '书桌',
    icon: NotebookPen,
    color: '#5e5ce6',
    tagline: '待办与便签',
    description: '一页放待办清单和便签，搭搭可以替你记事、勾选完成。',
    types: ['todos', 'note'],
    page: {
      id: 'desk',
      name: '书桌',
      label: '书桌',
      icon: 'notebook-pen',
      components: [
        {type: 'todos', span: 'half'},
        {type: 'note', span: 'half'},
      ],
    },
    after: '侧栏多了「书桌」页面，待办和便签都在上面。',
  },
  {
    id: 'bookmarks',
    name: '书签',
    icon: BookMarked,
    color: '#0a84ff',
    tagline: '分组书签与快速跳转',
    description: '分组管理常用网址，也能在命令面板里直接搜到。',
    types: ['bookmarks'],
    page: {id: 'marks', name: '书签', label: '书签', icon: 'bookmark', components: [{type: 'bookmarks'}]},
    settingsId: 'bookmarks',
    after: '侧栏多了「书签」页面，在 设置 › 书签 里整理分组。',
  },
  {
    id: 'calendar',
    name: '日历',
    icon: CalendarDays,
    color: '#ff3b30',
    tagline: '月历、日程与倒数日',
    description: '月历显示农历、节气、法定假日和调休；可以记日程、订阅 .ics 日历、记倒数日 / 纪念日（支持农历生日）。搭搭能查某天的日期信息、替你加日程和倒数日。',
    types: ['calendar', 'agenda', 'countdown'],
    page: {
      id: 'calendar',
      name: '日历',
      label: '日历',
      icon: 'calendar',
      components: [
        {type: 'calendar', span: 'two-thirds'},
        {type: 'agenda', span: 'third'},
        {type: 'countdown', span: 'third'},
      ],
    },
    settingsId: 'calendar',
    after: '侧栏多了「日历」页面；订阅 .ics 日历在 设置 › 日历 里。日程和倒数日组件也可以单独放到首页。',
  },
  {
    id: 'focus',
    name: '番茄钟',
    icon: Timer,
    color: '#ff6b35',
    tagline: '专注计时与统计',
    description: '番茄工作法：专注与休息交替，到点提醒，记录每天专注了多久。可以放进状态条，搭搭能替你开始和暂停计时。',
    types: ['pomodoro'],
    page: {id: 'focus', name: '专注', label: '专注', icon: 'timer', components: [{type: 'pomodoro', span: 'third'}]},
    settingsId: 'focus',
    after: '侧栏多了「专注」页面；时长在 设置 › 番茄钟 里改。也可以放进状态条。',
  },
  {
    id: 'music',
    name: '音乐',
    icon: Music,
    color: '#af52de',
    tagline: '网络电台与白噪音',
    description: '播放网络电台、音频直链和内置的白噪音，切页面不会断。搭搭能替你加歌、播放、暂停。',
    types: ['music'],
    page: {id: 'music', name: '音乐', label: '音乐', icon: 'music', components: [{type: 'music', span: 'half'}]},
    after: '侧栏多了「音乐」页面，点右上角的 + 添加常用电台或白噪音。也可以放进状态条。',
  },
  {
    id: 'monitor',
    name: '服务监控',
    icon: Monitor,
    color: '#30d158',
    tagline: '盯着自己的服务和接口',
    description: '定时探测你填的地址，看在线状态和响应时间；可以放到状态条里随时瞄一眼。',
    types: ['monitor'],
    settingsId: 'monitor',
    rail: 'monitor',
    after: '侧栏底部多了「监控」入口，在 设置 › 监控 里接入服务；也可以放进状态条。',
  },
]

export function getAddon(id: string): Addon | undefined {
  return ADDONS.find((addon) => addon.id === id)
}

/** 某个组件类型属于哪个市场组件；不属于任何市场组件（核心组件）返回 undefined。 */
export function addonOfType(type: ComponentType | string): Addon | undefined {
  return ADDONS.find((addon) => (addon.types as string[]).includes(type))
}

export function isInstalled(workspace: Pick<Workspace, 'addons'>, id: string): boolean {
  return workspace.addons.includes(id)
}

/** 这个组件类型现在能不能用：核心组件永远能，市场组件要装了才行。 */
export function typeAvailable(workspace: Pick<Workspace, 'addons'>, type: ComponentType | string): boolean {
  const addon = addonOfType(type)
  return !addon || isInstalled(workspace, addon.id)
}

/** 设置页「应用」分组里的某一项该不该显示：属于市场组件的，装了才显示。 */
export function appVisible(workspace: Pick<Workspace, 'addons'>, appId: string): boolean {
  const addon = ADDONS.find((item) => item.settingsId === appId)
  return !addon || isInstalled(workspace, addon.id)
}
