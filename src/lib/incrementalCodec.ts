import type {ObjectDescriptor, SyncClient, SyncRecord, TransactionalSink} from '@tulai-design/sync-sdk'
import {decryptObject, decryptRecord, encryptObject, encryptRecord, type CryptoContext, type Keyring, type PreparedObject} from '@tulai-design/sync-sdk/crypto'
import {APPLICATION_DATA_MAX_BYTES} from './applicationDataSchema'
import {adapterOf} from './incrementalAdapters'
import {SYNC_COLLECTIONS, type JsonValue, type SyncCollection, type SyncIncoming, type SyncPrepared, type SyncRef} from './incrementalRows'

const FORMAT = 'dada-sync-record'
/** 单条记录明文上限沿用应用数据的 8 MiB；超出直接拒绝，不截断。 */
const PLAIN_LIMIT = APPLICATION_DATA_MAX_BYTES
const CIPHER_LIMIT = PLAIN_LIMIT + Math.ceil(PLAIN_LIMIT / (1048576 - 16)) * 16
type Scope = {appId: string; spaceId: string}
type CodecOptions = {scope: Scope; keyring: Keyring; signal?: AbortSignal}
export type SyncDecoded = Omit<SyncIncoming, 'deviceId' | 'operationId'>

function invalid(): never {throw new Error('同步记录格式或身份无效，没有应用远端内容。')}
function cancelled(signal?: AbortSignal) {if (signal?.aborted) throw new DOMException('增量同步已取消。', 'AbortError')}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === 'object' && !Array.isArray(value)}
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid()
}
function descriptor(value: unknown): ObjectDescriptor {
  exact(value, ['sha256', 'byteLength'])
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 16 || (value.byteLength as number) > CIPHER_LIMIT) invalid()
  return {sha256: value.sha256, byteLength: value.byteLength as number}
}
function refOf(collection: unknown, key: unknown): SyncRef {
  if (!SYNC_COLLECTIONS.includes(collection as SyncCollection) || typeof key !== 'string') return invalid()
  return {collection: collection as SyncCollection, key: adapterOf(collection as SyncCollection).key(key)}
}
function context(scope: Scope, collection: SyncCollection, entityId: string): CryptoContext {return {...scope, collection, entityId, schemaVersion: 1}}

/** JSON转义后再hash：保留本地1000字符身份，包括孤立surrogate，不发生UTF-8替换碰撞。 */
export async function entityIdFor(ref: SyncRef): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(refOf(ref.collection, ref.key).key))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function blobSink(limit: number): {sink: TransactionalSink; value: () => Blob} {
  let parts: Uint8Array<ArrayBuffer>[] = [], size = 0, complete = false, aborted = false
  return {
    sink: {
      async write(offset, bytes) {
        if (complete || aborted || offset !== size || size + bytes.byteLength > limit) invalid()
        parts.push(new Uint8Array(bytes)); size += bytes.byteLength
      },
      async commit() {if (complete || aborted) invalid(); complete = true},
      async abort() {parts = []; size = 0; aborted = true; complete = false},
    },
    value() {if (!complete || aborted) invalid(); return new Blob(parts, {type: 'application/octet-stream'})},
  }
}

/** 返回值必须整体持久化后才能上传；重试绝不能重新生成随机密文。 */
export async function prepareSyncRecord(
  input: {ref: SyncRef; value: JsonValue | null; operationId: string; baseRevision: number | null},
  options: CodecOptions,
): Promise<SyncPrepared> {
  const ref = refOf(input.ref.collection, input.ref.key), entityId = await entityIdFor(ref), ctx = context(options.scope, ref.collection, entityId)
  cancelled(options.signal)
  let metadata: unknown, ciphertext: Blob | undefined, refs: ObjectDescriptor[] | undefined
  const head = {format: FORMAT, version: 1, collection: ref.collection, key: ref.key}
  if (input.value === null) metadata = {...head, deleted: true}
  else {
    const source = new Blob([JSON.stringify(adapterOf(ref.collection).check(input.value))], {type: 'application/json'})
    if (source.size > PLAIN_LIMIT) throw new Error('单条同步记录超过 8 MiB，未发送。')
    const staging = blobSink(CIPHER_LIMIT)
    const prepared = await encryptObject(source, staging.sink, {keyring: options.keyring, context: ctx, signal: options.signal})
    ciphertext = staging.value(); refs = [{...prepared.descriptor}]
    metadata = {...head, prepared}
  }
  const encrypted = await encryptRecord(metadata, options.keyring, ctx)
  cancelled(options.signal)
  return {
    request: {protocolVersion: 1, operationId: input.operationId, mutations: [{type: 'put', collection: ref.collection, entityId, baseRevision: input.baseRevision, schemaVersion: 1, payload: {...encrypted}, ...(refs ? {objectRefs: refs} : {})}]},
    ...(ciphertext ? {ciphertext} : {}),
  }
}

/** 完整验证/解密在事务外完成；本机凭据恢复和 generation 守卫属于入站事务。 */
export async function decodeSyncRecord(
  record: SyncRecord,
  options: CodecOptions & {client: SyncClient},
): Promise<SyncDecoded> {
  cancelled(options.signal)
  if (!SYNC_COLLECTIONS.includes(record.collection as SyncCollection) || record.deleted || record.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(record.entityId)) invalid()
  const collection = record.collection as SyncCollection
  const wanted = object(record.payload) ? record.payload.keyId : undefined
  if (typeof wanted === 'string' && !options.keyring.keys.some(key => key.id === wanted)) {
    throw new Error(`这条远端记录由密钥 ${wanted} 加密，当前同步密钥里没有它（当前：${options.keyring.keys.map(key => key.id).join('、')}）。请换回当初那把同步密钥，重新生成的密钥读不了这些数据。`)
  }
  const ctx = context(options.scope, collection, record.entityId), metadata = await decryptRecord(record.payload, options.keyring, ctx)
  if (!object(metadata) || metadata.format !== FORMAT || metadata.version !== 1 || metadata.collection !== collection) invalid()
  const ref = refOf(metadata.collection, metadata.key)
  if (await entityIdFor(ref) !== record.entityId) invalid()
  if (metadata.deleted === true) {
    exact(metadata, ['format', 'version', 'collection', 'key', 'deleted'])
    if (record.objectRefs !== undefined) invalid()
    return {ref, entityId: record.entityId, revision: record.revision, value: null}
  }
  exact(metadata, ['format', 'version', 'collection', 'key', 'prepared'])
  exact(metadata.prepared, ['descriptor', 'manifest'])
  const descriptorRef = descriptor(metadata.prepared.descriptor)
  if (!Array.isArray(record.objectRefs) || record.objectRefs.length !== 1) invalid()
  const outer = descriptor(record.objectRefs[0])
  if (outer.sha256 !== descriptorRef.sha256 || outer.byteLength !== descriptorRef.byteLength) invalid()
  const prepared: PreparedObject = {descriptor: descriptorRef, manifest: metadata.prepared.manifest as PreparedObject['manifest']}
  const encrypted = blobSink(CIPHER_LIMIT)
  await options.client.downloadObject(descriptorRef, encrypted.sink, {signal: options.signal})
  const plaintext = blobSink(PLAIN_LIMIT)
  await decryptObject(encrypted.value(), prepared, plaintext.sink, {keyring: options.keyring, context: ctx, signal: options.signal})
  cancelled(options.signal)
  let value: unknown
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await plaintext.value().arrayBuffer()))} catch {invalid()}
  return {ref, entityId: record.entityId, revision: record.revision, value: adapterOf(collection).check(value)}
}
