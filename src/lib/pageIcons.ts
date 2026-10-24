import {
  BookOpen, Bookmark, Briefcase, Calendar, Camera, ChartLine, CheckSquare, Cloud, Code, Coffee, Cpu, Dumbbell, FileText,
  Film, Flame, Gamepad2, Globe, GraduationCap, Heart, Home, Image, Inbox, LayoutDashboard, Lightbulb, Lock, Mail, Map,
  MessageCircle, Music, Newspaper, NotebookPen, Palette, Plane, Rocket, ShoppingCart, Sparkles, Star, Sun, Terminal,
  Trophy, Users, Utensils, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * 页面图标白名单。AI 只能从这里挑名字（不能塞任意字符串），侧栏、切换器、设置页都从这里取图标。
 */
export const PAGE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  newspaper: Newspaper,
  'notebook-pen': NotebookPen,
  bookmark: Bookmark,
  flame: Flame,
  dashboard: LayoutDashboard,
  star: Star,
  heart: Heart,
  music: Music,
  film: Film,
  game: Gamepad2,
  book: BookOpen,
  study: GraduationCap,
  code: Code,
  terminal: Terminal,
  work: Briefcase,
  calendar: Calendar,
  todo: CheckSquare,
  image: Image,
  camera: Camera,
  map: Map,
  travel: Plane,
  shop: ShoppingCart,
  money: Wallet,
  chart: ChartLine,
  cpu: Cpu,
  cloud: Cloud,
  sun: Sun,
  coffee: Coffee,
  food: Utensils,
  fitness: Dumbbell,
  people: Users,
  chat: MessageCircle,
  mail: Mail,
  sparkles: Sparkles,
  rocket: Rocket,
  idea: Lightbulb,
  design: Palette,
  tools: Wrench,
  web: Globe,
  secret: Lock,
  doc: FileText,
  inbox: Inbox,
  trophy: Trophy,
}

export const PAGE_ICON_KEYS = Object.keys(PAGE_ICONS)

export function isPageIcon(key: string): boolean {
  return key in PAGE_ICONS
}

export function pageIcon(key: string | undefined): LucideIcon {
  return (key && PAGE_ICONS[key]) || LayoutDashboard
}

/** 图标的中文名，选择器里显示这个，不露英文 key。 */
export const PAGE_ICON_LABELS: Record<string, string> = {
  home: '首页', newspaper: '报纸', 'notebook-pen': '笔记本', bookmark: '书签', flame: '火焰', dashboard: '面板',
  star: '星标', heart: '心形', music: '音乐', film: '电影', game: '游戏', book: '书', study: '学习', code: '代码',
  terminal: '终端', work: '工作', calendar: '日历', todo: '待办', image: '图片', camera: '相机', map: '地图',
  travel: '旅行', shop: '购物', money: '财务', chart: '图表', cpu: '芯片', cloud: '云', sun: '太阳', coffee: '咖啡',
  food: '美食', fitness: '健身', people: '人物', chat: '对话', mail: '邮件', sparkles: '闪光', rocket: '火箭',
  idea: '灵感', design: '设计', tools: '工具', web: '网页', secret: '私密', doc: '文档', inbox: '收件箱', trophy: '奖杯',
}
