import {Component, Suspense, useSyncExternalStore, type ErrorInfo, type ReactNode} from 'react'
import ClickSpark from './vendor/ClickSpark'
import {getFx, normalizeParams} from './catalog'
import {VIEWS} from './views'
import type {Layer} from '../lib/workspace'

/** 当前是否暗色主题。读 <html data-theme>，主题一变就重渲。 */
export function useDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify)
      observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
      return () => observer.disconnect()
    },
    () => document.documentElement.dataset.theme === 'dark',
    () => false,
  )
}

/**
 * 特效是装饰：它出错（WebGL 不可用、网络加载失败）时不该影响页面内容，
 * 所以静默吞掉，只在控制台留一条记录。
 */
class Quiet extends Component<{id: string; children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() {
    return {failed: true}
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[特效出错] ${this.props.id}`, error, info.componentStack)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** 渲染一个素材。参数在这里再校验一遍，防止绕过 ops 写进来的脏数据。 */
export function FxEffect({id, text = '', params}: {id: string; text?: string; params?: Record<string, unknown>}) {
  const dark = useDark()
  const def = getFx(id)
  const View = VIEWS[id]
  if (!def || !View) return null
  return (
    <Quiet id={id}>
      <Suspense fallback={null}>
        <View text={text} p={normalizeParams(def, params)} dark={dark} />
      </Suspense>
    </Quiet>
  )
}

/**
 * 页面图层容器。
 *
 * 背景类图层铺在内容之后；胶片颗粒铺在内容之上但不挡点击；
 * 点击火花需要包住整页才能监听点击，所以是个外壳。
 */
export function FxLayers({layers, children}: {layers?: Layer[]; children: ReactNode}) {
  const list = layers ?? []
  const defs = list.map((layer) => ({layer, def: getFx(layer.effect)})).filter((item) => item.def)
  const behind = defs.filter(({def}) => def!.kind === 'background' || def!.kind === 'scene')
  const above = defs.filter(({def}) => def!.id === 'noise')
  const spark = defs.find(({def}) => def!.id === 'click-spark')

  const body = (
    <>
      {behind.length > 0 && (
        <div className="fx-layers" aria-hidden="true">
          {behind.map(({layer}, index) => (
            <div className="fx-layer" key={`${layer.effect}-${index}`}>
              <FxEffect id={layer.effect} params={layer.params} />
            </div>
          ))}
        </div>
      )}
      {children}
      {above.map(({layer}, index) => (
        <div className="fx-overlay" key={`${layer.effect}-${index}`} aria-hidden="true">
          <FxEffect id={layer.effect} params={layer.params} />
        </div>
      ))}
    </>
  )

  if (!spark) return body
  const sparkParams = normalizeParams(spark.def!, spark.layer.params)
  return <ClickSpark {...(sparkParams as object)}>{body}</ClickSpark>
}
