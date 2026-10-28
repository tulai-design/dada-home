import type {SyncScope} from './syncTypes'

export type Revision = {counter: number; device: string}
export type SyncRecord = {revision: Revision; hash: string; value?: unknown; deleted?: true}
export type Snapshot = {app: 'dada-sync'; version: 2; scope: SyncScope; secrets: boolean; records: Record<string, SyncRecord>}
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function fail(): never {throw new Error('云端同步数据的格式、版本或记录无效，没有应用任何数据。')}
export const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))

/** JSON 的键顺序不影响版本，非 JSON 值不会被静默省略。 */
export function canonical(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  if (depth > 100) throw new Error('同步数据嵌套过深。')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('同步记录必须是完整 JSON 数据。')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('同步记录必须使用普通 JSON 对象。')
  ancestors.add(value)
  let text: string
  if (Array.isArray(value)) {
    const values = []
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error('同步记录含不完整数组。')
      values.push(canonical(value[i], ancestors, depth + 1))
    }
    text = `[${values.join(',')}]`
  } else text = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], ancestors, depth + 1)}`).join(',')}}`
  ancestors.delete(value)
  return text
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export const recordHash = (record: Pick<SyncRecord, 'value' | 'deleted'>) => digest(record.deleted ? {deleted: true} : {value: record.value})
export function compare(a: SyncRecord, b: SyncRecord): number {
  return a.revision.counter - b.revision.counter || (a.revision.device < b.revision.device ? -1 : a.revision.device > b.revision.device ? 1 : 0) || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
}
export async function validateSnapshot(raw: unknown, scope: SyncScope, validate: (id: string, value: unknown, deleted: boolean) => void): Promise<Snapshot> {
  if (!object(raw) || !exactKeys(raw, ['app', 'version', 'scope', 'secrets', 'records']) || raw.app !== 'dada-sync' || raw.version !== 2 || raw.scope !== scope || typeof raw.secrets !== 'boolean' || !object(raw.records)) fail()
  const records: Record<string, SyncRecord> = Object.create(null)
  for (const [id, value] of Object.entries(raw.records)) {
    if (!object(value) || !exactKeys(value, ['revision', 'hash', 'value', 'deleted']) || !object(value.revision) || !exactKeys(value.revision, ['counter', 'device']) || !Number.isSafeInteger(value.revision.counter) || (value.revision.counter as number) < 0 || typeof value.revision.device !== 'string' || !value.revision.device || value.revision.device.length > 200 || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) fail()
    if (value.deleted !== undefined && value.deleted !== true) fail()
    if (value.deleted ? Object.prototype.hasOwnProperty.call(value, 'value') : !Object.prototype.hasOwnProperty.call(value, 'value')) fail()
    validate(id, value.value, value.deleted === true)
    const rec = value as SyncRecord
    if (await recordHash(rec) !== rec.hash) fail()
    records[id] = rec
  }
  return {app: 'dada-sync', version: 2, scope, secrets: raw.secrets, records}
}

const iterations = 210_000
const b64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
function unb64(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string' || !value || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail()
  let bytes: Uint8Array
  try {bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0))} catch {return fail()}
  if (b64(bytes) !== value || (length !== undefined && bytes.length !== length)) fail()
  return bytes
}
async function aesKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt'])
}
export async function encode(snapshot: Snapshot, passphrase: string): Promise<string> {
  const text = canonical(snapshot)
  if (!passphrase) return text
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv, tagLength: 128}, await aesKey(passphrase, salt), new TextEncoder().encode(text))
  return JSON.stringify({app: 'dada-sync-encrypted', version: 2, kdf: 'PBKDF2-SHA256', iterations, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data))})
}
export async function decode(text: string, passphrase: string, scope: SyncScope, validate: (id: string, value: unknown, deleted: boolean) => void): Promise<{snapshot: Snapshot; encrypted: boolean}> {
  let raw: unknown
  try {raw = JSON.parse(text)} catch {return fail()}
  let encrypted = false
  if (object(raw) && raw.app === 'dada-sync-encrypted') {
    if (!exactKeys(raw, ['app', 'version', 'kdf', 'iterations', 'cipher', 'salt', 'iv', 'data']) || raw.version !== 2 || raw.kdf !== 'PBKDF2-SHA256' || raw.iterations !== iterations || raw.cipher !== 'AES-256-GCM') fail()
    const salt = unb64(raw.salt, 16), iv = unb64(raw.iv, 12), data = unb64(raw.data)
    if (data.length < 16) fail()
    if (!passphrase) throw new Error('云端已加密，请填写当前或本次原口令。')
    try {
      const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128}, await aesKey(passphrase, salt), data as BufferSource)
      raw = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plain))
    } catch {throw new Error('口令不对或密文损坏，没有修改本机或云端数据。')}
    encrypted = true
  }
  const snapshot = await validateSnapshot(raw, scope, validate)
  if (snapshot.secrets && !encrypted) throw new Error('云端密钥数据必须使用加密快照。')
  return {snapshot, encrypted}
}
