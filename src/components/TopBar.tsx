import type { ReactNode } from 'react'
import { ActionIcon } from '@lobehub/ui'
import { Moon, Search, Sun } from 'lucide-react'

/**
 * 顶栏（状态条）。
 *   右：可配置的状态项（默认只有时钟），然后是两个固定的小图标：快速跳转、深浅色。
 *   最后一个图标贴着窗口右上角。
 */
export function TopBar({
  status,
  theme,
  onTheme,
  onPalette,
}: {
  status: ReactNode
  theme: 'dark' | 'light'
  onTheme: () => void
  onPalette: () => void
}) {
  const small = { blockSize: 28, size: 15, borderRadius: 8 }
  return (
    <div className="topbar">
      <div className="topbar-right">
        {status}
        <span className="topbar-tools">
          <ActionIcon className="topbar-btn" icon={Search} size={small} title="快速跳转 · ⌘K" aria-label="快速跳转" tooltipProps={{ placement: 'bottomRight' }} onClick={onPalette} />
          <ActionIcon
            className="topbar-btn"
            icon={theme === 'dark' ? Sun : Moon}
            size={small}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label="深浅色切换"
            tooltipProps={{ placement: 'bottomRight' }}
            onClick={onTheme}
          />
        </span>
      </div>
    </div>
  )
}
