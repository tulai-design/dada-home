import {createContext, useContext, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

export const ShellPorts = createContext<{navigation: HTMLElement | null; canvas: HTMLElement | null}>({navigation: null, canvas: null})
/** 仅可信内置 Adapter 消费；目标只限宿主固定锚点。 */
export function ShellPort({place, children}: {place: 'navigation' | 'canvas'; children: ReactNode}) {
  const target = useContext(ShellPorts)[place]
  return target ? createPortal(children, target) : null
}
