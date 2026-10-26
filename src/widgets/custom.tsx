import {A, Empty, Flexbox, Text} from '@lobehub/ui'
import type {ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import {bind, checkUrl, pick, asText, resolveItems, type UrlCheck} from '../lib/customWidget'
import {proxied} from '../lib/rss'
import type {CustomWidget} from '../lib/workspace'

/**
 * 自定义组件渲染器。
 *
 * AI 创建的组件没有独立代码，都由这一个渲染器解释规格。
 * 它只做四件事：按 source 取数、按 path 取字段、按 layout 摆位置、按 look 上样式。
 */

type Loaded =
  | {ok: true; items: Record<string, unknown>[]}
  | {ok: false; reason: string}

/** 取数：静态直接用，接口走共享资源层（同地址只请求一次）。 */
function useWidgetData(widget: CustomWidget, grants: readonly string[], proxy: string): {
  items: Record<string, unknown>[]
  loading: boolean
  error: string
  needsGrant?: string
  refresh: () => void
} {
  const source = widget.source
  const isHttp = source.kind === 'http'
  const url = isHttp ? source.url : ''
  const check: UrlCheck = isHttp ? checkUrl(url) : {ok: false, reason: '静态数据'}
  const granted = check.ok && grants.includes(check.host)

  // 代理和授权变化后重新取数；静态数据不存进远程共享缓存。
  const key = isHttp ? JSON.stringify(['custom', url, source.path ?? '', proxy, granted]) : 'custom|inactive'

  const resource = useResource<Loaded>(
    key,
    async (): Promise<Loaded> => {
      if (source.kind === 'static') return {ok: true, items: []}
      if (!check.ok) return {ok: false, reason: check.reason}
      if (!granted) return {ok: false, reason: '这个地址还没有授权'}

      const target = proxied(check.url, proxy)
      let response: Response
      try {
        response = await fetch(target, {headers: {accept: 'application/json'}})
      } catch (cause) {
        return {ok: false, reason: `请求失败：${cause instanceof Error ? cause.message : String(cause)}`}
      }
      if (!response.ok) return {ok: false, reason: `接口返回 ${response.status}`}
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return {ok: false, reason: '返回的不是 JSON'}
      }
      return {ok: true, items: resolveItems(body, source.path)}
    },
    {
      every: isHttp ? source.every : undefined,
      enabled: isHttp && check.ok && granted,
    },
  )

  // 保持 hook 调用顺序一致，同时让静态内容随工作空间编辑立即更新。
  if (source.kind === 'static') {
    return {items: source.items, loading: false, error: '', refresh: () => {}}
  }
  if (!check.ok) {
    return {items: [], loading: false, error: check.reason, refresh: () => {}}
  }
  if (!granted) {
    return {items: [], loading: false, error: '', needsGrant: check.host, refresh: () => {}}
  }

  const state = resource.data
  return {
    items: state?.ok ? state.items : [],
    loading: resource.loading,
    error: state && !state.ok ? state.reason : resource.error,
    refresh: () => void resource.refresh(),
  }
}

export function CustomWidgetView({
  widget,
  host,
}: {
  widget: CustomWidget
  host: ComponentProps['host']
}) {
  const {items, loading, error, needsGrant, refresh} = useWidgetData(widget, host.networkGrants, host.proxy)
  const limit = widget.options?.limit ?? 0
  const shown = limit > 0 ? items.slice(0, limit) : items

  // art 布局只画 SVG，不读数据，也不该受取数状态影响
  if (widget.layout === 'art') {
    return (
      <div className="page-pane custom-art">
        {widget.svg ? (
          // svg 已在写入时经 sanitizeSvg 白名单过滤，这里只负责挂上
          <div className="custom-art-frame" dangerouslySetInnerHTML={{__html: widget.svg}} />
        ) : (
          <Empty title="这个图形还是空的" />
        )}
      </div>
    )
  }

  if (needsGrant) {
    return (
      <Flexbox className="page-pane" gap={8}>
        <Text strong>{widget.name}</Text>
        <Text type="secondary" fontSize={12}>
          需要访问 {needsGrant}，还没有授权。
        </Text>
        <A onClick={() => void host.requestNetworkGrant(needsGrant)}>允许访问</A>
      </Flexbox>
    )
  }

  if (error) {
    return (
      <Flexbox className="page-pane" gap={8}>
        <Text strong>{widget.name}</Text>
        <Text type="danger" fontSize={12}>
          {error}
        </Text>
        <A onClick={refresh}>重试</A>
      </Flexbox>
    )
  }

  if (!shown.length) {
    return <Empty title={loading ? '正在读取' : widget.emptyText || '没有数据'} />
  }

  return (
    <Flexbox className="page-pane custom-widget" direction="vertical" gap={8} data-layout={widget.layout}>
      <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
        <Text as="h2">{widget.name}</Text>
        {widget.source.kind === 'http' && <A onClick={refresh} className="custom-refresh">刷新</A>}
      </Flexbox>
      {renderBody(widget, shown)}
    </Flexbox>
  )
}

function renderBody(widget: CustomWidget, items: Record<string, unknown>[]) {
  const numbered = widget.options?.numbered ?? false

  switch (widget.layout) {
    case 'list':
      return (
        <ol className="hot-grid page-list custom-list">
          {items.map((item, index) => (
            <li key={index}>
              {numbered && <span className="custom-index">{index + 1}</span>}
              <ItemTitle widget={widget} item={item} />
              {widget.item.meta && <span className="custom-meta">{bind(item, widget.item.meta)}</span>}
              {widget.item.subtitle && <p className="custom-sub">{bind(item, widget.item.subtitle)}</p>}
            </li>
          ))}
        </ol>
      )

    case 'cards':
      return (
        <div className="feed-grid page-list">
          {items.map((item, index) => (
            <div key={index} className="feed-card custom-card">
              <ItemTitle widget={widget} item={item} />
              {widget.item.subtitle && <p>{bind(item, widget.item.subtitle)}</p>}
              {widget.item.meta && (
                <Text type="secondary" fontSize={11}>
                  {bind(item, widget.item.meta)}
                </Text>
              )}
            </div>
          ))}
        </div>
      )

    case 'stats':
      return (
        <div className="custom-stats">
          {items.map((item, index) => (
            <div key={index} className="custom-stat">
              <span className="custom-stat-value">{bind(item, widget.item.title)}</span>
              {widget.item.subtitle && <span className="custom-stat-label">{bind(item, widget.item.subtitle)}</span>}
              {widget.item.meta && <span className="custom-stat-meta">{bind(item, widget.item.meta)}</span>}
            </div>
          ))}
        </div>
      )

    case 'links':
      return (
        <div className="mark-grid custom-links">
          {items.map((item, index) => (
            <ItemTitle key={index} widget={widget} item={item} />
          ))}
        </div>
      )

    case 'text':
      return (
        <div className="custom-text">
          {items.map((item, index) => (
            <p key={index}>
              {bind(item, widget.item.title)}
              {widget.item.subtitle && <span className="custom-sub-inline">{bind(item, widget.item.subtitle)}</span>}
            </p>
          ))}
        </div>
      )
  }
}
/** 主文本；声明了 link 字段就渲染成外链。 */
function ItemTitle({widget, item}: {widget: CustomWidget; item: Record<string, unknown>}) {
  const label = bind(item, widget.item.title)
  const href = widget.item.link ? asText(pick(item, widget.item.link.path)) : ''
  if (href && /^https?:\/\//i.test(href)) {
    return (
      <A href={href} target="_blank" rel="noreferrer noopener">
        {label}
      </A>
    )
  }
  return <span>{label}</span>
}

/** 给注册表用的轻量包装：把实例配置里的 widgetId 映射到规格。 */
export function customWidgetDefinition(widget: CustomWidget) {
  return {
    type: `custom:${widget.id}` as const,
    name: widget.name,
    description: widget.description || `自定义组件：${widget.name}`,
    category: 'content' as const,
    defaultConfig: {},
    configSchema: {},
    defaultSpan: (widget.layout === 'cards' || widget.layout === 'stats' ? 'full' : 'half') as 'full' | 'half',
    multiple: true,
  }
}

/** 未注册或被删除的自定义组件，给一个明确的占位。 */
export function MissingWidget({id}: {id: string}) {
  return <Empty title="这个自定义组件已不存在" description={`找不到 custom:${id} 的定义。`} />
}
