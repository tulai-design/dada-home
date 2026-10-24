import { Component, type ReactNode } from 'react'
import { getDefinition, type ComponentHost } from '../lib/registry'
import type { StatusItem } from '../lib/workspace'

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
}: {
  items: StatusItem[]
  host: ComponentHost
  onConfig: (id: string, patch: Record<string, unknown>) => void
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
    </div>
  )
}
