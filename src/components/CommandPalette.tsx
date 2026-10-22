import { useEffect, useMemo, useState } from 'react'
import { Hotkey, List, Modal, SearchBar } from '@lobehub/ui'
import type { BookmarkGroup } from '../lib/types'
import { SEARCH_ENGINES } from '../lib/defaults'

export type PaletteAction = {
  id: string
  label: string
  hint?: string
  group: string
  glyph?: string
  run: () => void
}

export function CommandPalette({
  open,
  groups,
  extra,
  onClose,
  onSearch,
}: {
  open: boolean
  groups: BookmarkGroup[]
  extra: PaletteAction[]
  onClose: () => void
  onSearch: (query: string, engine: string) => void
}) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const actions = useMemo<PaletteAction[]>(() => {
    const marks: PaletteAction[] = []
    for (const group of groups) {
      for (const item of group.items) {
        marks.push({
          id: `bm-${item.id}`,
          label: item.name,
          hint: group.name,
          group: '书签',
          run: () => window.location.assign(item.url),
        })
      }
    }
    return [...marks, ...extra]
  }, [groups, extra])

  const q = query.trim().toLowerCase()
  const filtered = q ? actions.filter((a) => `${a.label} ${a.hint ?? ''} ${a.group}`.toLowerCase().includes(q)) : actions
  const isUrl = /^(https?:\/\/|\w+\.\w{2,})(\/\S*)?$/.test(query.trim())

  const items = [
    ...filtered.map((action) => ({
      key: action.id,
      label: action.label,
      description: action.group,
      extra: action.hint,
      onClick: () => {
        onClose()
        action.run()
      },
    })),
    ...(q
      ? [
          {
            key: 'search-web',
            label: query.trim(),
            description: isUrl ? '打开网址' : '在网页中搜索',
            extra: isUrl ? '回车打开' : '回车搜索',
            onClick: () => {
              onSearch(query.trim(), isUrl ? 'direct' : 'bing')
              onClose()
            },
          },
        ]
      : []),
  ]

  return (
    <Modal open={open} onCancel={onClose} title="命令面板" footer={null} width={560} destroyOnHidden>
      <SearchBar
        autoFocus
        allowClear
        size="large"
        placeholder="找书签、切主题、问助手…"
        value={query}
        onValueChange={setQuery}
        onPressEnter={() => {
          if (!items.length) return
          items[0]?.onClick?.()
        }}
      />
      <List items={items} variant="borderless" style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 12, opacity: 0.7 }}>
        <Hotkey keys="enter" />
        <span>执行</span>
        <Hotkey keys="esc" />
        <span>关闭</span>
        <span style={{ marginLeft: 'auto' }}>{SEARCH_ENGINES.length} 个搜索引擎</span>
      </div>
    </Modal>
  )
}
