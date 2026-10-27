import { useMemo } from 'react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import { pageIcon } from '../lib/pageIcons'
import type { Page } from '../lib/workspace'
import { CommandPalette } from './CommandPalette'

/** 所有页面与固定应用的入口。也包含未固定到 Dock 的页面，不走网页搜索。 */
export type SystemEntry = { id: string; label: string; icon: PhosphorIcon; run: () => void; hint?: string }

export function PageSwitcher({
  open,
  pages,
  current,
  system = [],
  onPick,
  onClose,
}: {
  open: boolean
  pages: Page[]
  current: string
  /** 页面之外的入口（固定应用、市场、监控、设置…），手机底栏放不下，收在这里 */
  system?: SystemEntry[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const actions = useMemo(
    () => [
      ...pages.map((page, index) => ({
        id: `page-${page.id}`,
        label: page.name,
        hint: page.id === current ? '当前' : index < 9 ? String(index + 1) : undefined,
        group: `全部页面 · ${pages.length}`,
        icon: pageIcon(page.icon),
        run: () => onPick(page.id),
      })),
      ...system.map((item) => ({ id: item.id, label: item.label, hint: item.hint, group: '应用与系统入口', icon: item.icon, run: item.run })),
    ],
    [pages, current, onPick, system],
  )
  return <CommandPalette open={open} groups={[]} extra={actions} onClose={onClose} onSearch={() => undefined} placeholder="搜索页面、应用或入口" web={false} />
}
