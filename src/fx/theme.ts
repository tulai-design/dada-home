import type {FxDef} from './catalog'

/** 宿主读取这些变量；本模块只接收具体色值，不访问DOM，也不修改配置。 */
export const FX_THEME_TOKENS = ['text', 'text2', 'text3', 'bg', 'bg2', 'bg3', 'border', 'main', 'c-amber', 'c-blue', 'c-violet'] as const

const PALETTES: Record<string, Record<string, string | string[]>> = {
  aurora: {colorStops: ['main', 'c-amber', 'c-violet']},
  silk: {color: 'bg3', sheenColor: 'text3'},
  beams: {color: 'main', backgroundColor: 'bg'},
  galaxy: {starColors: ['text2', 'main', 'c-blue'], backgroundColor: 'bg'},
  iridescence: {color: 'main'},
  'liquid-chrome': {color: 'text3'},
  orb: {colors: ['main', 'c-amber', 'c-violet']},
  particles: {particleColors: ['text3', 'main']},
  threads: {color: 'text3', accentColor: 'main'},
  waves: {lineColor: 'text3', accentColor: 'main'},
  'dot-grid': {baseColor: 'border', activeColor: 'main'},
  'split-text': {accentColor: 'main'},
  'shiny-text': {color: 'text2', shineColor: 'main'},
  'gradient-text': {colors: ['text', 'main', 'text2']},
  'decrypted-text': {scrambleColor: 'text3'},
  'text-type': {textColors: ['text']},
  'rotating-text': {highlightColor: 'bg3'},
  'fuzzy-text': {gradient: ['text', 'text2']},
  'spotlight-card': {spotlightColor: 'main'},
  'glare-hover': {background: 'bg2', borderColor: 'border', glareColor: 'text3'},
  'click-spark': {sparkColor: ['main']},
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const copy = (value: unknown): unknown => Array.isArray(value) ? [...value] : value

/** 检测已规整的新配色合同；具体覆盖哪些颜色仍由当前分支/语义映射决定。 */
export function hasFxTheme(params: Record<string, unknown>): boolean {
  return params.palette === 'theme' || object(params.light) || object(params.dark)
}

/** 原参数 → 宿主语义色板 → 当前模式颜色补丁；输入须先经过normalizeParams。 */
export function resolveFxTheme(def: FxDef, params: Record<string, unknown>, context: {dark: boolean; colors: Record<string, string>}): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(params).filter(([key]) => !['palette', 'light', 'dark'].includes(key)).map(([key, value]) => [key, copy(value)]))
  if (params.palette === 'theme') {
    const roles: Record<string, string | string[]> = {
      ...(def.kind === 'text' || def.kind === 'card' ? {color: 'text'} : {}),
      ...(def.kind === 'background' || def.kind === 'scene' ? {textColor: 'text'} : {}),
      ...PALETTES[def.id],
    }
    for (const [key, role] of Object.entries(roles)) {
      const spec = def.params[key]
      if (!spec || spec.t !== 'color' && spec.t !== 'colors') continue
      if (Array.isArray(role)) {
        const values = role.map((token) => context.colors[token]).filter((value): value is string => Boolean(value))
        if (values.length) result[key] = values
      } else if (context.colors[role]) result[key] = context.colors[role]
    }
  }
  const branch = params[context.dark ? 'dark' : 'light']
  if (object(branch)) {
    for (const [key, value] of Object.entries(branch)) {
      const spec = def.params[key]
      if (spec?.t === 'color' || spec?.t === 'colors') result[key] = copy(value)
    }
  }
  return result
}
