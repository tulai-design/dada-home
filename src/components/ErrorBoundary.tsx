import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@lobehub/ui'
import {ArrowCounterClockwise as RotateCcw} from '@phosphor-icons/react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** 单个模块崩了不该把整张报纸变成空白。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[搭搭] 渲染出错', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sheet">
          <div className="rule-double" style={{ marginTop: 40 }} />
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, marginTop: 24 }}>
            这一版出了点问题，刷新一下就能重排。
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-faint)' }}>
            {this.state.error.message}
          </p>
          <Button type="primary" icon={<RotateCcw size={14} />} onClick={() => this.setState({ error: null })}>
            重新尝试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
