import { useMemo } from 'react'
import { pageIcon } from '../lib/pageIcons'
import type { Page } from '../lib/workspace'
import { CommandPalette } from './CommandPalette'

/** 全部页面：页面多了侧栏放不下时的总入口。和快速跳转同一套界面，只列页面，不走网页搜索。 */
export function PageSwitcher({ open, pages, current, onPick, onClose }: { open: boolean; pages: Page[]; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const actions = useMemo(
    () =>
      pages.map((page, index) => ({
        id: `page-${page.id}`,
        label: page.name,
        hint: page.id === current ? '当前' : index < 9 ? String(index + 1) : undefined,
        group: `全部页面 · ${pages.length}`,
        icon: pageIcon(page.icon),
        run: () => onPick(page.id),
      })),
    [pages, current, onPick],
  )
  return <CommandPalette open={open} groups={[]} extra={actions} onClose={onClose} onSearch={() => undefined} placeholder="搜索页面" web={false} />
}
