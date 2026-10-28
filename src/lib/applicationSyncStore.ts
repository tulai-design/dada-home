import type {CommitReceipt, UploadCheckpoint} from '@tulai-design/sync-sdk'
import {db, type DbOperation, type DbRead} from './db'
import {validateApplicationData, validateApplicationDataRecord, type ApplicationData} from './applicationDataSchema'
import {projectApplicationData, restoreApplicationData} from './applicationSyncProjection'
import type {ApplicationSyncBinding, ApplicationSyncBindingIdentity, ApplicationSyncConflictVersion, ApplicationSyncIncoming, ApplicationSyncIntent, ApplicationSyncPrepared, ApplicationSyncRecordState} from './applicationSyncTypes'

const STORE = 'applicationSync' as const, ACTIVE = 'active'
const encoder = new TextEncoder(), own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positive = (value: unknown): value is number => integer(value) && value > 0
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
const invalid = (): never => {throw new Error('应用同步本地状态无效，已保留原数据。')}
const stale = (): never => {throw new Error('应用数据已在其他页面更新，请重新加载后继续；新数据未被覆盖。')}
const genKey = (key: string) => JSON.stringify(['generation', key])
const recordKey = (epoch: string, key: string) => JSON.stringify(['record', epoch, key])
const bindingKey = (epoch: string) => JSON.stringify(['binding', epoch])
const read = (key: string): DbRead => ({store: STORE, key})
const put = (value: unknown): DbOperation => ({store: STORE, type: 'put', value})
const noWrites = <T>(result: T) => ({operations: [], result})
function applicationKey(value: string): string {return validateApplicationDataRecord({k: value, v: {}}).k}
function valueOf(value: unknown): ApplicationData | null {return value === null ? null : validateApplicationData(value)}
function projected(value: ApplicationData | null): ApplicationData | null {return value === null ? null : projectApplicationData(value)}
function generation(raw: unknown): number {
  if (raw === undefined) return 0
  if (!object(raw) || raw.type !== 'generation' || !integer(raw.generation)) return invalid()
  return raw.generation
}
function nextGeneration(value: number): number {if (value >= Number.MAX_SAFE_INTEGER) return invalid(); return value + 1}
const generationRow = (key: string, value: number) => ({k: genKey(key), type: 'generation', generation: value})
function identityOf(raw: ApplicationSyncBindingIdentity): ApplicationSyncBindingIdentity {
  if (!object(raw) || Object.keys(raw).length !== 5 || !['endpoint', 'appId', 'spaceId', 'deviceId', 'keyFingerprint'].every(key => own(raw, key))) return invalid()
  if (!identifier(raw.appId) || !identifier(raw.spaceId) || !identifier(raw.deviceId) || typeof raw.keyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.keyFingerprint) || typeof raw.endpoint !== 'string') return invalid()
  const url = new URL(raw.endpoint)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return invalid()
  return {endpoint: url.href.replace(/\/$/, ''), appId: raw.appId, spaceId: raw.spaceId, deviceId: raw.deviceId, keyFingerprint: raw.keyFingerprint}
}
function bindingOf(raw: unknown): ApplicationSyncBinding | undefined {
  if (raw === undefined) return undefined
  if (!object(raw) || raw.type !== 'binding' || typeof raw.epoch !== 'string' || !identifier(raw.epoch) || raw.cursor !== undefined && (typeof raw.cursor !== 'string' || !raw.cursor.length || raw.cursor.length > 2048)) return invalid()
  const identity = identityOf({endpoint: raw.endpoint, appId: raw.appId, spaceId: raw.spaceId, deviceId: raw.deviceId, keyFingerprint: raw.keyFingerprint} as ApplicationSyncBindingIdentity)
  return {...identity, epoch: raw.epoch, ...(raw.cursor === undefined ? {} : {cursor: raw.cursor})}
}
function requireBinding(raw: unknown, epoch: string): ApplicationSyncBinding {
  const binding = bindingOf(raw)
  if (!binding || binding.epoch !== epoch) throw new Error('应用同步绑定已改变，请重新建立客户端；旧操作未应用。')
  return binding
}
const bindingRow = (binding: ApplicationSyncBinding, k = ACTIVE) => ({...binding, k, type: 'binding'})
function recordOf(raw: unknown, epoch: string, key: string): ApplicationSyncRecordState | undefined {
  if (raw === undefined) return undefined
  if (!object(raw) || raw.k !== recordKey(epoch, key) || raw.type !== 'record' || raw.epoch !== epoch || raw.applicationKey !== key || !integer(raw.generation) || raw.remoteRevision !== null && !positive(raw.remoteRevision)) return invalid()
  if (raw.draft !== undefined) {
    if (!object(raw.draft) || !integer(raw.draft.generation) || raw.draft.generation > raw.generation) return invalid()
    valueOf(raw.draft.value)
  }
  if (raw.inFlight !== undefined) {
    const intent = raw.inFlight
    if (!object(intent) || intent.applicationKey !== key || !identifier(intent.operationId) || !integer(intent.generation) || intent.generation > raw.generation || intent.baseRevision !== null && !positive(intent.baseRevision)) return invalid()
    valueOf(intent.value)
    if (intent.prepared !== undefined && (!object(intent.prepared) || !object(intent.prepared.request) || intent.prepared.request.operationId !== intent.operationId)) return invalid()
  }
  if (raw.conflict !== undefined) {
    const conflict = raw.conflict
    if (!object(conflict) || !integer(conflict.localGeneration) || typeof conflict.remoteReady !== 'boolean' || conflict.remoteRevision !== null && !positive(conflict.remoteRevision)) return invalid()
    valueOf(conflict.localValue)
    if (conflict.remoteReady) valueOf(conflict.remoteValue)
  }
  return structuredClone(raw) as ApplicationSyncRecordState
}
function freshRecord(epoch: string, key: string, gen: number): ApplicationSyncRecordState {return {k: recordKey(epoch, key), type: 'record', epoch, applicationKey: key, generation: gen, remoteRevision: null}}
function localValue(raw: unknown, key: string): ApplicationData | null {
  if (raw === undefined) return null
  const row = validateApplicationDataRecord(raw)
  if (row.k !== key) return invalid()
  return row.v
}
const appOperation = (key: string, value: ApplicationData | null): DbOperation => value === null ? {store: 'apps', type: 'delete', key} : {store: 'apps', type: 'put', value: {k: key, v: value}}
function recordsOf(rows: unknown, epoch: string): ApplicationSyncRecordState[] {
  if (!Array.isArray(rows)) return invalid()
  return rows.filter(raw => object(raw) && raw.type === 'record').map(raw => {
    if (!object(raw) || typeof raw.applicationKey !== 'string') return invalid()
    return recordOf(raw, epoch, applicationKey(raw.applicationKey))!
  })
}
function matching(records: ApplicationSyncRecordState[], operationId: string): ApplicationSyncRecordState {
  const matches = records.filter(row => row.inFlight?.operationId === operationId)
  if (matches.length !== 1) throw new Error('待同步操作已改变，未覆盖当前队列。')
  return matches[0]
}
function confirmed(record: ApplicationSyncRecordState, revision: number): void {
  const intent = record.inFlight!
  record.remoteRevision = Math.max(record.remoteRevision ?? 0, revision)
  if (record.draft && record.draft.generation <= intent.generation) delete record.draft
  delete record.inFlight
}
function checkedPrepared(raw: ApplicationSyncPrepared, intent: ApplicationSyncIntent): ApplicationSyncPrepared {
  if (!object(raw) || Object.keys(raw).some(key => !['request', 'ciphertext'].includes(key))) return invalid()
  const request = structuredClone(raw.request)
  if (!object(request) || request.protocolVersion !== 1 || request.operationId !== intent.operationId || !Array.isArray(request.mutations) || request.mutations.length !== 1) return invalid()
  const mutation = request.mutations[0]
  if (mutation.type !== 'put' || mutation.collection !== 'applicationData' || mutation.schemaVersion !== 1 || mutation.baseRevision !== intent.baseRevision || !/^[0-9a-f]{64}$/.test(mutation.entityId) || !object(mutation.payload) || mutation.payload.format !== 'tulai-encrypted') return invalid()
  if (encoder.encode(JSON.stringify(request)).length > 262144) return invalid()
  if (intent.value === null) {
    if (raw.ciphertext !== undefined || mutation.objectRefs?.length) return invalid()
    return {request}
  }
  if (!(raw.ciphertext instanceof Blob) || raw.ciphertext.size > 8 * 1024 * 1024 + 9 * 16 || mutation.objectRefs?.length !== 1 || mutation.objectRefs[0].byteLength !== raw.ciphertext.size) return invalid()
  return {request, ciphertext: raw.ciphertext.slice()}
}

/** 仅保存本机协调数据；所有返回等待IDB提交，token与keyring不进入此仓。 */
export const applicationSyncStore = {
  async active(): Promise<ApplicationSyncBinding | undefined> {return bindingOf(await db.get(STORE, ACTIVE))},

  async bind(rawIdentity: ApplicationSyncBindingIdentity): Promise<ApplicationSyncBinding> {
    const identity = identityOf(rawIdentity), epoch = crypto.randomUUID()
    return db.atomic(['apps', STORE], [read(ACTIVE), {store: 'apps', all: true}, {store: STORE, all: true, index: 'type', key: 'generation'}], values => {
      const current = bindingOf(values[0])
      if (current) {
        if (Object.entries(identity).some(([key, value]) => current[key as keyof ApplicationSyncBindingIdentity] !== value)) throw new Error('已有不同的应用同步绑定，请先显式解绑。')
        return noWrites(current)
      }
      if (!Array.isArray(values[1]) || !Array.isArray(values[2])) return invalid()
      const metadata = new Map(values[2].map(raw => {if (!object(raw) || typeof raw.k !== 'string') return invalid(); return [raw.k, raw]}))
      const binding = {...identity, epoch}, operations: DbOperation[] = [put(bindingRow(binding)), put(bindingRow(binding, bindingKey(epoch)))]
      for (const raw of values[1]) {
        const row = validateApplicationDataRecord(raw), gen = generation(metadata.get(genKey(row.k)))
        const record = freshRecord(epoch, row.k, gen)
        record.draft = {generation: gen, value: projected(row.v)}
        operations.push(put(generationRow(row.k, gen)), put(record))
      }
      return {operations, result: binding}
    })
  },

  async detach(epoch: string): Promise<void> {
    await db.atomic([STORE], [read(ACTIVE)], values => {requireBinding(values[0], epoch); return {operations: [{store: STORE, type: 'delete', key: ACTIVE}], result: undefined}})
  },

  /** 恢复/整包同步专用：无活动绑定才允许写apps，同时使其他标签的缓存版本失效。 */
  async commitExternal(operations: DbOperation[]): Promise<void> {
    if (!operations.some(operation => operation.store === 'apps')) {await db.batch(operations); return}
    const snapshot = structuredClone(operations)
    const stores = [...new Set([...snapshot.map(operation => operation.store), 'apps' as const, STORE])]
    await db.atomic(stores, [read(ACTIVE), {store: 'apps', all: true}, {store: STORE, all: true, index: 'type', key: 'generation'}], values => {
      if (bindingOf(values[0])) throw new Error('应用增量同步仍已绑定，请先显式解绑，再恢复备份或应用整包快照。')
      if (!Array.isArray(values[1]) || !Array.isArray(values[2])) return invalid()
      const changed = new Set<string>(), all = new Set<string>()
      for (const raw of values[1]) {if (!object(raw) || typeof raw.k !== 'string') return invalid(); all.add(raw.k)}
      const generations = new Map<string, unknown>()
      for (const raw of values[2]) {if (!object(raw) || typeof raw.k !== 'string') return invalid(); generations.set(raw.k, raw)}
      for (const operation of snapshot) if (operation.store === 'apps') {
        if (operation.type === 'clear') for (const key of all) changed.add(key)
        else {
          const key = operation.type === 'delete' ? operation.key : object(operation.value) && typeof operation.value.k === 'string' ? operation.value.k : invalid()
          changed.add(key); if (operation.type === 'put') all.add(key)
        }
      }
      const bumps = [...changed].map(key => put(generationRow(key, nextGeneration(generation(generations.get(genKey(key)))))))
      return {operations: [...snapshot, ...bumps], result: undefined}
    })
  },

  async loadLocal(rawKey: string): Promise<{value: ApplicationData | null; generation: number}> {
    const key = applicationKey(rawKey)
    return db.atomic(['apps', STORE], [{store: 'apps', key}, read(genKey(key))], values => noWrites({value: localValue(values[0], key), generation: generation(values[1])}))
  },

  async saveLocal(rawKey: string, rawValue: ApplicationData | null, expectedGeneration: number): Promise<number> {
    const key = applicationKey(rawKey), value = valueOf(rawValue), draftValue = projected(value)
    if (!integer(expectedGeneration)) return invalid()
    const sampled = await this.active()
    // 绑定与record均须同事务读取；先前epoch的结果不能写入当前绑定。
    return db.atomic(['apps', STORE], [read(ACTIVE), read(genKey(key)), ...(sampled ? [read(recordKey(sampled.epoch, key))] : [])], values => {
      const gen = generation(values[1]); if (gen !== expectedGeneration) return stale()
      const next = nextGeneration(gen), binding = bindingOf(values[0]), operations: DbOperation[] = [appOperation(key, value), put(generationRow(key, next))]
      if (binding?.epoch !== sampled?.epoch) throw new Error('保存期间应用同步绑定已改变，请重试保存。')
      if (binding) {
        const record = recordOf(values[2], binding.epoch, key) ?? freshRecord(binding.epoch, key, gen)
        record.generation = next; record.draft = {generation: next, value: draftValue}
        if (record.conflict) {record.conflict.localGeneration = next; record.conflict.localValue = draftValue}
        operations.push(put(record))
      }
      return {operations, result: next}
    })
  },

  async next(epoch: string): Promise<ApplicationSyncIntent | undefined> {
    return db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const records = recordsOf(values[1], epoch), row = records.find(record => record.inFlight && !record.conflict) ?? records.find(record => record.draft && !record.conflict)
      if (!row) return noWrites(undefined)
      if (row.inFlight) return noWrites(row.inFlight)
      const draft = row.draft!
      row.inFlight = {applicationKey: row.applicationKey, value: draft.value, generation: draft.generation, operationId: crypto.randomUUID(), baseRevision: row.remoteRevision}
      return {operations: [put(row)], result: row.inFlight}
    })
  },

  async prepare(epoch: string, operationId: string, raw: ApplicationSyncPrepared): Promise<ApplicationSyncIntent> {
    const snapshot = structuredClone(raw)
    return db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const row = matching(recordsOf(values[1], epoch), operationId), intent = row.inFlight!
      if (intent.prepared) return noWrites(intent)
      intent.prepared = checkedPrepared(snapshot, intent)
      return {operations: [put(row)], result: intent}
    })
  },

  async checkpoint(epoch: string, operationId: string, checkpoint: UploadCheckpoint): Promise<void> {
    const snapshot = structuredClone(checkpoint)
    await db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      const binding = requireBinding(values[0], epoch), row = matching(recordsOf(values[1], epoch), operationId), intent = row.inFlight!
      const ref = intent.prepared?.request.mutations[0]
      if (!ref || ref.type !== 'put' || ref.objectRefs?.length !== 1 || snapshot.appId !== binding.appId || snapshot.spaceId !== binding.spaceId || snapshot.sha256 !== ref.objectRefs[0].sha256 || snapshot.byteLength !== ref.objectRefs[0].byteLength || !identifier(snapshot.uploadId) || Object.keys(snapshot).length !== 5) return invalid()
      intent.checkpoint = snapshot
      return {operations: [put(row)], result: undefined}
    })
  },

  async acknowledge(epoch: string, operationId: string, receipt: CommitReceipt): Promise<void> {
    const snapshot = structuredClone(receipt)
    await db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const records = recordsOf(values[1], epoch), row = matching(records, operationId), intent = row.inFlight!
      if (!intent.prepared || snapshot.operationId !== operationId || snapshot.protocolVersion !== 1) return invalid()
      if (snapshot.status === 'committed') {
        if (!positive(snapshot.revision) || snapshot.records.length !== 1 || snapshot.records[0].entityId !== intent.prepared.request.mutations[0].entityId || snapshot.records[0].revision !== snapshot.revision || snapshot.records[0].deleted) return invalid()
        confirmed(row, snapshot.revision)
      } else {
        if (snapshot.status !== 'conflict' || snapshot.conflicts.length !== 1 || snapshot.conflicts[0].entityId !== intent.prepared.request.mutations[0].entityId) return invalid()
        row.conflict = {localGeneration: row.generation, localValue: row.draft ? row.draft.value : intent.value, remoteRevision: snapshot.conflicts[0].currentRevision, remoteReady: false, operationId, receipt: snapshot}
      }
      return {operations: [put(row)], result: undefined}
    })
  },

  async applyPage(epoch: string, expectedCursor: string | undefined, page: {cursor: string; records: ApplicationSyncIncoming[]}): Promise<{changed: boolean; conflicts: number}> {
    if (typeof page.cursor !== 'string' || !page.cursor.length || page.cursor.length > 2048 || !Array.isArray(page.records) || page.records.length > 2000) return invalid()
    const incoming = page.records.map(raw => {
      const key = applicationKey(raw.applicationKey)
      if (!positive(raw.revision) || !identifier(raw.deviceId) || !identifier(raw.operationId) || !/^[0-9a-f]{64}$/.test(raw.entityId)) return invalid()
      return {...raw, applicationKey: key, value: valueOf(raw.value)}
    })
    const keys = [...new Set(incoming.map(row => row.applicationKey))]
    const reads: DbRead[] = [read(ACTIVE), ...keys.flatMap(key => [{store: 'apps' as const, key}, read(genKey(key)), read(recordKey(epoch, key))])]
    return db.atomic(['apps', STORE], reads, values => {
      const binding = requireBinding(values[0], epoch)
      if (binding.cursor !== expectedCursor) throw new Error('应用同步游标已改变，未重复应用旧页面。')
      const states = new Map(keys.map((key, index) => {
        const offset = 1 + index * 3, gen = generation(values[offset + 1])
        return [key, {value: localValue(values[offset], key), gen, record: recordOf(values[offset + 2], epoch, key) ?? freshRecord(epoch, key, gen)}]
      }))
      const operations: DbOperation[] = []; let changed = false, conflicts = 0
      for (const item of incoming) {
        const state = states.get(item.applicationKey)!, row = state.record
        if (item.revision <= (row.remoteRevision ?? 0)) continue
        if (row.inFlight?.operationId === item.operationId && item.deviceId === binding.deviceId) {
          confirmed(row, item.revision)
        } else if (row.draft || row.inFlight || row.conflict) {
          row.remoteRevision = item.revision
          row.conflict = {localGeneration: state.gen, localValue: projected(state.value), remoteRevision: item.revision, remoteReady: true, remoteValue: projected(item.value), ...(row.inFlight ? {operationId: row.inFlight.operationId} : {})}
          conflicts++
        } else {
          const next = item.value === null ? null : restoreApplicationData(item.value, state.value ?? {})
          state.gen = nextGeneration(state.gen); state.value = next; row.generation = state.gen; row.remoteRevision = item.revision
          operations.push(appOperation(item.applicationKey, next), put(generationRow(item.applicationKey, state.gen))); changed = true
        }
        operations.push(put(structuredClone(row)))
      }
      binding.cursor = page.cursor
      operations.push(put(bindingRow(binding)), put(bindingRow(binding, bindingKey(epoch))))
      return {operations, result: {changed, conflicts}}
    })
  },

  async inspect(epoch?: string): Promise<{binding: ApplicationSyncBinding | undefined; records: ApplicationSyncRecordState[]}> {
    if (epoch !== undefined && !identifier(epoch)) return invalid()
    const target = epoch ?? (await this.active())?.epoch
    return db.atomic([STORE], [read(epoch === undefined ? ACTIVE : bindingKey(epoch)), ...(target ? [{store: STORE, all: true as const, index: 'epoch', key: target}] : [])], values => {
      const binding = bindingOf(values[0])
      if (epoch === undefined && binding?.epoch !== target) throw new Error('应用同步绑定已改变，请重新读取本机状态。')
      return noWrites({binding, records: target ? recordsOf(values[1], target) : []})
    })
  },

  async resolve(epoch: string, rawKey: string, expected: ApplicationSyncConflictVersion, choice: 'local' | 'remote'): Promise<{changed: boolean}> {
    const key = applicationKey(rawKey)
    if (!object(expected) || Object.keys(expected).length !== 2 || !integer(expected.localGeneration) || !positive(expected.remoteRevision) || !['local', 'remote'].includes(choice)) return invalid()
    const {localGeneration: expectedGeneration, remoteRevision: expectedRemote} = expected
    return db.atomic(['apps', STORE], [read(ACTIVE), read(recordKey(epoch, key)), read(genKey(key)), {store: 'apps', key}], values => {
      requireBinding(values[0], epoch)
      const row = recordOf(values[1], epoch, key), gen = generation(values[2]), current = localValue(values[3], key)
      if (!row?.conflict?.remoteReady) throw new Error('尚未读取到冲突的远端内容，请先继续同步。')
      if (gen !== expectedGeneration || row.conflict.localGeneration !== expectedGeneration) return stale()
      if (row.conflict.remoteRevision !== expectedRemote) throw new Error('远端冲突已出现新版本，请重新查看双方内容后选择。')
      const next = nextGeneration(gen), remote = row.conflict.remoteValue!
      const selected = choice === 'local' ? current : remote === null ? null : restoreApplicationData(remote, current ?? {})
      row.generation = next; row.remoteRevision = row.conflict.remoteRevision; delete row.inFlight; delete row.conflict; delete row.draft
      if (choice === 'local') row.draft = {generation: next, value: projected(current)}
      return {operations: [appOperation(key, selected), put(generationRow(key, next)), put(row)], result: {changed: true}}
    })
  },
}
