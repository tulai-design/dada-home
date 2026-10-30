import {WorkspaceError} from './errors'
import {PACKAGE_LIMITS, type LocalThemeFontRef} from './themePackages/contracts'
import {assertPackageIdentity, RESOURCE_ID} from './themePackages/boundary'

const object = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw)
const digest = (raw: unknown): raw is string => typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw)
/** 本地字体身份独立于展示 family，所有入口使用相同严格格式。 */
export function cleanLocalThemeFontRef(raw: unknown): LocalThemeFontRef {
  assertPackageIdentity(raw)
  if (!object(raw) || Object.keys(raw).length !== 5 || Object.keys(raw).some(key => !['packageId', 'version', 'digest', 'resourceId', 'sha256'].includes(key))
    || typeof raw.resourceId !== 'string' || !RESOURCE_ID.test(raw.resourceId) || !digest(raw.sha256)) throw new WorkspaceError('本地字体资源引用无效，必须指定精确包版本、摘要和资源身份')
  return {packageId: raw.packageId, version: raw.version, digest: raw.digest, resourceId: raw.resourceId, sha256: raw.sha256}
}
export const localThemeFontFamily = (ref: LocalThemeFontRef): string => `TadaLocal_${ref.sha256}`

/** 文件头是解码前预算边界，实际可用性仍由 FontFace.load 确认。 */
export function validateWoff2Bytes(raw: unknown, expectedBytes?: number): ArrayBuffer {
  if (Object.prototype.toString.call(raw) !== '[object ArrayBuffer]') throw new WorkspaceError('本地字体必须是 WOFF2 二进制资源')
  const bytes = raw as ArrayBuffer
  if (bytes.byteLength < 48 || bytes.byteLength > PACKAGE_LIMITS.font || expectedBytes !== undefined && bytes.byteLength !== expectedBytes) throw new WorkspaceError('本地字体字节数无效或超出 2 MiB 预算')
  const header = new DataView(bytes)
  const tables = header.getUint16(12)
  if (header.getUint32(0) !== 0x774f4632 || header.getUint32(8) !== bytes.byteLength || tables < 1 || tables > 256 || header.getUint16(14) !== 0
    || header.getUint32(16) < 12 || header.getUint32(16) > 16 * 1024 * 1024 || header.getUint32(20) < 1 || header.getUint32(20) > bytes.byteLength - 48) throw new WorkspaceError('WOFF2 字体文件头或声明解码预算无效')
  return bytes
}
export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export async function verifyLocalThemeFontBytes(ref: LocalThemeFontRef, raw: unknown, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw new DOMException('本地字体加载已取消', 'AbortError')
  const bytes = validateWoff2Bytes(raw).slice(0)
  if (await sha256Bytes(bytes) !== ref.sha256) throw new WorkspaceError('本地字体内容摘要不匹配')
  if (signal?.aborted) throw new DOMException('本地字体加载已取消', 'AbortError')
  return bytes
}
