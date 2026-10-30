import {DEFAULT_THEME} from '../workspace'
import {resolveTheme} from '../themes'

/** 请求保持原值，故障渲染统一采用可信纸张基础；App 与测试共用。 */
export function resolveShellTheme(requested: ReturnType<typeof resolveTheme>, snapshot: {fault: unknown | null}) {
  return snapshot.fault ? resolveTheme(DEFAULT_THEME, requested.mode) : requested
}
