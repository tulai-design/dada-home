/** 应用持久化的纯数据边界，运行时、备份与同步共用。 */
export type ApplicationDataRef = {kind: 'app' | 'applet'; id: string}
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue}
export type ApplicationData = {[key: string]: JsonValue}
export type ApplicationDataRecord = {k: string; v: ApplicationData}
export const APPLICATION_DATA_MAX_BYTES = 8 * 1024 * 1024

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}
function invalid(): never {throw new Error('应用数据必须是完整的 JSON 对象，不能包含循环引用、空缺项或非 JSON 值。')}

/** 不通过 JSON.stringify 的忽略/转换行为悄悄丢弃应用字段。 */
function cloneJson(value: unknown, seen: Set<object>, depth: number): JsonValue {
  if (depth > 100) throw new Error('应用数据嵌套不能超过 100 层。')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {if (!Number.isFinite(value)) invalid(); return value}
  if (typeof value !== 'object') return invalid()
  if (seen.has(value)) invalid()
  seen.add(value)
  let result: JsonValue
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid()
    result = Array.from({length: value.length}, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid()
      return cloneJson(descriptor.value, seen, depth + 1)
    })
  } else {
    if (!plainObject(value)) return invalid()
    const output: ApplicationData = Object.create(null)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalid()
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid()
      output[key] = cloneJson(descriptor.value, seen, depth + 1)
    }
    result = output
  }
  seen.delete(value)
  return result
}

export function applicationDataKey(ref: ApplicationDataRef): string {
  if ((ref.kind !== 'app' && ref.kind !== 'applet') || typeof ref.id !== 'string' || !ref.id.length) {
    throw new Error('应用数据身份无效。')
  }
  const key = `${ref.kind}:${ref.id}`
  if (key.length > 1000) throw new Error('应用数据身份过长。')
  return key
}

/** 返回独立快照，预算包含所有字段、标点与 JSON 转义后的 UTF-8 字节。 */
export function validateApplicationData(value: unknown): ApplicationData {
  if (!plainObject(value)) invalid()
  const result = cloneJson(value, new Set(), 0) as ApplicationData
  const text = JSON.stringify(result)
  if (new TextEncoder().encode(text).byteLength > APPLICATION_DATA_MAX_BYTES) {
    throw new Error('应用数据超过每个实例 8 MiB 的 UTF-8 JSON 保存预算，请减少数据后重试。')
  }
  return result
}

export function validateApplicationDataRecord(value: unknown): ApplicationDataRecord {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== 2) {
    throw new Error('应用存储记录格式无效。')
  }
  const key = Object.getOwnPropertyDescriptor(value, 'k')
  const data = Object.getOwnPropertyDescriptor(value, 'v')
  if (!key?.enumerable || !('value' in key) || typeof key.value !== 'string' || !data?.enumerable || !('value' in data)) {
    throw new Error('应用存储记录格式无效。')
  }
  const separator = key.value.indexOf(':')
  const kind = key.value.slice(0, separator)
  if (separator < 0 || (kind !== 'app' && kind !== 'applet')) throw new Error('应用存储记录身份无效。')
  const k = applicationDataKey({kind, id: key.value.slice(separator + 1)})
  return {k, v: validateApplicationData(data.value)}
}
