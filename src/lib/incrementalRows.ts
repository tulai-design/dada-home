import type {CommitBatch, CommitReceipt, UploadCheckpoint} from '@tulai-design/sync-sdk'
import type {DbOperation, DbRead} from './db'

/** 本机增量同步协调仓的纯数据边界；不依赖任何业务模块，聊天与组件写入路径可以轻量引用。 */
export type SyncCollection = 'applicationData' | 'config' | 'component' | 'conversation' | 'turn'
export const SYNC_COLLECTIONS: readonly SyncCollection[] = ['applicationData', 'config', 'component', 'conversation', 'turn']
export type SyncRef = {collection: SyncCollection; key: string}
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue}

export type SyncBindingIdentity = {endpoint: string; appId: string; spaceId: string; deviceId: string; keyFingerprint: string}
export type SyncBinding = SyncBindingIdentity & {epoch: string; cursor?: string}
export type SyncPrepared = {request: CommitBatch; ciphertext?: Blob}
export type SyncIntent = {generation: number; operationId: string; baseRevision: number | null; prepared?: SyncPrepared; checkpoint?: UploadCheckpoint}
export type SyncConflictVersion = {localGeneration: number; remoteRevision: number}
export type SyncConflict = {
  localGeneration: number; remoteRevision: number | null; remoteReady: boolean; remoteValue?: JsonValue | null
  operationId?: string; receipt?: CommitReceipt
}
export type SyncRecordState = {
  k: string; type: 'record'; epoch: string; collection: SyncCollection; key: string; generation: number; remoteRevision: number | null
  digest?: string; draft?: {generation: number}; inFlight?: SyncIntent; conflict?: SyncConflict
  qInflight?: string; qDraft?: string; qConflict?: string
}
export type SyncIncoming = {ref: SyncRef; entityId: string; revision: number; value: JsonValue | null; deviceId: string; operationId: string}

export const STORE = 'incrementalSync' as const
export const ACTIVE = 'active'
export const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
export const positive = (value: unknown): value is number => integer(value) && value > 0
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
export const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const invalid = (): never => {throw new Error('增量同步本地状态无效，已保留原数据。')}
export const stale = (): never => {throw new Error('数据已在其他页面更新，请重新加载后继续；新数据未被覆盖。')}
export const bindingChanged = () => new Error('增量同步绑定已改变，请重新读取状态后重试；本次操作未应用。')

export const genKey = (key: string) => JSON.stringify(['generation', key])
export const recordKey = (epoch: string, ref: SyncRef) => JSON.stringify(['record', epoch, ref.collection, ref.key])
export const bindingKey = (epoch: string) => JSON.stringify(['binding', epoch])
export const configApplyKey = (name: string) => JSON.stringify(['config-apply', name])
export const read = (key: string): DbRead => ({store: STORE, key})
export const put = (value: unknown): DbOperation => ({store: STORE, type: 'put', value})
export const noWrites = <T>(result: T) => ({operations: [] as DbOperation[], result})
export const refOf = (collection: SyncCollection, key: string): SyncRef => ({collection, key})
export const generationRow = (key: string, value: number) => ({k: genKey(key), type: 'generation', generation: value})
export function generationOf(raw: unknown): number {
  if (raw === undefined) return 0
  if (!isObject(raw) || raw.type !== 'generation' || !integer(raw.generation)) return invalid()
  return raw.generation
}
export function nextGeneration(value: number): number {if (value >= Number.MAX_SAFE_INTEGER) return invalid(); return value + 1}

function identityOf(raw: unknown): SyncBindingIdentity {
  const names = ['endpoint', 'appId', 'spaceId', 'deviceId', 'keyFingerprint']
  if (!isObject(raw) || !names.every(key => Object.prototype.hasOwnProperty.call(raw, key))) return invalid()
  if (!identifier(raw.appId) || !identifier(raw.spaceId) || !identifier(raw.deviceId) || typeof raw.keyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.keyFingerprint) || typeof raw.endpoint !== 'string') return invalid()
  const url = new URL(raw.endpoint)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return invalid()
  return {endpoint: url.href.replace(/\/$/, ''), appId: raw.appId, spaceId: raw.spaceId, deviceId: raw.deviceId, keyFingerprint: raw.keyFingerprint}
}
export function normalizeIdentity(raw: SyncBindingIdentity): SyncBindingIdentity {
  if (!isObject(raw) || Object.keys(raw).length !== 5) return invalid()
  return identityOf(raw)
}
export function bindingOf(raw: unknown): SyncBinding | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw) || raw.type !== 'binding' || !identifier(raw.epoch) || raw.cursor !== undefined && (typeof raw.cursor !== 'string' || !raw.cursor.length || raw.cursor.length > 2048)) return invalid()
  return {...identityOf(raw), epoch: raw.epoch, ...(raw.cursor === undefined ? {} : {cursor: raw.cursor as string})}
}
export function requireBinding(raw: unknown, epoch: string): SyncBinding {
  const binding = bindingOf(raw)
  if (!binding || binding.epoch !== epoch) throw bindingChanged()
  return binding
}
export const bindingRow = (binding: SyncBinding, k = ACTIVE) => ({...binding, k, type: 'binding'})

export function checkRef(ref: unknown): SyncRef {
  if (!isObject(ref) || typeof ref.key !== 'string' || !ref.key.length || ref.key.length > 1000 || !SYNC_COLLECTIONS.includes(ref.collection as SyncCollection)) return invalid()
  return {collection: ref.collection as SyncCollection, key: ref.key}
}

/** 索引列由状态推导，保证 next() 不必扫描全部记录。 */
export function normalize(row: SyncRecordState): SyncRecordState {
  const set = (name: 'qInflight' | 'qDraft' | 'qConflict', on: boolean) => {if (on) row[name] = row.epoch; else delete row[name]}
  set('qInflight', Boolean(row.inFlight) && !row.conflict)
  set('qDraft', Boolean(row.draft) && !row.inFlight && !row.conflict)
  set('qConflict', Boolean(row.conflict))
  return row
}
export function putRecord(row: SyncRecordState): DbOperation {return put(normalize(row))}

export function recordOf(raw: unknown, epoch: string, ref: SyncRef): SyncRecordState | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw) || raw.k !== recordKey(epoch, ref) || raw.type !== 'record' || raw.epoch !== epoch || raw.collection !== ref.collection || raw.key !== ref.key || !integer(raw.generation) || raw.remoteRevision !== null && !positive(raw.remoteRevision)) return invalid()
  if (raw.digest !== undefined && (typeof raw.digest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.digest))) return invalid()
  if (raw.draft !== undefined && (!isObject(raw.draft) || !integer(raw.draft.generation) || raw.draft.generation > raw.generation)) return invalid()
  if (raw.inFlight !== undefined) {
    const intent = raw.inFlight
    if (!isObject(intent) || !identifier(intent.operationId) || !integer(intent.generation) || intent.generation > raw.generation || intent.baseRevision !== null && !positive(intent.baseRevision)) return invalid()
    if (intent.prepared !== undefined && (!isObject(intent.prepared) || !isObject(intent.prepared.request) || intent.prepared.request.operationId !== intent.operationId)) return invalid()
  }
  if (raw.conflict !== undefined) {
    const conflict = raw.conflict
    if (!isObject(conflict) || !integer(conflict.localGeneration) || typeof conflict.remoteReady !== 'boolean' || conflict.remoteRevision !== null && !positive(conflict.remoteRevision)) return invalid()
  }
  return structuredClone(raw) as SyncRecordState
}
export function recordsOf(rows: unknown, epoch: string): SyncRecordState[] {
  if (!Array.isArray(rows)) return invalid()
  // epoch 索引同时包含该 epoch 的绑定行，只取记录行。
  return rows.filter(raw => isObject(raw) && raw.type === 'record').map(raw => {
    if (!isObject(raw)) return invalid()
    return recordOf(raw, epoch, checkRef({collection: raw.collection, key: raw.key}))!
  })
}
export function freshRecord(epoch: string, ref: SyncRef, generation = 0): SyncRecordState {
  return {k: recordKey(epoch, ref), type: 'record', epoch, collection: ref.collection, key: ref.key, generation, remoteRevision: null}
}
/** 本机又修改了该实体：generation 前进并留下可合并的草稿标记；值在发送前再读取最新本机状态。 */
export function touchRecord(row: SyncRecordState, generation = nextGeneration(row.generation)): SyncRecordState {
  row.generation = generation
  row.draft = {generation}
  if (row.conflict) row.conflict.localGeneration = generation
  return row
}
