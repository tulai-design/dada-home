import {useEffect, useState} from 'react'
import {ActionIcon, A, Empty, Flexbox, Tag, Text} from '@lobehub/ui'
import {Fire as Flame, ArrowsClockwise as RefreshCw} from '@phosphor-icons/react'
import {registerApp, useAppSettings} from '../lib/apps'
import {Group, Row, TextRow} from '../components/ios'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import {DEFAULT_HOT_BOARDS, HOT_COLUMNS, fetchBoards, fetchSources, type HotBoard, type HotSource} from '../lib/hot'

type HotConfig = {
  heading: string
  /** 要展示的榜单 id，逗号分隔 */
  boards: string
  limit: number
  /** 每个榜最多显示几条 */
  perBoard: number
}

function Hot({config, host}: ComponentProps<HotConfig>) {
  const ids = config.boards
    .split(/[,，\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
  const resource = useResource<HotBoard[]>(
    `hot|${host.hotSource}|${host.proxy}|${ids.join(',')}|${config.perBoard}`,
    () => fetchBoards(host.hotSource, ids, host.proxy, config.perBoard),
    {every: 600_000, enabled: ids.length > 0},
  )
  const boards = resource.data ?? []

  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">{config.heading}</Text>
        <ActionIcon icon={RefreshCw} title="刷新" loading={resource.loading} spin={resource.loading} onClick={() => void resource.refresh()} />
      </Flexbox>
      {resource.error && <Text type="danger">{resource.error}</Text>}
      {boards.length ? (
        <div className="hot-grid page-list">
          {boards.map((board) => (
            <section key={board.id}>
              <h3>{board.name}</h3>
              {board.items.length ? (
                <ol>
                  {board.items.slice(0, config.limit > 0 ? config.limit : undefined).map((item, index) => (
                    <li key={`${item.title}-${index}`}>
                      <A href={item.url || `https://www.bing.com/search?q=${encodeURIComponent(item.title)}`} target="_blank" rel="noreferrer noopener">
                        {item.title}
                      </A>
                      {item.heat && <span>{item.heat}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <Text type="secondary">{board.error || (resource.loading ? '正在读取' : '暂无')}</Text>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title={resource.loading ? '正在读取热榜' : resource.error || '还没有选择榜单'}
          description="在设置里选择榜单，或让搭搭帮你挑。"
        />
      )}
    </Flexbox>
  )
}

registerComponent<HotConfig>({
  type: 'hot',
  name: '热榜',
  description: '展示各平台热榜（知乎、微博、IT之家等）。榜单 id 用逗号分隔，可在配置里指定。',
  category: 'content',
  defaultConfig: {heading: '热榜', boards: DEFAULT_HOT_BOARDS.join(','), limit: 0, perBoard: 16},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    boards: {kind: 'string', label: '榜单 id', placeholder: 'zhihu,weibo,ithome'},
    limit: {kind: 'number', label: '每榜最多显示', description: '0 表示不限', min: 0, max: 50},
    perBoard: {kind: 'number', label: '向服务端请求的条数', min: 1, max: 50},
  },
  defaultSpan: 'full',
  component: Hot,
  multiple: true,
})


/* ---------- 应用设置：热榜 ---------- */

function splitIds(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,，\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
}

function HotSettings() {
  const {settings, patch, instances, updateConfig} = useAppSettings()
  const [sources, setSources] = useState<HotSource[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchSources(settings.hotSource, settings.proxy)
      .then((list) => {
        if (cancelled) return
        setSources(list)
        setError('')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '源列表读取失败')
      })
    return () => {
      cancelled = true
    }
  }, [settings.hotSource, settings.proxy])

  const boards = instances('hot')
  const columns = [...HOT_COLUMNS, {id: '', label: '其他'}]

  return (
    <>
      <Group title="数据来源" footer={error ? <Text type="danger">{error}</Text> : '榜单数据来自 NewsHub 兼容接口。'}>
        <TextRow label="源站" stack value={settings.hotSource} placeholder="https://newshub.shenzjd.com" onChange={(v) => patch({hotSource: v})} />
      </Group>

      {boards.length === 0 && (
        <Group footer="对搭搭说「加一个热榜」，它就会出现在这里。">
          <Row label="还没有热榜组件" />
        </Group>
      )}

      {boards.map((instance) => {
        const chosen = splitIds(instance.config.boards)
        const toggle = (id: string) => {
          const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]
          updateConfig(instance.id, {boards: next.join(',')})
        }
        return (
          <Group key={instance.id} title={`${instance.pageLabel}页的热榜 · 已选 ${chosen.length} 个`}>
            <div className="ios-chips">
              {columns.map((column) => {
                const group = sources.filter((source) => (source.column ?? '') === column.id)
                if (!group.length) return null
                return (
                  <div key={column.id || 'other'} className="ios-chip-block">
                    <span className="ios-chip-label">{column.label}</span>
                    <Flexbox direction="horizontal" gap={6} wrap="wrap">
                      {group.map((source) => {
                        const on = chosen.includes(source.id)
                        return (
                          <Tag key={source.id} color={on ? 'red' : 'gray'} variant={on ? 'filled' : 'outlined'} style={{cursor: 'pointer'}} onClick={() => toggle(source.id)}>
                            {source.name}
                          </Tag>
                        )
                      })}
                    </Flexbox>
                  </div>
                )
              })}
              {!sources.length && !error && <Text type="secondary">读取榜单列表中…</Text>}
            </div>
          </Group>
        )
      })}
    </>
  )
}

registerApp({
  id: 'hot',
  name: '热榜',
  icon: Flame,
  color: '#ff453a',
  description: '选择热榜页要显示哪些榜单，以及榜单数据的来源。',
  summary: (ctx) => {
    const first = ctx.instances('hot')[0]
    return first ? `${splitIds(first.config.boards).length} 个榜` : ''
  },
  Panel: HotSettings,
})
