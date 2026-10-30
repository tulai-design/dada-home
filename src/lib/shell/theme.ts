import {DEFAULT_THEME} from '../workspace'
import {resolveTheme} from '../themes'

/** 请求保持原值，故障渲染统一采用可信纸张基础；App 与测试共用。 */
export function resolveShellTheme(requested: ReturnType<typeof resolveTheme>, snapshot: {fault: unknown | null}) {
  if (!snapshot.fault) return requested
  const fallback = resolveTheme({...DEFAULT_THEME, fonts: []}, requested.mode)
  return {...fallback, id: requested.id, requested: requested.requested, availability: requested.availability}
}
