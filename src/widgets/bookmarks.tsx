import {ActionIcon, A, Button, Empty, Flexbox, Text} from '@lobehub/ui'
import {Bookmark, Plus, Trash2} from 'lucide-react'
import {registerApp, useAppSettings} from '../lib/apps'
import {Group, Row, TextRow} from '../components/ios'
import {uid} from '../lib/store'
import {SHARED, useComponentData} from '../lib/componentData'
import {registerComponent, type ComponentProps} from '../lib/registry'
import type {BookmarkGroup} from '../lib/types'

type BookmarksConfig = {
  heading: string
  showFavicons: boolean
  /** 只显示第一个分组 */
  singleGroup: boolean
}

function favicon(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
  } catch {
    return ''
  }
}

function Bookmarks({config, host}: ComponentProps<BookmarksConfig>) {
  // 书签是共享数据：多个书签卡片显示同一批分组
  const [groups, setGroups] = useComponentData<BookmarkGroup[]>(SHARED.bookmarks, [])
  const shown = config.singleGroup ? groups.slice(0, 1) : groups

  return (
    <Flexbox className="page-pane" direction="vertical" gap={16}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">{config.heading}</Text>
        <ActionIcon icon={Plus} title="编辑书签" onClick={() => host.openSettings('bookmarks')} />
      </Flexbox>
      {shown.length ? (
        <div className="mark-board page-list">
          {shown.map((group) => (
            <section key={group.id}>
              <h3>{group.name}</h3>
              <div className="mark-grid">
                {group.items.map((item) => (
                  <Flexbox key={item.id} direction="horizontal" align="center" gap={4} className="mark-cell" width="100%">
                    <A href={item.url} target="_blank" rel="noreferrer noopener">
                      {config.showFavicons && host.profile.showFavicons && favicon(item.url) ? (
                        <img src={favicon(item.url)} alt="" width={16} height={16} />
                      ) : null}
                      {item.name}
                    </A>
                    <ActionIcon
                      icon={Trash2}
                      size="small"
                      title="删除"
                      onClick={() =>
                        setGroups((prev) => prev.map((g) => (g.id === group.id ? {...g, items: g.items.filter((i) => i.id !== item.id)} : g)))
                      }
                    />
                  </Flexbox>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="还没有书签" action={<Button icon={<Plus size={14} />} onClick={() => host.openSettings('bookmarks')}>去添加</Button>} />
      )}
    </Flexbox>
  )
}

registerComponent<BookmarksConfig>({
  type: 'bookmarks',
  name: '书签',
  description: '按分组展示书签链接，可显示站点图标。书签内容在设置里统一管理，多个书签卡片共用同一批。',
  category: 'content',
  defaultConfig: {heading: '书签', showFavicons: true, singleGroup: false},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    showFavicons: {kind: 'boolean', label: '显示站点图标'},
    singleGroup: {kind: 'boolean', label: '只显示第一个分组'},
  },
  defaultSpan: 'full',
  component: Bookmarks,
  multiple: true,
})


/* ---------- 应用设置：书签 ---------- */

function BookmarkSettings() {
  const {groups, setGroups} = useAppSettings()
  const patchGroup = (id: string, part: Partial<BookmarkGroup>) => setGroups(groups.map((g) => (g.id === id ? {...g, ...part} : g)))

  return (
    <>
      <Group title={`分组 · ${groups.length} 个`}>
        <Row label="添加分组" icon={<Plus size={16} />} onClick={() => setGroups([...groups, {id: uid(), name: '新分组', items: []}])} />
      </Group>
      {groups.map((group) => (
        <Group key={group.id} title={group.name || '未命名分组'}>
          <TextRow label="分组名" value={group.name} onChange={(v) => patchGroup(group.id, {name: v})} />
          {group.items.map((item) => {
            const patchItem = (part: Partial<(typeof group.items)[number]>) =>
              patchGroup(group.id, {items: group.items.map((i) => (i.id === item.id ? {...i, ...part} : i))})
            return (
              <div className="ios-item" key={item.id}>
                <TextRow label="名称" value={item.name} onChange={(v) => patchItem({name: v})} />
                <TextRow label="地址" value={item.url} onChange={(v) => patchItem({url: v})} />
                <Row label="删除这个书签" icon={<Trash2 size={16} />} danger onClick={() => patchGroup(group.id, {items: group.items.filter((i) => i.id !== item.id)})} />
              </div>
            )
          })}
          <Row
            label="添加书签"
            icon={<Plus size={16} />}
            onClick={() => patchGroup(group.id, {items: [...group.items, {id: uid(), name: '新书签', url: 'https://'}]})}
          />
          <Row label="删除整个分组" icon={<Trash2 size={16} />} danger onClick={() => setGroups(groups.filter((g) => g.id !== group.id))} />
        </Group>
      ))}
    </>
  )
}

registerApp({
  id: 'bookmarks',
  name: '书签',
  icon: Bookmark,
  color: '#0a84ff',
  description: '书签分组和每个网址。是否显示站点图标，在书签组件自己的配置里改。',
  summary: (ctx) => `${ctx.groups.reduce((n, g) => n + g.items.length, 0)} 个`,
  Panel: BookmarkSettings,
})
