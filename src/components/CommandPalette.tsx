import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Input, Modal } from '@lobehub/ui'
import {ArrowRight, Bookmark, ArrowElbowDownLeft as CornerDownLeft, Globe, MagnifyingGlass as Search} from '@phosphor-icons/react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import type { BookmarkGroup } from '../lib/types'
import { normalizeUrl } from '../lib/bookmarks'

export type PaletteAction = {
  id: string
  label: string
  /** 右侧的次要信息：快捷键、所属分组 */
  hint?: string
  group: string
  icon?: PhosphorIcon
  run: () => void
}

type Item = { key: string; label: string; hint?: string; group: string; icon: PhosphorIcon; run: () => void }

/**
 * 快速跳转：切页面、开动作、找书签，找不到就当网址或关键词去网页搜。
 * 没有标题栏，一个输入框加一份分组列表，方向键选、回车执行。
 */
export function CommandPalette({
  open,
  groups,
  extra,
  onClose,
  onSearch,
  placeholder = '搜书签、跳页面，或直接输入网址…',
  web = true,
}: {
  open: boolean
  groups: BookmarkGroup[]
  extra: PaletteAction[]
  onClose: () => void
  onSearch: (query: string, engine: string) => void
  placeholder?: string
  /** 没有匹配时，把输入当网址或关键词去网页搜。页面切换器里关掉。 */
  web?: boolean
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const all = useMemo<Item[]>(() => {
    const marks: Item[] = groups.flatMap((group) =>
      group.items.filter((item) => normalizeUrl(item.url)).map((item) => ({
        key: `bm-${item.id}`,
        label: item.name,
        hint: group.name,
        group: '书签',
        icon: Bookmark,
        run: () => window.location.assign(normalizeUrl(item.url) ?? '/'),
      })),
    )
    const actions: Item[] = extra.map((action) => ({ key: action.id, label: action.label, hint: action.hint, group: action.group, icon: action.icon ?? ArrowRight, run: action.run }))
    return [...actions, ...marks]
  }, [groups, extra])

  const q = query.trim().toLowerCase()
  const text = query.trim()
  const isUrl = /^(https?:\/\/|\w+\.\w{2,})(\/\S*)?$/.test(text)
  const items = useMemo<Item[]>(() => {
    const hits = q ? all.filter((item) => `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase().includes(q)) : all
    if (!q || !web) return hits
    const webItem: Item = {
      key: 'search-web',
      label: text,
      hint: isUrl ? '打开网址' : '网页搜索',
      group: isUrl ? '网址' : '搜索',
      icon: isUrl ? Globe : Search,
      run: () => onSearch(text, isUrl ? 'direct' : 'bing'),
    }
    // 输入的是网址时，打开它排第一；否则排在站内结果之后
    return isUrl ? [webItem, ...hits] : [...hits, webItem]
  }, [all, q, text, isUrl, onSearch, web])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

  const choose = (item?: Item) => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (items.length ? (index + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[active])
    }
  }

  // 按分组归并，保持首次出现的顺序；index 是它在扁平列表里的位置，用来对应高亮
  const sections: { group: string; rows: { item: Item; index: number }[] }[] = []
  items.forEach((item, index) => {
    let section = sections.find((s) => s.group === item.group)
    if (!section) sections.push((section = { group: item.group, rows: [] }))
    section.rows.push({ item, index })
  })

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title=""
      closable={false}
      footer={null}
      width={600}
      destroyOnHidden
      className="cmdk"
      classNames={{ header: 'cmdk-header', body: 'cmdk-body' }}
    >
      <div className="cmdk-input">
        <Search size={17} />
        <Input autoFocus={!window.matchMedia('(pointer: coarse)').matches} variant="borderless" size="large" placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
      </div>

      <div className="cmdk-list" ref={listRef}>
        {sections.map((section) => (
          <div key={section.group} className="cmdk-section">
            <div className="cmdk-group">{section.group}</div>
            {section.rows.map(({ item, index }) => {
              const Icon = item.icon
              return (
                <div
                  key={item.key}
                  role="button"
                  tabIndex={-1}
                  className="cmdk-row"
                  data-active={index === active}
                  onMouseMove={() => active !== index && setActive(index)}
                  onClick={() => choose(item)}
                >
                  <Icon size={16} />
                  <span className="cmdk-label">{item.label}</span>
                  {item.hint && <span className="cmdk-hint">{item.hint}</span>}
                </div>
              )
            })}
          </div>
        ))}
        {!sections.length && <div className="cmdk-empty">没有可跳转的内容</div>}
      </div>

      <div className="cmdk-foot">
        <span>
          <CornerDownLeft size={12} /> 执行
        </span>
        <span>↑ ↓ 选择</span>
        <span>esc 关闭</span>
      </div>
    </Modal>
  )
}
