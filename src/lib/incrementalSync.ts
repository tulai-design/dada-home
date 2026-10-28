import {createSyncClient, type CommitReceipt} from '@tulai-design/sync-sdk'
import {encryptRecord, type Keyring} from '@tulai-design/sync-sdk/crypto'
import {flushApplicationData} from './applicationData'
import {flush as flushChat} from './chat'
import {decodeSyncRecord, prepareSyncRecord} from './incrementalCodec'
import {incrementalStore} from './incrementalStore'
import type {SyncBinding, SyncBindingIdentity, SyncConflictVersion, SyncIncoming, SyncRef} from './incrementalRows'
import {assertPersistenceWritable, reportPersistenceError, withPersistenceExclusive} from './persistence'
import {canonical, digest} from './syncProtocol'

export type IncrementalSyncControllerOptions = {
  endpoint: string; appId: string; spaceId: string; deviceId: string; token: string; keyring: Keyring
  fetchImpl?: typeof fetch; retries?: number; timeoutMs?: number
}
export type IncrementalSyncRunOptions = {signal?: AbortSignal; maxPush?: number}
export type IncrementalSyncRunResult = {pushed: number; pulled: number; conflicts: number; hasMore: boolean; needsReload: boolean}

/** 已接受的应用与聊天写入都排空后，才能绑定、入站或解决冲突。 */
const flushSources = () => Promise.all([flushApplicationData(), flushChat()])
const cancelled = (signal: AbortSignal) => {if (signal.aborted) throw new DOMException('增量同步已取消。', 'AbortError')}
const bindingMismatch = () => new Error('增量同步目标或设备密钥与本机绑定不同，请先明确解绑；旧队列未被修改。')
function reloadRequired() {reportPersistenceError('sync-reload', new Error('应用数据已同步到本机，请重新加载后继续编辑。'))}

/** 显式程序入口：不自动联网，不持久化token/keyring，不接管现有快照provider。 */
export function createIncrementalSyncController(options: IncrementalSyncControllerOptions) {
  const endpoint = new URL(options.endpoint).href.replace(/\/+$/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.deviceId)) throw new Error('同步设备标识无效。')
  const client = createSyncClient({baseUrl: endpoint, appId: options.appId, spaceId: options.spaceId, token: options.token, ...(options.fetchImpl ? {fetchImpl: options.fetchImpl} : {}), ...(options.retries !== undefined ? {retries: options.retries} : {}), ...(options.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : {})})
  const scope = {appId: options.appId, spaceId: options.spaceId}, deviceId = options.deviceId
  let keyring: Keyring
  try {keyring = JSON.parse(JSON.stringify(options.keyring)) as Keyring} catch {throw new Error('同步空间密钥格式无效。')}
  let identityPromise: Promise<SyncBindingIdentity> | undefined, closed = false
  const active = new Set<AbortController>()
  function identity() {
    if (!identityPromise) identityPromise = (async () => {
      // SDK验证整个keyring和scope；这里只保存摘要，不把明文key写入本机同步仓。
      await encryptRecord(null, keyring, {...scope, collection: 'conversation', entityId: '0'.repeat(64), schemaVersion: 1})
      const keyFingerprint = await digest({...keyring, keys: [...keyring.keys].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)})
      return {endpoint, ...scope, deviceId, keyFingerprint}
    })()
    return identityPromise
  }
  async function checkBinding(): Promise<SyncBinding> {
    const binding = await incrementalStore.active(), expected = await identity()
    if (!binding || Object.entries(expected).some(([key, value]) => binding[key as keyof SyncBindingIdentity] !== value)) throw bindingMismatch()
    return binding
  }
  async function locked<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) throw new Error('增量同步控制器已关闭，持久队列仍已保留。')
    if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此浏览器不支持安全同步锁，请使用支持 Web Locks 的浏览器。')
    const controller = new AbortController(), abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', abort, {once: true}); active.add(controller)
    try {
      return await navigator.locks.request('dada-storage-restore', {mode: 'exclusive', signal: controller.signal}, async () => {
        cancelled(controller.signal); return work(controller.signal)
      })
    } finally {signal?.removeEventListener('abort', abort); active.delete(controller)}
  }
  return {
    async bind(settings: {signal?: AbortSignal} = {}) {
      return locked(settings.signal, async signal => {
        const binding = await identity(); cancelled(signal)
        return withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          return incrementalStore.bind(binding)
        })
      })
    },
    async run(settings: IncrementalSyncRunOptions = {}): Promise<IncrementalSyncRunResult> {
      const maxPush = settings.maxPush ?? 20
      if (!Number.isSafeInteger(maxPush) || maxPush < 0 || maxPush > 100) throw new Error('单次同步的推送上限必须在 0–100 之间。')
      return locked(settings.signal, async signal => {
        assertPersistenceWritable()
        const binding = await checkBinding(), result: IncrementalSyncRunResult = {pushed: 0, pulled: 0, conflicts: 0, hasMore: false, needsReload: false}
        await flushSources(); cancelled(signal)
        const capabilities = await client.capabilities({signal})
        if (!capabilities.records || !capabilities.atomicBatch || !capabilities.idempotency || !capabilities.changeLog || !capabilities.objects) throw new Error('目标服务没有提供所需的增量同步能力。')
        for (let index = 0; index < maxPush; index++) {
          cancelled(signal)
          const head = await incrementalStore.next(binding.epoch)
          if (!head) break
          let intent = head.intent
          if (!intent.prepared) {
            const sampled = await incrementalStore.sample(head.ref); cancelled(signal)
            const prepared = await prepareSyncRecord({ref: head.ref, value: sampled.value, operationId: intent.operationId, baseRevision: intent.baseRevision}, {scope, keyring, signal})
            cancelled(signal)
            intent = await incrementalStore.prepare(binding.epoch, intent.operationId, prepared, sampled.value === null)
          }
          const prepared = intent.prepared
          if (!prepared) throw new Error('待同步请求尚未完整保存，没有发送数据。')
          // 每次恢复都查原operation；不能沿用旧ID重新加密或修改baseRevision。
          const known = await client.operation(intent.operationId, {signal})
          let receipt: CommitReceipt
          if (known) {
            if (canonical(known.request) !== canonical(prepared.request)) throw new Error('远端原操作与本机保存的请求不一致，已保留本机队列。')
            receipt = known.receipt
          } else {
            if (prepared.ciphertext) {
              const operationId = intent.operationId
              const uploaded = await client.uploadObject(prepared.ciphertext, {signal, ...(intent.checkpoint ? {checkpoint: intent.checkpoint} : {}), onCheckpoint: checkpoint => incrementalStore.checkpoint(binding.epoch, operationId, checkpoint)})
              const mutation = prepared.request.mutations[0], ref = mutation.type === 'put' ? mutation.objectRefs?.[0] : undefined
              if (!ref || ref.sha256 !== uploaded.sha256 || ref.byteLength !== uploaded.byteLength) throw new Error('已准备的同步对象与记录引用不一致，没有提交记录。')
            }
            receipt = await client.commit(prepared.request, {signal})
          }
          // 已取得确定回执，即便此刻发生取消也完成本地确认，避免误清后来编辑。
          await incrementalStore.acknowledge(binding.epoch, intent.operationId, receipt)
          if (receipt.status === 'committed') result.pushed++; else result.conflicts++
        }
        cancelled(signal)
        const current = await checkBinding()
        if (current.epoch !== binding.epoch) throw bindingMismatch()
        const page = await client.changes({cursor: current.cursor, limit: 1, signal}), records: SyncIncoming[] = []
        // Dada此版本每次只提交一条记录；在下载前拒绝更大的事务，限制单次明文驻留量。
        if (page.commits.length > 1 || page.commits.some(commit => commit.records.length !== 1)) throw new Error('此版本仅支持每次提交一条同步记录，远端游标未推进。')
        for (const commit of page.commits) for (const record of commit.records) {
          const decoded = await decodeSyncRecord(record, {scope, keyring, signal, client})
          records.push({...decoded, deviceId: commit.deviceId, operationId: commit.operationId})
        }
        cancelled(signal)
        const applied = await withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          const applied = await incrementalStore.applyPage(binding.epoch, current.cursor, {cursor: page.cursor, records})
          if (applied.changed) reloadRequired()
          return applied
        })
        result.pulled = records.length; result.conflicts += applied.conflicts
        const pending = await incrementalStore.inspect(binding.epoch)
        result.hasMore = page.hasMore || pending.records.some(record => !record.conflict && Boolean(record.draft || record.inFlight))
        result.needsReload = applied.changed
        return result
      })
    },
    async inspect() {const binding = await checkBinding(); return incrementalStore.inspect(binding.epoch)},
    async resolve(ref: SyncRef, expected: SyncConflictVersion, choice: 'local' | 'remote', settings: {signal?: AbortSignal} = {}) {
      const version = {localGeneration: expected?.localGeneration, remoteRevision: expected?.remoteRevision}
      return locked(settings.signal, async signal => {
        const binding = await checkBinding()
        return withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          const result = await incrementalStore.resolve(binding.epoch, ref, version, choice)
          if (result.changed) reloadRequired()
          return {...result, needsReload: result.changed}
        })
      })
    },
    async detach(settings: {signal?: AbortSignal} = {}) {
      return locked(settings.signal, async signal => {
        const binding = await checkBinding()
        await withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          await incrementalStore.detach(binding.epoch)
        })
      })
    },
    close() {closed = true; for (const controller of active) controller.abort()},
  }
}
