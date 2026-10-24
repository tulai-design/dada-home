import type {ReactNode} from 'react'

/**
 * 系统页（监控、设置）的统一外框：左上大标题，右上操作区，下面是只在内部滚动的内容。
 * 和普通页面一样占满画布，不再用抽屉。
 */
export function SysPage({title, extra, children}: {title: ReactNode; extra?: ReactNode; children: ReactNode}) {
  return (
    <div className="sys-page">
      <header className="sys-head">
        <h1>{title}</h1>
        <div className="sys-extra">{extra}</div>
      </header>
      <div className="sys-body">{children}</div>
    </div>
  )
}
