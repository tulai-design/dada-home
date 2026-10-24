import {lazy, Suspense, type ComponentProps} from 'react'

/**
 * 模型 / 服务商图标，来自 @lobehub/icons。
 * 图标库很大，只在真正要画图标时才加载；加载完成前先占位，布局不跳。
 */
const LazyModel = lazy(() => import('@lobehub/icons/es/features/ModelIcon'))
const LazyProvider = lazy(() => import('@lobehub/icons/es/features/ProviderIcon'))

function Placeholder({size = 16}: {size?: number}) {
  return <span aria-hidden style={{display: 'inline-block', width: size, height: size, flexShrink: 0}} />
}

export function ModelIcon(props: ComponentProps<typeof LazyModel>) {
  return (
    <Suspense fallback={<Placeholder size={props.size} />}>
      <LazyModel {...props} />
    </Suspense>
  )
}

export function ProviderIcon(props: ComponentProps<typeof LazyProvider>) {
  return (
    <Suspense fallback={<Placeholder size={props.size} />}>
      <LazyProvider {...props} />
    </Suspense>
  )
}
