import type {ThemeShell, ThemeSkin} from './workspace'

/** 正式窗口与固定预览共用的期望边距；实际画布仍可安全收缩。 */
export const DEFAULT_WIN98_WINDOW_GAP = 24

/** 仅登记宿主已打包的实现，不是第三方代码注册接口。 */
const SKINS = {
  paper: {shell: 'standard', frame: 'variable'},
  ios: {shell: 'standard', frame: 'toggle'},
  pixel: {shell: 'standard', frame: 'toggle'},
  switch: {shell: 'switch', frame: 'toggle'},
  win98: {shell: 'win98', frame: 'none'},
} as const satisfies Record<ThemeSkin, {shell: ThemeShell; frame: 'toggle' | 'variable' | 'none'}>

export function isThemeRenderer(skin: unknown, shell: unknown): skin is ThemeSkin {
  return typeof skin === 'string' && Object.hasOwn(SKINS, skin) && SKINS[skin as ThemeSkin].shell === shell
}

export function themeCapabilities(skin: ThemeSkin): {frame: 'toggle' | 'variable' | 'none'} {
  return {frame: SKINS[skin].frame}
}
