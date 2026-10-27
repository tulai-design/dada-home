import { Component, type ReactNode } from 'react'
import {ActionIcon} from '@lobehub/ui'
import {AppWindow} from '@phosphor-icons/react'
import { getDefinition, type ComponentHost } from '../lib/registry'
import type { GeneratedApplication, StatusItem } from '../lib/workspace'
import type {Workspace} from '../lib/workspace'
import {applicationInstance} from '../lib/applications'
import {WidgetBoundary} from './WidgetBoundary'

/** 单项出错只让自己消失，不影响顶栏其他内容。 */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * 状态条：顶栏右侧的一排实时小组件。
 * 每一项就是某个组件的「状态条形态」（注册时的 status），配置和页面里的同类组件同一套。
 */
export function StatusBar({
  items,
  host,
  onConfig,
  applications = [],
  onApplication,
  workspace,
  activeApplicationIds = [],
}: {
  items: StatusItem[]
  host: ComponentHost
  onConfig: (id: string, patch: Record<string, unknown>) => void
  applications?: GeneratedApplication[]
  onApplication?: (id: string) => void
  workspace?: Workspace
  activeApplicationIds?: string[]
}) {
  return (
    <div className="status-bar">
      {items.map((item) => {
        const definition = getDefinition(item.type)
        const View = definition?.status
        if (!View) return null
        return (
          <Quiet key={item.id}>
            <View
              instance={{ id: item.id, type: item.type, config: item.config }}
              config={item.config as never}
              updateConfig={(patch) => onConfig(item.id, patch as Record<string, unknown>)}
              host={host}
            />
          </Quiet>
        )
      })}
      {applications.filter((application) => application.status).map((application) => {
        const name = application.instance.title || '应用'
        const compact = workspace && application.statusMode === 'compact' && !activeApplicationIds.includes(application.id)
        const definition = getDefinition(application.instance.type)
        const instance = compact ? applicationInstance(workspace, application.id, 'status') : undefined
        return <div key={application.id} className="application-status" data-compact={compact || undefined}>
          {instance && definition ? <WidgetBoundary label={name}><definition.component instance={instance} config={instance.config} host={host} updateConfig={(patch) => onConfig(instance.id,patch)}/></WidgetBoundary> : null}
          <ActionIcon icon={AppWindow} title={name} aria-label={`打开应用：${name}`} size="small" onClick={() => onApplication?.(application.id)} />
        </div>
      })}
    </div>
  )
}
