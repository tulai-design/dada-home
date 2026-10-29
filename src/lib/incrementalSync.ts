import {createSyncClient, type CommitReceipt} from '@tulai-design/sync-sdk'
import {encryptRecord, type Keyring} from '@tulai-design/sync-sdk/crypto'
import {flushApplicationData} from './applicationData'
import {flush as flushChat} from './chat'
import {flush as flushComponents} from './componentData'
import {applyPendingConfig, reconcileConfig} from './incrementalConfig'
import {decodeSyncRecord, prepareSyncRecord} from './incrementalCodec'
import {incrementalStore} from './incrementalStore'
import {SYNC_COLLECTIONS, type SyncBinding, type SyncBindingIdentity, type SyncCollection, type SyncConflictVersion, type SyncIncoming, type SyncRef} from './incrementalRows'
import {assertPersistenceWritable, reportPersistenceError, withPersistenceExclusive} from './persistence'
import {canonical, digest} from './syncProtocol'

export type IncrementalSyncControllerOptions = {
  endpoint: string; appId: string; spaceId: string; deviceId: string; token: string; keyring: Keyring
  /** 参与同步的集合；缺省为全部。关闭的集合保留本机与远端数据，只是不发送也不应用。 */
  collections?: readonly SyncCollection[]
  fetchImpl?: typeof fetch; retries?: number; timeoutMs?: number
}
/** pull 为 false 时只上传，不拉取也不应用远端数据，避免打断正在进行的编辑。 */
export type IncrementalSyncRunOptions = {signal?: AbortSignal; maxPush?: number; maxPull?: number; pull?: boolean}
export type IncrementalSyncRunResult = {pushed: number; pulled: number; conflicts: number; hasMore: boolean; needsReload: boolean}

/** 已接受的应用与聊天写入都排空后，才能绑定、入站或解决冲突。 */
const flushSources = () => Promise.all([flushApplicationData(), flushChat(), flushComponents()])
const cancelled = (signal: AbortSignal) => {if (signal.aborted) throw new DOMException('增量同步已取消。', 'AbortError')}
const bindingMismatch = () => new Error('增量同步目标或设备密钥与本机绑定不同，请先明确解绑；旧队列未被修改。')
function reloadRequired() {reportPersistenceError('sync-reload', new Error('应用数据已同步到本机，请重新加载后继续编辑。'))}

/** 显式程序入口：不自动联网，不持久化token/keyring，不接管现有快照provider。 */
export function createIncrementalSyncController(options: IncrementalSyncControllerOptions) {
  const endpoint = new URL(options.endpoint).href.replace(/\/+$/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.deviceId)) throw new Error('同步设备标识无效。')
  const client = createSyncClient({baseUrl: endpoint, appId: options.appId, spaceId: options.spaceId, token: options.token, ...(options.fetchImpl ? {fetchImpl: options.fetchImpl} : {}), ...(options.retries !== undefined ? {retries: options.retries} : {}), ...(options.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : {})})
  const scope = {appId: options.appId, spaceId: options.spaceId}, deviceId = options.deviceId
  const enabled: readonly SyncCollection[] = options.collections ?? SYNC_COLLECTIONS
  if (!Array.isArray(enabled) || enabled.some(item => !SYNC_COLLECTIONS.includes(item))) throw new Error('同步范围包含未知的集合。')
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
        }, {quiet: true})
      })
    },
    async run(settings: IncrementalSyncRunOptions = {}): Promise<IncrementalSyncRunResult> {
      const maxPush = settings.maxPush ?? 20, maxPull = settings.maxPull ?? 1
      if (!Number.isSafeInteger(maxPush) || maxPush < 0 || maxPush > 100) throw new Error('单次同步的推送上限必须在 0–100 之间。')
      if (!Number.isSafeInteger(maxPull) || maxPull < 1 || maxPull > 10000) throw new Error('单次同步的拉取上限必须在 1–10000 之间。')
      return locked(settings.signal, async signal => {
        assertPersistenceWritable()
        const binding = await checkBinding(), result: IncrementalSyncRunResult = {pushed: 0, pulled: 0, conflicts: 0, hasMore: false, needsReload: false}
        // 正常启动会先重放待应用配置；若运行中仍发现恢复行，先完成落盘并要求重载，
        // 不能让这一轮继续采样恢复前的业务内存。
        const recovered = await withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          try {
            const count = await applyPendingConfig()
            if (count) reloadRequired()
            return count
          } catch (error) {
            // 写入多条配置时可能已部分落盘，不能解除门禁后继续使用旧内存。
            reportPersistenceError('sync-reload', new Error('同步配置尚未完成，请重新加载后重试。'))
            throw error
          }
        }, {quiet: true})
        if (recovered) return {...result, hasMore: true, needsReload: true}
        await reconcileConfig(binding.epoch); cancelled(signal)
        const capabilities = await client.capabilities({signal})
        if (!capabilities.records || !capabilities.atomicBatch || !capabilities.idempotency || !capabilities.changeLog || !capabilities.objects) throw new Error('目标服务没有提供所需的增量同步能力。')
        for (let index = 0; index < maxPush; index++) {
          cancelled(signal)
          const head = await incrementalStore.next(binding.epoch, enabled)
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
        if (settings.pull === false) {
          const queued = await incrementalStore.inspect(binding.epoch)
          result.hasMore = queued.records.some(record => enabled.includes(record.collection) && !record.conflict && Boolean(record.draft || record.inFlight))
          return result
        }
        const downloadPage = async (cursor: string | undefined) => {
          const page = await client.changes({cursor, limit: 1, signal}), records: SyncIncoming[] = []
          // 保持每页一个提交/记录的明文预算，连续处理不意味着一次加载整个历史。
          if (page.commits.length > 1 || page.commits.some(commit => commit.records.length !== 1)) throw new Error('此版本仅支持每次提交一条同步记录，远端游标未推进。')
          if (page.hasMore && page.cursor === cursor) throw new Error('远端同步游标没有前进，请稍后重试。')
          for (const commit of page.commits) for (const record of commit.records) {
            if (!enabled.includes(record.collection as SyncCollection)) continue
            const decoded = await decodeSyncRecord(record, {scope, keyring, signal, client})
            records.push({...decoded, deviceId: commit.deviceId, operationId: commit.operationId})
          }
          cancelled(signal)
          return {page, records}
        }
        // 第一页在门禁外下载；应用前排空期间的修改并重新对账配置。
        // 后续页始终在同一门禁内，不重新 flush 或采样可能已陈旧的业务缓存。
        let next = await downloadPage(current.cursor)
        await withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          await reconcileConfig(binding.epoch); cancelled(signal)
          let cursor = current.cursor
          for (let index = 0; index < maxPull; index++) {
            const {page, records} = next
            const applied = await incrementalStore.applyPage(binding.epoch, cursor, {cursor: page.cursor, records})
            result.pulled += records.length; result.conflicts += applied.conflicts
            if (applied.changed) {
              // IDB 已提交，后续 localStorage 写入或网络失败也必须阻止旧缓存写回。
              result.needsReload = true; reloadRequired()
              await applyPendingConfig()
            }
            cursor = page.cursor; result.hasMore = page.hasMore
            if (!page.hasMore || index + 1 === maxPull) break
            next = await downloadPage(cursor)
          }
        }, {quiet: true})
        const pending = await incrementalStore.inspect(binding.epoch)
        result.hasMore ||= pending.records.some(record => enabled.includes(record.collection) && !record.conflict && Boolean(record.draft || record.inFlight))
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
          if (result.changed) {reloadRequired(); await applyPendingConfig()}
          return {...result, needsReload: result.changed}
        }, {quiet: true})
      })
    },
    /** 重新开启同步范围之后调用：从头核对远端，补上关闭期间跳过的记录。 */
    async rewind(settings: {signal?: AbortSignal} = {}) {
      return locked(settings.signal, async () => {
        const binding = await checkBinding()
        await withPersistenceExclusive(() => incrementalStore.rewind(binding.epoch), {quiet: true})
      })
    },
    async detach(settings: {signal?: AbortSignal} = {}) {
      return locked(settings.signal, async signal => {
        const binding = await checkBinding()
        await withPersistenceExclusive(async () => {
          await flushSources(); cancelled(signal)
          await incrementalStore.detach(binding.epoch)
        }, {quiet: true})
      })
    },
    close() {closed = true; for (const controller of active) controller.abort()},
  }
}
