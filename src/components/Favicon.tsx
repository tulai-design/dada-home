import {useState} from 'react'

/**
 * 站点图标：直接取站点自己的 /favicon.ico（不经过第三方，也不把你的书签域名发给谁）。
 * 关了图标、地址不对或加载失败时，用名字的首字代替，保证版面对齐。
 */
export function Favicon({url, name, size = 16, enabled = true}: {url: string; name: string; size?: number; enabled?: boolean}) {
  const [failed, setFailed] = useState(false)
  let src = ''
  try {
    src = new URL('/favicon.ico', url).href
  } catch {
    /* 地址不合法就走首字 */
  }
  if (enabled && src && !failed) {
    return <img className="favicon" src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
  }
  return (
    <b className="favicon-letter" style={{width: size, height: size, fontSize: Math.round(size * 0.62)}}>
      {Array.from(name.trim())[0]?.toUpperCase() ?? '·'}
    </b>
  )
}
