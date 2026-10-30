import {WorkspaceError} from '../errors'
import {PACKAGE_LIMITS, type PackageIdentity, type ThemePackageRef, type ThemeRendererContract} from './contracts'

export const object = (raw: unknown): raw is Record<string, unknown> => raw !== null && typeof raw === 'object' && !Array.isArray(raw)
export function exact(raw: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(raw).some(key => !keys.includes(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new WorkspaceError('主题包包含未知或不允许的字段')
}
export function boundedText(raw: unknown, max: number, name: string, empty = false): asserts raw is string {
  if (typeof raw !== 'string' || !empty && !raw.trim() || raw.length > max) throw new WorkspaceError(`主题包 ${name} 无效`)
}
export const RESOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/
export function assertPackageIdentity(raw: unknown): asserts raw is PackageIdentity & Record<string, unknown> {
  if (!object(raw) || typeof raw.packageId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(raw.packageId) || raw.packageId.includes('..') || typeof raw.version !== 'string' || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(raw.version) || typeof raw.digest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.digest)) throw new WorkspaceError('主题包精确身份无效')
}
export function assertThemePackageRef(raw: unknown): asserts raw is ThemePackageRef {
  assertPackageIdentity(raw)
  exact(raw as unknown as Record<string, unknown>, ['packageId', 'version', 'digest', 'themeId'])
  if (typeof (raw as ThemePackageRef).themeId !== 'string' || !RESOURCE_ID.test((raw as ThemePackageRef).themeId)) throw new WorkspaceError('主题包贡献引用无效')
}
export function assertRendererContract(raw: unknown): asserts raw is ThemeRendererContract {
  if (!object(raw)) throw new WorkspaceError('主题渲染合同无效')
  exact(raw, ['schemaVersion', 'skinVersion', 'shellVersion'])
  for (const key of ['schemaVersion', 'skinVersion', 'shellVersion']) if (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < 1 || Number(raw[key]) > 1000000) throw new WorkspaceError('主题渲染合同版本无效')
}
export function assertPlainContainer(value: object): void {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) throw new WorkspaceError('主题设计不能含Symbol键')
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key)))) throw new WorkspaceError('主题设计数组不能含额外属性')
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || typeof prototype.constructor !== 'function' || prototype.constructor.name !== 'Object' || prototype.constructor.prototype !== prototype)) throw new WorkspaceError('主题设计只能含普通JSON对象')
  }
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor) || !descriptor.enumerable) throw new WorkspaceError('主题设计不能含访问器或隐藏字段')
  }
}
export function assertBoundedJson(raw: unknown, budget: number = PACKAGE_LIMITS.design): void {
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number) => {
    if (depth > PACKAGE_LIMITS.depth) throw new WorkspaceError('主题设计嵌套超过预算')
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return
    if (typeof value !== 'object' || ancestors.has(value)) throw new WorkspaceError('主题设计必须是完整 JSON')
    assertPlainContainer(value)
    ancestors.add(value)
    if (Array.isArray(value)) for (let i = 0; i < value.length; i += 1) {if (!(i in value)) throw new WorkspaceError('主题设计数组不完整'); visit(value[i], depth + 1)}
    else for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new WorkspaceError('主题设计包含不允许的键')
      visit(child, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(raw, 0)
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > budget) throw new WorkspaceError('主题设计超过数据预算')
}
export function canonicalJson(raw: unknown): string {
  return JSON.stringify(raw, (_key, value: unknown) => object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)
}
