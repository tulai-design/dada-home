import {useEffect, useRef, useState} from 'react'

/** Measure the visible content container, rather than the applet's hidden runner iframe. */
export function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (value: number) => setWidth(Math.max(0, Math.round(value)))
    const style = getComputedStyle(element)
    update(element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0))
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return {ref, width}
}
