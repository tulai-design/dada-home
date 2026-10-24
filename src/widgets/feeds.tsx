import {useMemo, useState} from 'react'
import {ActionIcon, Block, Button, Empty, Flexbox, Switch, Tag, Text} from '@lobehub/ui'
import {Plus, ArrowsClockwise as RefreshCw, Rss, Trash as Trash2} from '@phosphor-icons/react'
import {registerApp, useAppSettings} from '../lib/apps'
import {Group, Row, TextRow} from '../components/ios'
import {uid} from '../lib/store'
import {useComponentData, SHARED} from '../lib/componentData'
import {relativeTime} from '../lib/date'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import {fetchAllFeeds} from '../lib/rss'
import type {Article, Feed} from '../lib/types'

const TAG_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan', 'geekblue', 'magenta'] as const

function tagColor(source: string) {
  let hash = 0
  for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

type FeedsConfig = {
  heading: string
  limit: number
  /** 只显示标题，不显示摘要 */
  compact: boolean
  /** 只显示未读 */
  unreadOnly: boolean
}

function Feeds({config, host}: ComponentProps<FeedsConfig>) {
  // 订阅源列表是共享的：所有订阅卡片读同一份
  const [feeds] = useComponentData<Feed[]>(SHARED.feeds, [])
  const [filter, setFilter] = useState('__all')


  const key = `feeds|${host.proxy}|${feeds.filter((f) => f.enabled !== false).map((f) => f.url).join(',')}`
  const resource = useResource<{articles: Article[]; errors: string[]}>(
    key,
    () => fetchAllFeeds(feeds, host.proxy),
    {every: 1_800_000, enabled: feeds.some((f) => f.enabled !== false && f.url)},
  )

  const articles = resource.data?.articles ?? []
  const errors = resource.data?.errors ?? []
  const sources = useMemo(() => Array.from(new Set(articles.map((a) => a.source))), [articles])

  const shown = useMemo(() => {
    let list = filter === '__all' ? articles : articles.filter((a) => a.source === filter)
    if (config.unreadOnly) list = list.filter((a) => !host.readIds.includes(a.id))
    return list.slice(0, config.limit > 0 ? config.limit : undefined)
  }, [articles, filter, config.limit, config.unreadOnly, host.readIds])

  const open = (article: Article) => {
    host.openArticle(article)
    host.markRead(article.id)
  }

  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">{config.heading}</Text>
        <Flexbox direction="horizontal" gap={4}>
          <ActionIcon icon={RefreshCw} title="刷新" loading={resource.loading} spin={resource.loading} onClick={() => void resource.refresh()} />
          <ActionIcon icon={Rss} title="管理订阅源" onClick={() => host.openSettings('feeds')} />
        </Flexbox>
      </Flexbox>

      {!config.compact && sources.length > 1 && (
        <Flexbox direction="horizontal" align="center" gap={8} wrap="wrap" width="100%">
          <Tag color={filter === '__all' ? 'red' : 'gray'} variant={filter === '__all' ? 'filled' : 'outlined'} style={{cursor: 'pointer'}} onClick={() => setFilter('__all')}>
            全部 {articles.length}
          </Tag>
          {sources.slice(0, 8).map((source) => (
            <Tag
              key={source}
              color={filter === source ? tagColor(source) : 'gray'}
              variant={filter === source ? 'filled' : 'outlined'}
              style={{cursor: 'pointer'}}
              onClick={() => setFilter(source)}
            >
              {source.length > 14 ? `${source.slice(0, 14)}…` : source}
            </Tag>
          ))}
        </Flexbox>
      )}

      {errors[0] && (
        <Text type="danger">
          {errors[0]}
          {errors.length > 1 ? ` 等 ${errors.length} 个源失败` : ''}
        </Text>
      )}

      {shown.length ? (
        <div className={config.compact ? 'home-digest' : 'feed-grid page-list'}>
          {shown.map((article) =>
            config.compact ? (
              <Button key={article.id} type="text" block onClick={() => open(article)}>
                <span className="digest-source">
                  <b style={{color: `var(--c-${tagColor(article.source)}, var(--main))`}}>●</b> {article.source}
                  <i>{relativeTime(article.date)}</i>
                </span>
                <span className="digest-title">{article.title}</span>
              </Button>
            ) : (
              <Block
                key={article.id}
                clickable
                variant="borderless"
                className={`feed-card${host.readIds.includes(article.id) ? ' is-read' : ''}`}
                onClick={() => open(article)}
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
            ),
          )}
        </div>
      ) : (
        <Empty title={resource.loading ? '正在收取订阅' : '暂时没有内容'} description="换个源，或稍后再刷新。" />
      )}
    </Flexbox>
  )
}

registerComponent<FeedsConfig>({
  type: 'feeds',
  name: '订阅',
  description: '展示 RSS 订阅的文章列表，可切换来源筛选。订阅源在设置里统一管理，多个订阅卡片共用同一批源。',
  category: 'content',
  defaultConfig: {heading: '订阅', limit: 40, compact: false, unreadOnly: false},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    limit: {kind: 'number', label: '最多显示条数', min: 1, max: 200},
    compact: {kind: 'boolean', label: '紧凑模式', description: '只显示标题，适合放在首页侧栏'},
    unreadOnly: {kind: 'boolean', label: '只看未读'},
  },
  defaultSpan: 'full',
  component: Feeds,
  multiple: true,
})


/* ---------- 应用设置：订阅 ---------- */

function FeedSettings() {
  const {feeds, setFeeds} = useAppSettings()
  const patchFeed = (id: string, part: Partial<Feed>) => setFeeds(feeds.map((f) => (f.id === id ? {...f, ...part} : f)))

  return (
    <>
      <Group title={`订阅源 · ${feeds.length} 个`} footer="支持 RSS / Atom。跨域取数走「网络」里设置的代理。">
        <Row
          label="添加订阅源"
          icon={<Plus size={16} />}
          onClick={() => setFeeds([...feeds, {id: uid(), title: '新的订阅', url: '', enabled: true}])}
        />
      </Group>
      {feeds.map((feed) => (
        <Group key={feed.id}>
          <TextRow label="名称" value={feed.title} onChange={(v) => patchFeed(feed.id, {title: v})} />
          <TextRow label="地址" value={feed.url} placeholder="https://example.com/feed.xml" onChange={(v) => patchFeed(feed.id, {url: v})} />
          <Row label="启用">
            <Switch checked={feed.enabled !== false} onChange={(v) => patchFeed(feed.id, {enabled: v})} />
          </Row>
          <Row label="删除这个订阅源" icon={<Trash2 size={16} />} danger onClick={() => setFeeds(feeds.filter((f) => f.id !== feed.id))} />
        </Group>
      ))}
    </>
  )
}

registerApp({
  id: 'feeds',
  name: '订阅',
  icon: Rss,
  color: '#ff9f0a',
  description: '管理要阅读的订阅源。阅读器会按这里的开关取数。',
  summary: (ctx) => `${ctx.feeds.filter((f) => f.enabled !== false).length} 个源`,
  Panel: FeedSettings,
})
