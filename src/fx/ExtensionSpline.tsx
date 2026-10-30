import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {isSplineUrl} from './catalog'

/** Spline 的编译器和 Worker 只在扩展隔离页运行，宿主页仍保持 MV3 CSP。 */
export default function ExtensionSpline({scene, style}: {scene: string; style?: CSSProperties}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [failure, setFailure] = useState<Error>()
  const [session] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.dadaSpline !== 1 || event.data?.session !== session) return
      if (event.data.kind === 'error') setFailure(new Error(String(event.data.message || 'Spline 场景加载失败').slice(0, 500)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [session])
  if (failure) throw failure
  if (!isSplineUrl(scene)) throw new Error('Spline 场景地址无效')
  return <iframe
    key={scene}
    ref={frame}
    title="Spline 3D 场景"
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    src={new URL('/spline.html', window.location.href).href}
    style={{border: 0, display: 'block', ...style}}
    onLoad={() => frame.current?.contentWindow?.postMessage({dadaSpline: 1, session, kind: 'load', scene}, '*')}
  />
}
