import {useId, useLayoutEffect, useRef, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {ActionIcon} from '@lobehub/ui'
import {X} from '@phosphor-icons/react'

/** 附着业务窗口不使用全局对话框焦点管理；隐藏外壳不会触发关闭或卸载。 */
export function AttachedDrawer({container, hidden = false, navigationRevision = 0, title, width, onClose, children, className = ''}: {container: HTMLElement; hidden?: boolean; navigationRevision?: number; title: string; width: number | string; onClose: () => void; children: ReactNode; className?: string}) {
  const titleId = useId()
  const root = useRef<HTMLElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const hiddenFocus = useRef<{element: HTMLElement; revision: number} | null>(null)
  const opened = useRef(false)
  useLayoutEffect(() => {
    const active = document.activeElement
    const chrome = container.querySelector('.shell-canvas-chrome')
    if (hidden) {
      if (active instanceof HTMLElement && root.current?.contains(active)) {
        hiddenFocus.current = {element: active, revision: navigationRevision}
        const button = [...(chrome?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(element => element.getClientRects().length > 0)
        button?.focus({preventScroll: true})
      }
      return
    }
    if (!opened.current) {
      opened.current = true
      if (active instanceof HTMLElement) previousFocus.current = active
      root.current?.focus({preventScroll: true})
    } else {
      const saved = hiddenFocus.current
      if (saved?.revision === navigationRevision && saved.element.isConnected && (active === document.body || chrome?.contains(active))) saved.element.focus({preventScroll: true})
      hiddenFocus.current = null
    }
  }, [hidden, container, navigationRevision])
  useLayoutEffect(() => () => {
    const previous = previousFocus.current
    if (previous?.isConnected && document.activeElement === document.body) previous.focus({preventScroll: true})
  }, [])
  return createPortal(<div className="attached-drawer-layer" hidden={hidden} inert={hidden || undefined} aria-hidden={hidden || undefined} style={{display: hidden ? 'none' : undefined}}>
    <div className="canvas-overlay-shade" aria-hidden="true" />
    <section ref={root} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby={titleId} className={`attached-drawer canvas-overlay-drawer lobe-drawer ${className}`.trim()} style={{width}} onKeyDown={event => {if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault(); event.stopPropagation(); onClose()}}}>
      <header className="attached-drawer-header"><h2 id={titleId}>{title}</h2><ActionIcon icon={X} title="关闭" aria-label="关闭" onClick={onClose}/></header>
      <div className="attached-drawer-content">{children}</div>
    </section>
  </div>, container)
}
