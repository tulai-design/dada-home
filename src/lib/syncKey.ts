import type {Keyring} from '@tulai-design/sync-sdk/crypto'

/** 管理页发给应用的一把同步密钥。服务地址、空间和加密密钥都在里面，设置页只粘贴这一串。 */
export type SyncKeyMaterial = {
  endpoint: string
  appId: string
  spaceId: string
  deviceId: string
  token: string
  keyring: Keyring
}

export const SYNC_KEY_PREFIX = 'tulai1.'
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function fail(message: string): never {
  throw new Error(message)
}

function endpointOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail('同步密钥里没有服务地址。')
  let url: URL
  try {url = new URL(value.trim())} catch {fail('同步密钥里的服务地址无效。')}
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) fail('同步密钥里的服务地址需要使用 https。')
  if (url.username || url.password || url.search || url.hash) fail('同步密钥里的服务地址无效。')
  return url.href.replace(/\/+$/, '')
}

function bytesOf(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*$/.test(padded)) fail('同步密钥无法读取。请重新复制。')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** 读出管理页生成的 `tulai1.` 密钥。格式不对就拒绝，不猜测缺了哪一段。 */
export function parseSyncKey(raw: string): SyncKeyMaterial {
  const text = raw.trim()
  if (!text.startsWith(SYNC_KEY_PREFIX)) fail('这不是同步密钥。请从同步服务的管理页复制。')
  let json: unknown
  try {json = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytesOf(text.slice(SYNC_KEY_PREFIX.length))))} catch {fail('同步密钥无法读取。请重新复制。')}
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('同步密钥无法读取。请重新复制。')
  const item = json as Record<string, unknown>
  if (item.v !== 1) fail('这把同步密钥的版本不受支持。')
  const {appId, spaceId, deviceId, token, keyring} = item
  if (typeof appId !== 'string' || !ID.test(appId) || typeof spaceId !== 'string' || !ID.test(spaceId) || typeof deviceId !== 'string' || !ID.test(deviceId)) fail('同步密钥里的服务标识无效。')
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) fail('同步密钥里的访问凭据无效。')
  if (!keyring || typeof keyring !== 'object' || Array.isArray(keyring)) fail('同步密钥里没有加密密钥。')
  const ring = keyring as Keyring
  if (ring.format !== 'tulai-keyring' || ring.version !== 1 || ring.appId !== appId || ring.spaceId !== spaceId || !Array.isArray(ring.keys) || ring.keys.length < 1) fail('同步密钥里的加密密钥无效。')
  return {endpoint: endpointOf(item.endpoint), appId, spaceId, deviceId, token, keyring: ring}
}

/** 与管理页使用同一字段顺序，便于两边互相读取。 */
export function encodeSyncKey(material: SyncKeyMaterial): string {
  const payload = {v: 1, endpoint: material.endpoint, appId: material.appId, spaceId: material.spaceId, deviceId: material.deviceId, token: material.token, keyring: material.keyring}
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return SYNC_KEY_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
