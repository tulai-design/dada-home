import {useMemo, useSyncExternalStore} from 'react'
import {normalizeParams, type FxDef} from './catalog'
import {FX_THEME_TOKENS, resolveFxTheme} from './theme'

const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']})
  return () => observer.disconnect()
}
const snapshot = () => {
  const root = document.documentElement
  return `${root.dataset.theme ?? ''}\n${root.getAttribute('style') ?? ''}\n${root.className}`
}

/** Resolve browser CSS colors to concrete shader-safe values, without touching saved configuration. */
function concreteColor(value: string, context: CanvasRenderingContext2D | null): string {
  if (!context || !CSS.supports('color', value)) return value
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return a === 255 ? `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}` : `rgba(${r},${g},${b},${a / 255})`
}

export function useFxThemeParams(def: FxDef | undefined, raw: unknown) {
  const revision = useSyncExternalStore(subscribe, snapshot, () => '')
  const theme = useMemo(() => {
    const dark = document.documentElement.dataset.theme === 'dark'
    const style = getComputedStyle(document.documentElement)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', {willReadFrequently: true})
    const colors = Object.fromEntries(FX_THEME_TOKENS.map((key) => [key, concreteColor(style.getPropertyValue(`--${key}`).trim(), context)]))
    return {dark, colors, context}
  }, [revision])
  return useMemo(() => {
    if (!def) return {params: {}, dark: theme.dark, palette: false, colorOverrides: [] as string[]}
    const normalized = normalizeParams(def, raw)
    const params = resolveFxTheme(def, normalized, theme)
    const palette = normalized.palette === 'theme'
    const branch = normalized[theme.dark ? 'dark' : 'light'] as Record<string, unknown> | undefined
    const colorOverrides = Object.keys(def.params).filter((key) => (def.params[key].t === 'color' || def.params[key].t === 'colors') && (palette || branch && key in branch))
    for (const [key, spec] of Object.entries(def.params)) {
      // Preserve legacy literal identity used by the ink adapter; LiquidChrome alone cannot read HSL.
      if (!colorOverrides.includes(key) && def.id !== 'liquid-chrome') continue
      if (spec.t === 'color' && typeof params[key] === 'string') params[key] = concreteColor(params[key] as string, theme.context)
      if (spec.t === 'colors' && Array.isArray(params[key])) params[key] = (params[key] as string[]).map((value) => concreteColor(value, theme.context))
    }
    return {params, dark: theme.dark, palette, colorOverrides}
  }, [def, raw, theme])
}
