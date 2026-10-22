import {Empty} from '@lobehub/ui'
import {getDefinition} from '../lib/registry'
import type {ComponentHost} from '../lib/registry'
import {SPAN_COLUMNS, type LayoutConfig, type Page} from '../lib/workspace'
import {WidgetBoundary} from './WidgetBoundary'

/**
 * 页面渲染器：把一个 Page 的组件实例铺成栅格。
 *
 * 它是「数据 → 界面」的唯一通道。页面里不再有任何写死的卡片：
 * 要改界面，就改工作空间数据，这里自然会跟着变。
 */
export function PageView({
  page,
  layout,
  host,
  onUpdateConfig,
  onRemove,
}: {
  page: Page
  layout: LayoutConfig
  host: ComponentHost
  onUpdateConfig: (instanceId: string, patch: Record<string, unknown>) => void
  onRemove: (instanceId: string) => void
}) {
  if (!page.components.length) {
    return <Empty title="这一页还是空的" description="告诉搭搭你想放什么，或者从「添加组件」里挑。" />
  }

  return (
    <div className="page-grid" style={{['--cols' as string]: layout.columns, maxWidth: layout.maxWidth}}>
      {page.components.map((instance) => {
        const definition = getDefinition(instance.type)
        const label = instance.title || definition?.name || instance.type
        if (!definition) {
          return (
            <div key={instance.id} className="widget" style={{gridColumn: `span ${layout.columns}`}}>
              <Empty title={`未知组件：${instance.type}`} description="这个组件已不再提供，可以移除。" />
            </div>
          )
        }
        const Widget = definition.component
        const columns = Math.min(layout.columns, Math.round(((SPAN_COLUMNS[instance.span ?? definition.defaultSpan] ?? 12) / 12) * layout.columns))
        return (
          <div key={instance.id} className="widget" data-type={instance.type} data-id={instance.id} style={{gridColumn: `span ${columns}`}}>
            <WidgetBoundary label={label} onRemove={() => onRemove(instance.id)}>
              <Widget
                instance={instance}
                config={instance.config}
                host={host}
                updateConfig={(patch) => onUpdateConfig(instance.id, patch)}
              />
            </WidgetBoundary>
          </div>
        )
      })}
    </div>
  )
}
