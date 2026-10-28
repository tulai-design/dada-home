import {createSyncClient, type CommitReceipt} from '@tulai-design/sync-sdk'
import {encryptRecord, type Keyring} from '@tulai-design/sync-sdk/crypto'
import {flushApplicationData} from './applicationData'
import {APPLICATION_SYNC_COLLECTION, decodeApplicationSyncRecord, prepareApplicationSyncRecord} from './applicationSyncCodec'
import {applicationSyncStore} from './applicationSyncStore'
import type {ApplicationSyncBinding, ApplicationSyncBindingIdentity, ApplicationSyncConflictVersion, ApplicationSyncIncoming} from './applicationSyncTypes'
import {assertPersistenceWritable, reportPersistenceError, withPersistenceExclusive} from './persistence'
import {canonical, digest} from './syncProtocol'

export type ApplicationSyncControllerOptions = {
  endpoint: string; appId: string; spaceId: string; deviceId: string; token: string; keyring: Keyring
  fetchImpl?: typeof fetch; retries?: number; timeoutMs?: number
}
export type ApplicationSyncRunOptions = {signal?: AbortSignal; maxPush?: number}
export type ApplicationSyncRunResult = {pushed: number; pulled: number; conflicts: number; hasMore: boolean; needsReload: boolean}

const cancelled = (signal: AbortSignal) => {if (signal.aborted) throw new DOMException('应用同步已取消。', 'AbortError')}
const bindingMismatch = () => new Error('应用同步目标或设备密钥与本机绑定不同，请先明确解绑；旧队列未被修改。')
function reloadRequired() {reportPersistenceError('sync-reload', new Error('应用数据已同步到本机，请重新加载后继续编辑。'))}

/** 显式程序入口：不自动联网，不持久化token/keyring，不接管现有快照provider。 */
export function createApplicationSyncController(options: ApplicationSyncControllerOptions) {
  const endpoint = new URL(options.endpoint).href.replace(/\/+$/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.deviceId)) throw new Error('同步设备标识无效。')
  const client = createSyncClient({baseUrl: endpoint, appId: options.appId, spaceId: options.spaceId, token: options.token, ...(options.fetchImpl ? {fetchImpl: options.fetchImpl} : {}), ...(options.retries !== undefined ? {retries: options.retries} : {}), ...(options.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : {})})
  const scope = {appId: options.appId, spaceId: options.spaceId}, deviceId = options.deviceId
  let keyring: Keyring
  try {keyring = JSON.parse(JSON.stringify(options.keyring)) as Keyring} catch {throw new Error('同步空间密钥格式无效。')}
  let identityPromise: Promise<ApplicationSyncBindingIdentity> | undefined, closed = false
  const active = new Set<AbortController>()
  function identity() {
    if (!identityPromise) identityPromise = (async () => {
      // SDK验证整个keyring和scope；这里只保存摘要，不把明文key写入本机同步仓。
      await encryptRecord(null, keyring, {...scope, collection: APPLICATION_SYNC_COLLECTION, entityId: '0'.repeat(64), schemaVersion: 1})
      const keyFingerprint = await digest({...keyring, keys: [...keyring.keys].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)})
      return {endpoint, ...scope, deviceId, keyFingerprint}
    })()
    return identityPromise
  }
  async function checkBinding(): Promise<ApplicationSyncBinding> {
    const binding = await applicationSyncStore.active(), expected = await identity()
    if (!binding || Object.entries(expected).some(([key, value]) => binding[key as keyof ApplicationSyncBindingIdentity] !== value)) throw bindingMismatch()
    return binding
  }
  async function locked<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) throw new Error('应用同步控制器已关闭，持久队列仍已保留。')
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
          await flushApplicationData(); cancelled(signal)
          return applicationSyncStore.bind(binding)
        })
      })
    },
    async run(settings: ApplicationSyncRunOptions = {}): Promise<ApplicationSyncRunResult> {
      const maxPush = settings.maxPush ?? 20
      if (!Number.isSafeInteger(maxPush) || maxPush < 0 || maxPush > 100) throw new Error('单次应用同步的推送上限必须在 0–100 之间。')
      return locked(settings.signal, async signal => {
        assertPersistenceWritable()
        const binding = await checkBinding(), result: ApplicationSyncRunResult = {pushed: 0, pulled: 0, conflicts: 0, hasMore: false, needsReload: false}
        await flushApplicationData(); cancelled(signal)
        const capabilities = await client.capabilities({signal})
        if (!capabilities.records || !capabilities.atomicBatch || !capabilities.idempotency || !capabilities.changeLog || !capabilities.objects) throw new Error('目标服务没有提供所需的应用增量同步能力。')
        for (let index = 0; index < maxPush; index++) {
          cancelled(signal)
          let intent = await applicationSyncStore.next(binding.epoch)
          if (!intent) break
          if (!intent.prepared) {
            const prepared = await prepareApplicationSyncRecord(intent, {scope, keyring, signal})
            cancelled(signal)
            intent = await applicationSyncStore.prepare(binding.epoch, intent.operationId, prepared)
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
              const uploaded = await client.uploadObject(prepared.ciphertext, {signal, ...(intent.checkpoint ? {checkpoint: intent.checkpoint} : {}), onCheckpoint: checkpoint => applicationSyncStore.checkpoint(binding.epoch, operationId, checkpoint)})
              const mutation = prepared.request.mutations[0], ref = mutation.type === 'put' ? mutation.objectRefs?.[0] : undefined
              if (!ref || ref.sha256 !== uploaded.sha256 || ref.byteLength !== uploaded.byteLength) throw new Error('已准备的应用对象与记录引用不一致，没有提交记录。')
            }
            receipt = await client.commit(prepared.request, {signal})
          }
          // 已取得确定回执，即便此刻发生取消也完成本地确认，避免误清后来编辑。
          await applicationSyncStore.acknowledge(binding.epoch, intent.operationId, receipt)
          if (receipt.status === 'committed') result.pushed++; else result.conflicts++
        }
        cancelled(signal)
        const current = await checkBinding()
        if (current.epoch !== binding.epoch) throw bindingMismatch()
        const page = await client.changes({cursor: current.cursor, limit: 1, signal}), records: ApplicationSyncIncoming[] = []
        // Dada此版本每次只提交一个应用；在下载前拒绝更大的事务，限制单次明文驻留量。
        if (page.commits.length > 1 || page.commits.some(commit => commit.records.length !== 1)) throw new Error('此版本仅支持每次提交一个应用的同步记录，远端游标未推进。')
        for (const commit of page.commits) for (const record of commit.records) {
          const decoded = await decodeApplicationSyncRecord(record, {scope, keyring, signal, client})
          records.push({...decoded, deviceId: commit.deviceId, operationId: commit.operationId})
        }
        cancelled(signal)
        const applied = await withPersistenceExclusive(async () => {
          await flushApplicationData(); cancelled(signal)
          const applied = await applicationSyncStore.applyPage(binding.epoch, current.cursor, {cursor: page.cursor, records})
          if (applied.changed) reloadRequired()
          return applied
        })
        result.pulled = records.length; result.conflicts += applied.conflicts
        const pending = await applicationSyncStore.inspect(binding.epoch)
        result.hasMore = page.hasMore || pending.records.some(record => !record.conflict && Boolean(record.draft || record.inFlight))
        result.needsReload = applied.changed
        return result
      })
    },
    async inspect() {const binding = await checkBinding(); return applicationSyncStore.inspect(binding.epoch)},
    async resolve(applicationKey: string, expected: ApplicationSyncConflictVersion, choice: 'local' | 'remote', settings: {signal?: AbortSignal} = {}) {
      const version = {localGeneration: expected?.localGeneration, remoteRevision: expected?.remoteRevision}
      return locked(settings.signal, async signal => {
        const binding = await checkBinding()
        return withPersistenceExclusive(async () => {
          await flushApplicationData(); cancelled(signal)
          const result = await applicationSyncStore.resolve(binding.epoch, applicationKey, version, choice)
          if (result.changed) reloadRequired()
          return {...result, needsReload: result.changed}
        })
      })
    },
    async detach(settings: {signal?: AbortSignal} = {}) {
      return locked(settings.signal, async signal => {
        const binding = await checkBinding()
        await withPersistenceExclusive(async () => {
          await flushApplicationData(); cancelled(signal)
          await applicationSyncStore.detach(binding.epoch)
        })
      })
    },
    close() {closed = true; for (const controller of active) controller.abort()},
  }
}
