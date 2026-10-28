import type {CommitBatch, ObjectDescriptor, SyncClient, SyncRecord, TransactionalSink} from '@tulai-design/sync-sdk'
import {decryptObject, decryptRecord, encryptObject, encryptRecord, type CryptoContext, type Keyring, type PreparedObject} from '@tulai-design/sync-sdk/crypto'
import {APPLICATION_DATA_MAX_BYTES, validateApplicationData, validateApplicationDataRecord, type ApplicationData} from './applicationDataSchema'
import {projectApplicationData} from './applicationSyncProjection'

export const APPLICATION_SYNC_COLLECTION = 'applicationData'
const FORMAT = 'dada-application-data'
const CIPHER_LIMIT = APPLICATION_DATA_MAX_BYTES + Math.ceil(APPLICATION_DATA_MAX_BYTES / (1048576 - 16)) * 16
type Scope = {appId: string; spaceId: string}
type CodecOptions = {scope: Scope; keyring: Keyring; signal?: AbortSignal}
export type ApplicationSyncPreparation = {request: CommitBatch; ciphertext?: Blob}
export type ApplicationSyncDecoded = {applicationKey: string; entityId: string; revision: number; value: ApplicationData | null}

function invalid(): never {throw new Error('同步应用数据格式或身份无效，没有应用远端内容。')}
function cancelled(signal?: AbortSignal) {if (signal?.aborted) throw new DOMException('应用同步已取消。', 'AbortError')}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === 'object' && !Array.isArray(value)}
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid()
}
function descriptor(value: unknown): ObjectDescriptor {
  exact(value, ['sha256', 'byteLength'])
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 16 || (value.byteLength as number) > CIPHER_LIMIT) invalid()
  return {sha256: value.sha256, byteLength: value.byteLength as number}
}
function key(value: unknown): string {
  return validateApplicationDataRecord({k: value, v: {}}).k
}
function context(scope: Scope, entityId: string): CryptoContext {return {...scope, collection: APPLICATION_SYNC_COLLECTION, entityId, schemaVersion: 1}}

/** JSON转义后再hash：保留本地1000字符身份，包括孤立surrogate，不发生UTF-8替换碰撞。 */
export async function entityIdForApplicationKey(applicationKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(key(applicationKey)))
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
export async function prepareApplicationSyncRecord(
  input: {applicationKey: string; value: ApplicationData | null; operationId: string; baseRevision: number | null},
  options: CodecOptions,
): Promise<ApplicationSyncPreparation> {
  const applicationKey = key(input.applicationKey), entityId = await entityIdForApplicationKey(applicationKey), ctx = context(options.scope, entityId)
  cancelled(options.signal)
  let metadata: unknown, ciphertext: Blob | undefined, refs: ObjectDescriptor[] | undefined
  if (input.value === null) metadata = {format: FORMAT, version: 1, applicationKey, deleted: true}
  else {
    const portable = projectApplicationData(input.value)
    const source = new Blob([JSON.stringify(portable)], {type: 'application/json'})
    const staging = blobSink(CIPHER_LIMIT)
    const prepared = await encryptObject(source, staging.sink, {keyring: options.keyring, context: ctx, signal: options.signal})
    ciphertext = staging.value(); refs = [{...prepared.descriptor}]
    metadata = {format: FORMAT, version: 1, applicationKey, prepared}
  }
  const encrypted = await encryptRecord(metadata, options.keyring, ctx)
  cancelled(options.signal)
  return {
    request: {protocolVersion: 1, operationId: input.operationId, mutations: [{type: 'put', collection: APPLICATION_SYNC_COLLECTION, entityId, baseRevision: input.baseRevision, schemaVersion: 1, payload: {...encrypted}, ...(refs ? {objectRefs: refs} : {})}]},
    ...(ciphertext ? {ciphertext} : {}),
  }
}

/** 完整验证/解密在事务外完成；本机凭据恢复和generation守卫属于入站事务。 */
export async function decodeApplicationSyncRecord(
  record: SyncRecord,
  options: CodecOptions & {client: SyncClient},
): Promise<ApplicationSyncDecoded> {
  cancelled(options.signal)
  if (record.collection !== APPLICATION_SYNC_COLLECTION || record.deleted || record.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(record.entityId)) invalid()
  const ctx = context(options.scope, record.entityId), metadata = await decryptRecord(record.payload, options.keyring, ctx)
  if (!object(metadata) || metadata.format !== FORMAT || metadata.version !== 1) invalid()
  const applicationKey = key(metadata.applicationKey)
  if (await entityIdForApplicationKey(applicationKey) !== record.entityId) invalid()
  if (metadata.deleted === true) {
    exact(metadata, ['format', 'version', 'applicationKey', 'deleted'])
    if (record.objectRefs !== undefined) invalid()
    return {applicationKey, entityId: record.entityId, revision: record.revision, value: null}
  }
  exact(metadata, ['format', 'version', 'applicationKey', 'prepared'])
  exact(metadata.prepared, ['descriptor', 'manifest'])
  const ref = descriptor(metadata.prepared.descriptor)
  if (!Array.isArray(record.objectRefs) || record.objectRefs.length !== 1) invalid()
  const outer = descriptor(record.objectRefs[0])
  if (outer.sha256 !== ref.sha256 || outer.byteLength !== ref.byteLength) invalid()
  const prepared: PreparedObject = {descriptor: ref, manifest: metadata.prepared.manifest as PreparedObject['manifest']}
  const encrypted = blobSink(CIPHER_LIMIT)
  await options.client.downloadObject(ref, encrypted.sink, {signal: options.signal})
  const plaintext = blobSink(APPLICATION_DATA_MAX_BYTES)
  await decryptObject(encrypted.value(), prepared, plaintext.sink, {keyring: options.keyring, context: ctx, signal: options.signal})
  cancelled(options.signal)
  let value: unknown
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await plaintext.value().arrayBuffer()))} catch {invalid()}
  // 再过滤远端已知秘密；最终本机字段恢复在store事务重读current后执行。
  return {applicationKey, entityId: record.entityId, revision: record.revision, value: projectApplicationData(validateApplicationData(value))}
}
