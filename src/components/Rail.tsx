import { Badge, Button } from '@lobehub/ui'
import { Bookmark, Flame, Home, Monitor, Moon, Newspaper, NotebookPen, Settings, Sun } from 'lucide-react'
import { PAGES, type PageId } from '../lib/pages'

const PAGE_ICONS = {
  home: Home,
  feeds: Newspaper,
  desk: NotebookPen,
  marks: Bookmark,
  hot: Flame,
} as const

export function Rail({
  page,
  onPage,
  onMonitor,
  onSettings,
  onTheme,
  theme,
  unread,
  openTodos,
}: {
  page: PageId
  onPage: (id: PageId) => void
  onMonitor: () => void
  onSettings: () => void
  onTheme: () => void
  theme: 'dark' | 'light'
  unread: number
  openTodos: number
}) {
  return (
    <nav className="rail" aria-label="侧边导航">
      <Button className="rail-logo" type="text" onClick={() => onPage('home')} aria-label="第一页">
        页
      </Button>
      <div className="rail-nav">
        {PAGES.map((item) => {
          const Icon = PAGE_ICONS[item.id]
          const count = item.id === 'feeds' ? unread : item.id === 'desk' ? openTodos : 0
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
