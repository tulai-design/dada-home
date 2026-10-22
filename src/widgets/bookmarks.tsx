import {ActionIcon, A, Button, Empty, Flexbox, Text} from '@lobehub/ui'
import {Plus, Trash2} from 'lucide-react'
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
        <ActionIcon icon={Plus} title="编辑书签" onClick={host.openSettings} />
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
        <Empty title="还没有书签" action={<Button onClick={host.openSettings}>去添加</Button>} />
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
