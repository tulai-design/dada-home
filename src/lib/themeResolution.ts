import {fontVars} from './fonts'
import type {ThemeEntry} from './workspace'

export type ThemeDesignSource = 'font' | 'shared' | 'light' | 'dark'

/** 完整快照的实际覆盖层；验证字体引用和正式解析必须使用相同顺序。 */
export function themeDesignLayers(theme: ThemeEntry, mode: 'light' | 'dark'): {values: Record<string, string>; source: ThemeDesignSource}[] {
  return [
    {values: fontVars(theme.fonts), source: 'font'},
    {values: theme.overrides, source: 'shared'},
    {values: theme[mode] ?? {}, source: mode},
  ]
}
