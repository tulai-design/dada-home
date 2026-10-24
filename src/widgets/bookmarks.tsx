import {useState} from 'react'
import {ActionIcon, Button, Empty, Flexbox, Text} from '@lobehub/ui'
import {Bookmark, FileDown, FileUp, Pencil, Plus} from 'lucide-react'
import {BookmarkEditor, GroupEditor} from '../components/BookmarkEditor'
import {BookmarkSync} from '../components/BookmarkSync'
import {Favicon} from '../components/Favicon'
import {download, hostOf, normalizeUrl, toHtml} from '../lib/bookmarks'
import {registerApp, useAppSettings} from '../lib/apps'
import {Group, Row} from '../components/ios'
import {SHARED, useComponentData} from '../lib/componentData'
import {registerComponent, type ComponentProps} from '../lib/registry'
import type {BookmarkGroup} from '../lib/types'

type BookmarksConfig = {
  heading: string
  showFavicons: boolean
  /** 只显示第一个分组 */
  singleGroup: boolean
}

/** 每组先显示这么多，其余收起来：导入浏览器书签后一个分组可能有几百条。 */
const GROUP_PREVIEW = 18

function Bookmarks({config, host}: ComponentProps<BookmarksConfig>) {
  // 书签是共享数据：多个书签卡片显示同一批分组
  const [groups] = useComponentData<BookmarkGroup[]>(SHARED.bookmarks, [])
  const shown = config.singleGroup ? groups.slice(0, 1) : groups
  const [editing, setEditing] = useState<Parameters<typeof BookmarkEditor>[0]['editing']>(null)
  const [groupEditing, setGroupEditing] = useState<BookmarkGroup | null>(null)

  const [syncOpen, setSyncOpen] = useState(false)
  const [opened, setOpened] = useState<string[]>([])

  return (
    <Flexbox className="page-pane" direction="vertical" gap={16}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">{config.heading}</Text>
        <Flexbox direction="horizontal" gap={2}>
          <ActionIcon icon={FileUp} title="导入与同步" onClick={() => setSyncOpen(true)} />
          <ActionIcon icon={Plus} title="添加书签" onClick={() => setEditing('new')} />
        </Flexbox>
      </Flexbox>
      {shown.length ? (
        <div className="mark-board page-list">
          {shown.map((group) => {
            const open = opened.includes(group.id)
            const items = open ? group.items : group.items.slice(0, GROUP_PREVIEW)
            const hidden = group.items.length - items.length
            return (
              <section key={group.id}>
                <h3 className="mark-title">
                  {group.name}
                  <span className="mark-count">{group.items.length}</span>
                  <ActionIcon className="mark-edit" icon={Pencil} size="small" title="编辑分组" onClick={() => setGroupEditing(group)} />
                </h3>
                <div className="mark-grid">
                  {items.map((item) => {
                    const href = normalizeUrl(item.url)
                    return (
                      <div key={item.id} className="mark-cell">
                        {href ? (
                          <a className="mark-link" href={href} target="_blank" rel="noreferrer noopener" title={`${item.name}\n${href}`}>
                            <Favicon url={href} name={item.name} size={16} enabled={config.showFavicons && host.profile.showFavicons} />
                            <span className="mark-name">{item.name}</span>
                          </a>
                        ) : (
                          <span className="mark-link mark-link-off" title={item.name}>
                            <span className="mark-name">{item.name}</span>
                          </span>
                        )}
                        <ActionIcon className="mark-edit" icon={Pencil} size="small" title="编辑" onClick={() => setEditing({bookmark: item, group: group.name})} />
                      </div>
                    )
                  })}
                </div>
                {group.items.length > GROUP_PREVIEW && (
                  <button type="button" className="mark-more" onClick={() => setOpened((list) => (open ? list.filter((id) => id !== group.id) : [...list, group.id]))}>
                    {open ? '收起' : `展开其余 ${hidden} 个`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <Empty
          title="还没有书签"
          action={
            <Flexbox horizontal gap={8}>
              <Button icon={<Plus size={14} />} onClick={() => setEditing('new')}>
                添加一个
              </Button>
              <Button icon={<FileUp size={14} />} onClick={() => setSyncOpen(true)}>
                从浏览器导入
              </Button>
            </Flexbox>
          }
        />
      )}
      <BookmarkEditor editing={editing} groups={groups} onClose={() => setEditing(null)} />
      <GroupEditor group={groupEditing} onClose={() => setGroupEditing(null)} />
      <BookmarkSync open={syncOpen} onClose={() => setSyncOpen(false)} />
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

/** 设置里每组最多列出几条，再多的在书签页里看。 */
const LIST_LIMIT = 15

function BookmarkSettings() {
  const {groups} = useAppSettings()
  const [editing, setEditing] = useState<Parameters<typeof BookmarkEditor>[0]['editing']>(null)
  const [groupEditing, setGroupEditing] = useState<BookmarkGroup | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)

  return (
    <>
      <Group footer="网页自己读不到浏览器里的书签，装上配套的浏览器扩展就能直接读写；不装也可以导入导出文件。也可以让搭搭 AI 帮你加、帮你整理。">
        <Row label="添加书签" icon={<Plus size={16} />} onClick={() => setEditing('new')} />
        <Row label="导入与同步" hint="从浏览器读取、同步回浏览器，或选导出文件" icon={<FileUp size={16} />} chevron onClick={() => setSyncOpen(true)} />
        <Row label="导出为 HTML" hint="可以导入回任何浏览器" icon={<FileDown size={16} />} onClick={() => download('bookmarks.html', toHtml(groups), 'text/html')} />
      </Group>
      {groups.map((group) => (
        <Group key={group.id} title={`${group.name} · ${group.items.length}`}>
          {group.items.slice(0, LIST_LIMIT).map((item) => (
            <Row key={item.id} label={item.name} hint={hostOf(item.url)} onClick={() => setEditing({bookmark: item, group: group.name})} chevron />
          ))}
          {group.items.length > LIST_LIMIT && <Row hint={`还有 ${group.items.length - LIST_LIMIT} 个，在书签页里看`} />}
          <Row label="编辑分组" icon={<Pencil size={16} />} onClick={() => setGroupEditing(group)} />
        </Group>
      ))}
      <BookmarkEditor editing={editing} groups={groups} onClose={() => setEditing(null)} />
      <GroupEditor group={groupEditing} onClose={() => setGroupEditing(null)} />
      <BookmarkSync open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  )
}

registerApp({
  id: 'bookmarks',
  name: '书签',
  icon: Bookmark,
  color: '#0a84ff',
  description: '添加、导入、导出书签。点一个书签就能改名字、地址和分组。',
  summary: (ctx) => `${ctx.groups.reduce((n, g) => n + g.items.length, 0)} 个`,
  Panel: BookmarkSettings,
})
