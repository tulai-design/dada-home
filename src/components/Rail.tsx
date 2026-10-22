import { Badge, Button } from '@lobehub/ui'
import { Bookmark, Flame, Home, LayoutDashboard, Monitor, Moon, Newspaper, NotebookPen, Settings, Sun } from 'lucide-react'
import type { Page } from '../lib/workspace'

/** 内置页面 id 的图标；AI 新建的页面没有对应项，统一用通用图标。 */
const PAGE_ICONS: Record<string, typeof Home> = {
  home: Home,
  feeds: Newspaper,
  desk: NotebookPen,
  marks: Bookmark,
  hot: Flame,
}

export function Rail({
  pages,
  page,
  onPage,
  onMonitor,
  onSettings,
  onTheme,
  theme,
  badges,
}: {
  pages: Page[]
  page: string
  onPage: (id: string) => void
  onMonitor: () => void
  onSettings: () => void
  onTheme: () => void
  theme: 'dark' | 'light'
  /** 页面 id → 角标数字，由调用方按需提供。 */
  badges?: Record<string, number>
}) {
  return (
    <nav className="rail" aria-label="侧边导航">
      <Button className="rail-logo" type="text" onClick={() => onPage(pages[0]?.id ?? 'home')} aria-label="搭搭">
        搭
      </Button>
      <div className="rail-nav">
        {pages.map((item) => {
          const Icon = PAGE_ICONS[item.id] ?? LayoutDashboard
          const count = badges?.[item.id] ?? 0
          const control = (
            <Button
              block
              type="text"
              className="rail-item"
              icon={<Icon size={16} />}
              aria-current={page === item.id ? 'page' : undefined}
              data-on={page === item.id}
              onClick={() => onPage(item.id)}
            >
              {item.label}
            </Button>
          )
          return count ? (
            <Badge key={item.id} count={count} size="small">
              {control}
            </Badge>
          ) : (
            <span key={item.id}>{control}</span>
          )
        })}
      </div>
      <div className="rail-spacer" />
      <Button block type="text" className="rail-item" icon={<Monitor size={16} />} onClick={onMonitor}>
        监控
      </Button>
      <Button
        block
        type="text"
        className="rail-item"
        icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        onClick={onTheme}
      >
        {theme === 'dark' ? '浅色' : '深色'}
      </Button>
      <Button block type="text" className="rail-item" icon={<Settings size={16} />} onClick={onSettings}>
        设置
      </Button>
    </nav>
  )
}
