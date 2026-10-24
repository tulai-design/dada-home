import {Empty} from '@lobehub/ui'
import {getDefinition} from '../lib/registry'
import type {ComponentHost, ComponentDefinition} from '../lib/registry'
import {isCustomType, SPAN_COLUMNS, type Page, type Workspace} from '../lib/workspace'
import {WidgetBoundary} from './WidgetBoundary'
import {CustomWidgetView} from '../widgets/custom'

/** 自定义组件的定义来自工作空间本身，不是注册表。 */
function resolveDefinition(type: string): {definition: ComponentDefinition | undefined; customId?: string} {
  if (isCustomType(type)) return {definition: undefined, customId: type.slice('custom:'.length)}
  return {definition: getDefinition(type as never)}
}

/**
 * 页面渲染器：把一个 Page 的组件实例铺成栅格。
 *
 * 它是「数据 → 界面」的唯一通道。页面里不再有任何写死的卡片：
 * 要改界面，就改工作空间数据，这里自然会跟着变。
 */
export function PageView({
  page,
  workspace,
  host,
  onUpdateConfig,
  onRemove,
}: {
  page: Page
  workspace: Workspace
  host: ComponentHost
  onUpdateConfig: (instanceId: string, patch: Record<string, unknown>) => void
  onRemove: (instanceId: string) => void
}) {
  const layout = workspace.layout
  if (!page.components.length) {
    return <Empty title="这一页还是空的" description="告诉搭搭你想放什么，或者从「添加组件」里挑。" />
  }

  // 页面里只有一个舞台型组件：居中展示，其余走普通栅格
  const only = page.components.length === 1 ? page.components[0] : undefined
  const stage = only && !isCustomType(only.type) ? getDefinition(only.type as never)?.stage : undefined

  return (
    <div
      className="page-grid"
      data-align={page.align ?? 'start'}
      data-stage={stage ? '' : undefined}
      style={{['--cols' as string]: layout.columns, maxWidth: layout.maxWidth, ...(stage ? {['--stage-width' as string]: `${stage.width}px`} : {})}}
    >
      {page.css && <style>{`.page-grid[data-page-style]{${page.css}}`}</style>}
      {page.components.map((instance) => {
        const {definition, customId} = resolveDefinition(instance.type)
        const custom = customId ? workspace.widgets.find((w) => w.id === customId) : undefined
        const label = instance.title || definition?.name || custom?.name || instance.type
        const span = instance.span ?? definition?.defaultSpan ?? 'half'
        const columns = Math.min(layout.columns, Math.round(((SPAN_COLUMNS[span] ?? 12) / 12) * layout.columns))
        const look = instance.look ?? {}

        // 自定义组件和内置组件走同一个容器，只是内容由规格解释
        const content = custom ? (
          <CustomWidgetView widget={custom} host={host} />
        ) : definition ? (
          <definition.component
            instance={instance}
            config={instance.config}
            host={host}
            updateConfig={(patch) => onUpdateConfig(instance.id, patch)}
          />
        ) : (
          <Empty title={`未知组件：${instance.type}`} description="这个组件已不再提供，可以移除。" />
        )

        return (
          <div
            key={instance.id}
            className="widget"
            data-type={instance.type}
            data-id={instance.id}
            data-variant={look.variant ?? 'card'}
            data-tone={look.tone ?? 'neutral'}
            data-title-size={look.titleSize ?? 'md'}
            data-animation={look.animation && look.animation !== 'none' ? look.animation : undefined}
            style={{gridColumn: `span ${columns}`}}
          >
            {/* 组件自定义 CSS 只作用于这一块：按 data-id 限定，不写选择器 */}
            {look.css && <style>{`[data-id="${instance.id}"]{${look.css}}`}</style>}
            <WidgetBoundary label={label} onRemove={() => onRemove(instance.id)}>
              {content}
            </WidgetBoundary>
          </div>
        )
      })}
    </div>
  )
}
