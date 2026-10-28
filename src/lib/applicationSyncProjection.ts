import {validateApplicationData, type ApplicationData, type JsonValue} from './applicationDataSchema'

const secrets = new Set(['apiKey', 'token', 'password', 'secret', 'keys'])
const object = (value: unknown): value is ApplicationData => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function strip(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(strip)
  if (!object(value)) return value
  const result: ApplicationData = Object.create(null)
  for (const [key, item] of Object.entries(value)) if (!secrets.has(key)) result[key] = strip(item)
  return result
}

/** 只识别约定字段名，不声称能从应用自由文本中识别全部秘密。 */
export function projectApplicationData(value: unknown): ApplicationData {
  return validateApplicationData(strip(validateApplicationData(value)))
}

function uniqueIds(values: JsonValue[]): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>(), duplicate = new Set<string>()
  for (const value of values) if (object(value) && typeof value.id === 'string' && value.id.length) {
    if (result.has(value.id)) duplicate.add(value.id)
    result.set(value.id, value)
  }
  for (const id of duplicate) result.delete(id)
  return result
}

function restore(remote: JsonValue, current: JsonValue | undefined): JsonValue {
  if (Array.isArray(remote)) {
    const incoming = uniqueIds(remote), local = uniqueIds(Array.isArray(current) ? current : [])
    return remote.map(item => restore(item, object(item) && typeof item.id === 'string' && incoming.has(item.id) ? local.get(item.id) : undefined))
  }
  if (!object(remote)) return remote
  const local = object(current) ? current : {}, result: ApplicationData = Object.create(null)
  for (const [key, item] of Object.entries(remote)) result[key] = restore(item, local[key])
  for (const key of secrets) if (own(local, key)) result[key] = local[key]
  return result
}

/** 在入站事务读取当前业务值后调用；远端不能注入本机尚不存在的凭据字段。 */
export function restoreApplicationData(remote: unknown, current: unknown): ApplicationData {
  const portable = projectApplicationData(remote)
  const local = current === undefined ? undefined : validateApplicationData(current)
  return validateApplicationData(restore(portable, local))
}
