import {Component, type ErrorInfo, type ReactNode} from 'react'
import {Button, Flexbox, Text} from '@lobehub/ui'
import {ArrowCounterClockwise as RotateCcw, Trash as Trash2} from '@phosphor-icons/react'

type Props = {
  /** 出错时展示的组件名，帮用户（和 AI）认出是哪一块。 */
  label: string
  /** 提供时，错误卡片上会出现「移除」按钮，让用户能摆脱一个坏掉的组件。 */
  onRemove?: () => void
  children: ReactNode
}
type State = {error: Error | null}

/**
 * 单个组件的错误边界。
 *
 * 页面由数据驱动，组件配置可能来自 AI 或导入的文件，出错概率比手写页面高。
 * 一块崩了只影响它自己，页面其余部分照常工作。
 */
export class WidgetBoundary extends Component<Props, State> {
  state: State = {error: null}

  static getDerivedStateFromError(error: Error): State {
    return {error}
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[组件出错] ${this.props.label}`, error, info.componentStack)
  }

  render() {
    const {error} = this.state
    if (!error) return this.props.children
    return (
      <Flexbox className="widget-error" gap={6}>
        <Text strong>{this.props.label} 出错了</Text>
        <Text type="secondary" fontSize={12}>
          {error.message}
        </Text>
        <Flexbox direction="horizontal" gap={8}>
          <Button size="small" icon={<RotateCcw size={13} />} onClick={() => this.setState({error: null})}>
            重试
          </Button>
          {this.props.onRemove && (
            <Button size="small" danger icon={<Trash2 size={13} />} onClick={this.props.onRemove}>
              移除这一块
            </Button>
          )}
        </Flexbox>
      </Flexbox>
    )
  }
}
