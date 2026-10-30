import type {IframeHTMLAttributes} from 'react'
import {isExtension} from './platform'

/** Web 直接使用 srcdoc；MV3 先加载 manifest 声明的隔离页，再传入同一文档。 */
export function sandboxFrameProps(document: string, session: string, onLoad?: () => void): Pick<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'srcDoc' | 'onLoad'> {
  if (!isExtension()) return {srcDoc: document, onLoad}
  return {
    src: new URL('/sandbox.html', window.location.href).href,
    onLoad(event) {
      event.currentTarget.contentWindow?.postMessage({dadaSandbox: 1, session, document}, '*')
      onLoad?.()
    },
  }
}
