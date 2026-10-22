import { useMemo, useState } from 'react'
import {
  A,
  ActionIcon,
  Block,
  Button,
  Empty,
  Flexbox,
  Input,
  List,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui'
import { Check, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { Article, BookmarkGroup, Settings as SettingsShape, Todo, Weather as WeatherShape } from '../lib/types'
import type { HotBoard } from '../lib/hot'
import { relativeTime } from '../lib/date'

const TAG_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan', 'geekblue', 'magenta'] as const

function tagColor(source: string) {
  let hash = 0
  for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

export function FeedBlock({
  articles,
  loading,
  errors,
  readIds,
  onOpen,
  onRefresh,
  onManage,
}: {
  articles: Article[]
  loading: boolean
  errors: string[]
  readIds: string[]
  onOpen: (a: Article) => void
  onRefresh: () => void
  onManage: () => void
}) {
  const [filter, setFilter] = useState('__all')
  const sources = useMemo(() => Array.from(new Set(articles.map((a) => a.source))), [articles])
  const shown = (filter === '__all' ? articles : articles.filter((a) => a.source === filter)).slice(0, 80)

  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Flexbox direction="horizontal" align="center" gap={8} wrap="wrap" width="100%">
        <Tag
          color={filter === '__all' ? 'red' : 'gray'}
          variant={filter === '__all' ? 'filled' : 'outlined'}
          style={{ cursor: 'pointer' }}
          onClick={() => setFilter('__all')}
        >
          全部 {articles.length}
        </Tag>
        {sources.slice(0, 8).map((source) => (
          <Tag
            key={source}
            color={filter === source ? tagColor(source) : 'gray'}
            variant={filter === source ? 'filled' : 'outlined'}
            style={{ cursor: 'pointer' }}
            onClick={() => setFilter(source)}
          >
            {source.length > 14 ? `${source.slice(0, 14)}…` : source}
          </Tag>
        ))}
        <Flexbox flex={1} />
        <ActionIcon icon={RefreshCw} title="刷新" loading={loading} spin={loading} onClick={onRefresh} />
        <Button size="small" type="text" onClick={onManage}>
          订阅源
        </Button>
      </Flexbox>
      {errors[0] && (
        <Text type="danger">
          {errors[0]}
          {errors.length > 1 ? ` 等 ${errors.length} 个源失败` : ''}
        </Text>
      )}
      {shown.length ? (
        <div className="feed-grid page-list">
          {shown.map((article) => (
            <Block
              key={article.id}
              clickable
              variant="borderless"
              className={`feed-card${readIds.includes(article.id) ? ' is-read' : ''}`}
              onClick={() => onOpen(article)}
            >
              <Flexbox direction="horizontal" align="center" justify="space-between" gap={8} width="100%">
                <Tag color={tagColor(article.source)} size="small">
                  {article.source}
                </Tag>
                <Text type="secondary" fontSize={11}>
                  {relativeTime(article.date)}
                </Text>
              </Flexbox>
              <h3>{article.title}</h3>
              {article.excerpt && <p>{article.excerpt}</p>}
            </Block>
          ))}
        </div>
      ) : (
        <Empty title={loading ? '正在收取订阅' : '暂时没有内容'} description="换个源，或稍后再刷新。" />
      )}
    </Flexbox>
  )
}

export function WeatherBlock({ weather }: { weather: WeatherShape | null }) {
  if (!weather) return <Empty title="正在读取天气" />
  return (
    <Flexbox direction="horizontal" align="center" gap={16} className="weather-card" width="100%">
      <Text className="weather-temp">
        {weather.temp}
        <Text as="sup" type="secondary">
          °C
        </Text>
      </Text>
      <Flexbox direction="vertical" gap={4}>
        <Text>{weather.label}</Text>
        <Text type="secondary">{weather.place}</Text>
        <Text type="secondary">
          {weather.min}° / {weather.max}° · 湿度 {weather.humidity}% · 风 {weather.wind} km/h
        </Text>
      </Flexbox>
    </Flexbox>
  )
}

function favicon(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
  } catch {
    return ''
  }
}

export function BookmarksBlock({
  groups,
  settings,
  onEdit,
  onDelete,
}: {
  groups: BookmarkGroup[]
  settings: SettingsShape
  onEdit: () => void
  onDelete: (groupId: string, itemId: string) => void
}) {
  return (
    <Flexbox className="page-pane" direction="vertical" gap={16}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">书签</Text>
        <ActionIcon icon={Plus} title="编辑书签" onClick={onEdit} />
      </Flexbox>
      {groups.length ? (
        <div className="mark-board page-list">
          {groups.map((group) => (
            <section key={group.id}>
              <h3>{group.name}</h3>
              <div className="mark-grid">
                {group.items.map((item) => (
                  <Flexbox key={item.id} direction="horizontal" align="center" gap={4} className="mark-cell" width="100%">
                    <A href={item.url} target="_blank" rel="noreferrer noopener">
                      {settings.showFavicons && favicon(item.url) ? (
                        <img src={favicon(item.url)} alt="" width={16} height={16} />
                      ) : null}
                      {item.name}
                    </A>
                    <ActionIcon icon={Trash2} size="small" title="删除" onClick={() => onDelete(group.id, item.id)} />
                  </Flexbox>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="还没有书签" action={<Button onClick={onEdit}>去添加</Button>} />
      )}
    </Flexbox>
  )
}

export function TaskBlock({
  todos,
  onTodos,
}: {
  todos: Todo[]
  onTodos: (next: Todo[] | ((prev: Todo[]) => Todo[])) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const text = draft.trim()
    if (!text) return
    onTodos((prev) => [{ id: Math.random().toString(36).slice(2, 10), text, done: false, createdAt: Date.now() }, ...prev])
    setDraft('')
  }

  return (
    <Flexbox className="page-pane" direction="vertical" gap={10}>
      <Input
        size="large"
        placeholder="添一件待办，回车确认"
        value={draft}
        prefix={<Plus size={14} />}
        onValueChange={setDraft}
        onPressEnter={add}
        suffix={
          <Button size="small" type="primary" disabled={!draft.trim()} onClick={add}>
            添加
          </Button>
        }
      />
      {todos.length ? (
        <List
          className="page-list"
          variant="borderless"
          items={todos.map((todo) => ({
            key: todo.id,
            label: todo.text,
            className: todo.done ? 'is-done' : undefined,
            extra: (
              <Flexbox direction="horizontal" gap={4}>
                <ActionIcon
                  icon={Check}
                  size="small"
                  title={todo.done ? '标成未完成' : '完成'}
                  active={todo.done}
                  onClick={() => onTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))}
                />
                <ActionIcon icon={Trash2} size="small" title="删除" onClick={() => onTodos((prev) => prev.filter((t) => t.id !== todo.id))} />
              </Flexbox>
            ),
          }))}
        />
      ) : (
        <Empty title="今天还没有安排" description="让 AI+ 帮你记一件，或者说一声。" />
      )}
    </Flexbox>
  )
}

export function NoteBlock({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Text as="h2">便签</Text>
      <TextArea
        className="note-area"
        value={value}
        placeholder="随手记下什么，AI 也可以往这里写。"
        autoSize={{ minRows: 8, maxRows: 18 }}
        onChange={(e) => onChange(e.target.value)}
      />
    </Flexbox>
  )
}

export function HotBlock({
  boards,
  loading,
  error,
  onRefresh,
}: {
  boards: HotBoard[]
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">热榜</Text>
        <ActionIcon icon={RefreshCw} title="刷新" loading={loading} spin={loading} onClick={onRefresh} />
      </Flexbox>
      {error && <Text type="danger">{error}</Text>}
      {boards.length ? (
        <div className="hot-grid page-list">
          {boards.map((board) => (
            <section key={board.id}>
              <h3>{board.name}</h3>
              {board.items.length ? (
                <ol>
                  {board.items.map((item, index) => (
                    <li key={`${item.title}-${index}`}>
                      <A href={item.url || `https://www.bing.com/search?q=${encodeURIComponent(item.title)}`} target="_blank" rel="noreferrer noopener">
                        {item.title}
                      </A>
                      {item.heat && <span>{item.heat}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <Text type="secondary">{board.error || (loading ? '正在读取' : '暂无')}</Text>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty title={loading ? '正在读取热榜' : error || '还没有选择榜单'} description="到设置里勾选要看的榜。" />
      )}
    </Flexbox>
  )
}
