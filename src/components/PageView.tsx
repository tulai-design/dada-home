import {Empty} from '@lobehub/ui'
import {useId, type ReactNode} from 'react'
import {getDefinition} from '../lib/registry'
import type {ComponentHost, ComponentDefinition} from '../lib/registry'
import {isCustomType, SPAN_COLUMNS, type Page, type Workspace} from '../lib/workspace'
import {WidgetBoundary} from './WidgetBoundary'
import {CustomWidgetView} from '../widgets/custom'
import {applicationInstance, listApplications} from '../lib/applications'
import {ApplicationInUse} from './ApplicationHost'
import {planPageSections} from '../lib/pageSectionLayout'
import {sanitizeCss} from '../lib/customWidget'

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
  suspendedApplicationId,
  onResumeApplication,
  renderPreview,
}: {
  page: Page
  workspace: Workspace
  host: ComponentHost
  onUpdateConfig: (instanceId: string, patch: Record<string, unknown>) => void
  onRemove: (instanceId: string) => void
  suspendedApplicationId?: string
  onResumeApplication?: () => void
  /** Preview supplies inert content; no business component or runtime is mounted. */
  renderPreview?: (instance: Page['components'][number], label: string) => ReactNode
}) {
  const pageStyleId = useId()
  const layout = workspace.layout
  const scope = `.page-grid[data-page-style="${pageStyleId}"]`
  const cssFor = (value: string | undefined) => {
    if (!value || !renderPreview) return value
    // Preview never loads CSS resources; escaped function names must not bypass this check.
    if (/\\|@|(?:url|image(?:-set)?|cross-fade|paint|src)\s*\(/i.test(value)) return undefined
    const result = sanitizeCss(value)
    return result.ok ? result.css : undefined
  }
  const pageCss = cssFor(page.css)
  const sectioned = Boolean(page.sections?.length)
  const columnCount = sectioned ? 12 : layout.columns
  const columnsOf = (instance: Page['components'][number]) => {
    const span = instance.span ?? resolveDefinition(instance.type).definition?.defaultSpan ?? 'half'
    return Math.min(columnCount, Math.round(((SPAN_COLUMNS[span] ?? 12) / 12) * columnCount))
  }
  if (!page.components.length) {
    return <Empty title="这一页还是空的" description="告诉搭搭你想放什么，或者从「添加组件」里挑。" />
  }

  // 页面里只有一个舞台型组件：居中展示，其余走普通栅格
  const only = !sectioned && page.components.length === 1 ? page.components[0] : undefined
  const stage = only && !isCustomType(only.type) ? getDefinition(only.type as never)?.stage : undefined
  const applications = listApplications(workspace)
  const entries = planPageSections(page, columnsOf)

  return (
    <div
      className="page-grid"
      data-page-style={pageStyleId}
      data-align={sectioned ? 'start' : page.align ?? 'start'}
      data-stage={stage ? '' : undefined}
      data-sections={sectioned ? '' : undefined}
      data-preview-style-skipped={renderPreview && page.css && !pageCss ? true : undefined}
      style={{['--cols' as string]: columnCount, maxWidth: layout.maxWidth, ...(stage ? {['--stage-width' as string]: `${stage.width}px`} : {})}}
    >
      {pageCss && <style>{`${scope}{${pageCss}}`}</style>}
      {entries.map((entry) => {
        const position = {['--section-row' as string]: entry.row, ['--section-column' as string]: entry.column}
        if (entry.type === 'heading') return <h2 key={`section:${entry.sectionId}`} className="page-section-heading" data-section-id={entry.sectionId} data-section-kind={entry.kind} data-section-align={entry.align} data-section-start={entry.start || undefined} style={position}>{entry.title}</h2>
        const placed = entry.instance
        const application = applications.find((item) => item.id === placed.id)
        const instance = application ? {...applicationInstance(workspace, application.id, 'widget'), span: placed.span, look: placed.look} : placed
        const {definition, customId} = resolveDefinition(instance.type)
        const custom = customId ? workspace.widgets.find((w) => w.id === customId) : undefined
        const label = instance.title || definition?.name || custom?.name || instance.type
        const columns = columnsOf(instance)
        const look = instance.look ?? {}
        const widgetCss = cssFor(look.css)

        // 自定义组件和内置组件走同一个容器，只是内容由规格解释
        const content = renderPreview ? renderPreview(instance, label) : application && application.id === suspendedApplicationId ? (
          <ApplicationInUse name={label} onOpen={() => onResumeApplication?.()} />
        ) : custom ? (
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
            key={`widget:${instance.id}`}
            className="widget"
            data-type={instance.type}
            data-id={instance.id}
            data-preview-style-skipped={renderPreview && look.css && !widgetCss ? true : undefined}
            data-section-id={entry.sectionId}
            data-section-kind={entry.kind}
            data-section-align={entry.align}
            data-section-start={entry.start || undefined}
            data-variant={look.variant ?? 'card'}
            data-tone={look.tone ?? 'neutral'}
            data-title-size={look.titleSize ?? 'md'}
            data-animation={look.animation && look.animation !== 'none' ? look.animation : undefined}
            style={{gridColumn: `span ${columns}`, ...position}}
          >
            {/* 组件自定义 CSS 只作用于这一块：按 data-id 限定，不写选择器 */}
            {widgetCss && <style>{`${scope} > .widget[data-id=${JSON.stringify(instance.id)}]{${widgetCss}}`}</style>}
            {renderPreview ? content : <WidgetBoundary label={label} onRemove={() => onRemove(instance.id)}>
              {content}
            </WidgetBoundary>}
          </div>
        )
      })}
    </div>
  )
}
