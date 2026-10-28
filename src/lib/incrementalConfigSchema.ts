import {configNames, validateRecord} from './syncData'
import {canonical, exactKeys, object} from './syncProtocol'

/** 自建同步始终端到端加密；业务连接和凭据是数据，不复用快照同步的脱敏投影。 */
export const INCREMENTAL_CONFIG_NAMES: readonly string[] = [...configNames, 'read', 'assistantSplitRatio', 'playerPrefs', 'analytics']
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const without = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const providers = ['off', 'tavily', 'firecrawl', 'searxng', 'exa', 'brave']
function invalid(): never {throw new Error('增量同步配置的类型或字段无效，未应用远端配置。')}
function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || !exactKeys(value, names)) invalid()
}
const text = (value: Record<string, unknown>, names: string[]) => {
  for (const key of names) if (own(value, key) && typeof value[key] !== 'string') invalid()
}

/** 与快照共用基础业务校验，只单独定义完整同步新增的字段与偏好。 */
export function validateIncrementalConfig(name: string, value: unknown): void {
  if (!INCREMENTAL_CONFIG_NAMES.includes(name)) invalid()
  canonical(value)
  if (name === 'settings') {
    if (!object(value)) invalid()
    const base = without(value, ['proxy', 'monitor'])
    text(value, ['proxy'])
    if (own(value, 'ai')) {
      if (!object(value.ai)) invalid()
      text(value.ai, ['baseUrl', 'extraBody'])
      base.ai = without(value.ai, ['baseUrl', 'extraBody'])
    }
    if (own(value, 'monitor')) {
      if (!Array.isArray(value.monitor)) invalid()
      const ids = new Set<string>()
      for (const monitor of value.monitor) {
        fields(monitor, ['id', 'name', 'kind', 'baseUrl', 'token', 'identity', 'password', 'url'])
        text(monitor, ['id', 'name', 'kind', 'baseUrl', 'token', 'identity', 'password', 'url'])
        if (typeof monitor.id !== 'string' || !monitor.id || ids.has(monitor.id) || typeof monitor.name !== 'string' || typeof monitor.baseUrl !== 'string' || !['coolify', 'beszel', 'http'].includes(monitor.kind as string)) invalid()
        ids.add(monitor.id)
      }
    }
    validateRecord('config:settings', base, false, 'full')
  } else if (name === 'search') {
    if (!object(value)) invalid()
    if (own(value, 'urls')) {
      fields(value.urls, providers)
      text(value.urls, providers)
    }
    validateRecord('config:search', without(value, ['urls']), false, 'full')
  } else if (name === 'assistantSplitRatio') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) invalid()
  } else if (name === 'analytics') {
    if (typeof value !== 'boolean') invalid()
  } else if (name === 'playerPrefs') {
    fields(value, ['volume', 'mode', 'trackId'])
    if (own(value, 'volume') && (typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1)) invalid()
    if (own(value, 'mode') && !['list', 'one', 'shuffle'].includes(value.mode as string)) invalid()
    text(value, ['trackId'])
  } else validateRecord(`config:${name}`, value, false, 'full')
}

/** 唯一工作空间例外是设备本机授权；不把它授予另一台设备。 */
export function projectIncrementalConfig(name: string, local: unknown): unknown {
  if (local === undefined) return undefined
  let value = local
  if (name === 'workspace' && object(local)) {
    value = without(local, ['network'])
    if (Object.keys(value as object).length === 0 && Array.isArray(local.network)) return undefined
  }
  validateIncrementalConfig(name, value)
  return value
}

/** 完整记录替换意味着删除同样可同步，不能在接收端复活旧 API key。 */
export function applyIncrementalConfig(name: string, incoming: unknown, local: unknown): unknown {
  if (incoming !== undefined) validateIncrementalConfig(name, incoming)
  if (name !== 'workspace') return incoming
  const grants = object(local) && Array.isArray(local.network) ? local.network : []
  return incoming === undefined ? (grants.length ? {network: grants} : undefined) : {...incoming as Record<string, unknown>, network: grants}
}
