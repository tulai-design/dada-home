import {ActionIcon, A, Empty, Flexbox, Text} from '@lobehub/ui'
import {RefreshCw} from 'lucide-react'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import {DEFAULT_HOT_BOARDS, fetchBoards, type HotBoard} from '../lib/hot'

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
