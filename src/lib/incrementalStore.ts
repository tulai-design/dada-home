import type {CommitReceipt, UploadCheckpoint} from '@tulai-design/sync-sdk'
import {db, type DbOperation, type DbRead} from './db'
import {adapterOf, type SyncAdapter} from './incrementalAdapters'
import {
  ACTIVE, STORE, SYNC_COLLECTIONS, bindingChanged, bindingKey, bindingOf, bindingRow, checkRef, freshRecord, generationOf, generationRow, genKey, identifier, integer,
  invalid, isObject, nextGeneration, noWrites, normalizeIdentity, positive, put, putRecord, read, recordKey, recordOf, recordsOf, requireBinding, stale,
  type JsonValue, type SyncBinding, type SyncBindingIdentity, type SyncConflictVersion, type SyncIncoming, type SyncIntent, type SyncPrepared, type SyncCollection, type SyncRecordState, type SyncRef,
} from './incrementalRows'

const encoder = new TextEncoder()
const REQUEST_LIMIT = 262144
export const refId = (ref: SyncRef) => JSON.stringify([ref.collection, ref.key])
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function checkedRef(raw: SyncRef): {ref: SyncRef; adapter: SyncAdapter} {
  const ref = checkRef(raw), adapter = adapterOf(ref.collection)
  return {ref: {collection: ref.collection, key: adapter.key(ref.key)}, adapter}
}
function matching(records: SyncRecordState[], operationId: string): SyncRecordState {
  const matches = records.filter(row => row.inFlight?.operationId === operationId)
  if (matches.length !== 1) throw new Error('待同步操作已改变，未覆盖当前队列。')
  return matches[0]
}
function confirmed(record: SyncRecordState, revision: number): void {
  const intent = record.inFlight!
  record.remoteRevision = Math.max(record.remoteRevision ?? 0, revision)
  if (record.draft && record.draft.generation <= intent.generation) delete record.draft
  delete record.inFlight
}
function checkedPrepared(raw: SyncPrepared, row: SyncRecordState, intent: SyncIntent, deleting: boolean): SyncPrepared {
  if (!isObject(raw) || Object.keys(raw).some(key => !['request', 'ciphertext'].includes(key))) return invalid()
  const request = structuredClone(raw.request)
  if (!isObject(request) || request.protocolVersion !== 1 || request.operationId !== intent.operationId || !Array.isArray(request.mutations) || request.mutations.length !== 1) return invalid()
  const mutation = request.mutations[0]
  if (mutation.type !== 'put' || mutation.collection !== row.collection || mutation.schemaVersion !== 1 || mutation.baseRevision !== intent.baseRevision || !sha(mutation.entityId) || !isObject(mutation.payload) || mutation.payload.format !== 'tulai-encrypted') return invalid()
  if (encoder.encode(JSON.stringify(request)).length > REQUEST_LIMIT) return invalid()
  if (deleting) {
    if (raw.ciphertext !== undefined || mutation.objectRefs?.length) return invalid()
    return {request}
  }
  if (!(raw.ciphertext instanceof Blob) || mutation.objectRefs?.length !== 1 || mutation.objectRefs[0].byteLength !== raw.ciphertext.size) return invalid()
  return {request, ciphertext: raw.ciphertext.slice()}
}

/** 仅保存本机协调数据；token 与 keyring 不进入此仓。所有返回均等待 IDB 提交。 */
export const incrementalStore = {
  async active(): Promise<SyncBinding | undefined> {return bindingOf(await db.get(STORE, ACTIVE))},

  async bind(rawIdentity: SyncBindingIdentity): Promise<SyncBinding> {
    const identity = normalizeIdentity(rawIdentity), epoch = crypto.randomUUID()
    const adapters = SYNC_COLLECTIONS.flatMap(collection => { try {const adapter = adapterOf(collection); return adapter.seed ? [adapter] : []} catch {return []} })
    const stores = [...new Set([...adapters.flatMap(adapter => adapter.stores), STORE])]
    const reads: DbRead[] = [read(ACTIVE), {store: STORE, all: true, index: 'type', key: 'generation'}, ...adapters.map(adapter => adapter.seed!.read)]
    return db.atomic(stores, reads, values => {
      const current = bindingOf(values[0])
      if (current) {
        if (Object.entries(identity).some(([key, value]) => current[key as keyof SyncBindingIdentity] !== value)) throw new Error('已有不同的增量同步绑定，请先显式解绑。')
        return noWrites(current)
      }
      if (!Array.isArray(values[1])) return invalid()
      const metadata = new Map(values[1].map(raw => {if (!isObject(raw) || typeof raw.k !== 'string') return invalid(); return [raw.k, raw]}))
      const binding: SyncBinding = {...identity, epoch}, operations: DbOperation[] = [put(bindingRow(binding)), put(bindingRow(binding, bindingKey(epoch)))]
      adapters.forEach((adapter, index) => {
        const rows = values[2 + index]
        if (!Array.isArray(rows)) return invalid()
        for (const raw of rows) {
          const ref = {collection: adapter.collection, key: adapter.seed!.key(raw)}, gen = generationOf(metadata.get(genKey(refId(ref))))
          const record = freshRecord(epoch, ref, gen)
          record.draft = {generation: gen}
          operations.push(put(generationRow(refId(ref), gen)), putRecord(record))
        }
      })
      return {operations, result: binding}
    })
  },

  async detach(epoch: string): Promise<void> {
    await db.atomic([STORE], [read(ACTIVE)], values => {requireBinding(values[0], epoch); return {operations: [{store: STORE, type: 'delete', key: ACTIVE}], result: undefined}})
  },

  /** 读取本机当前可携值与 generation，用于首次发送前加密；不修改任何数据。 */
  async sample(rawRef: SyncRef): Promise<{value: JsonValue | null; generation: number}> {
    const {ref, adapter} = checkedRef(rawRef)
    return db.atomic([...adapter.stores, STORE], [read(genKey(refId(ref))), ...adapter.reads(ref.key)], values => noWrites({value: adapter.value(ref.key, values.slice(1)), generation: generationOf(values[0])}))
  },

  /** enabled 缺省为全部集合；已关闭集合的草稿原样保留，不发送也不丢弃。 */
  async next(epoch: string, enabled?: readonly SyncCollection[]): Promise<{ref: SyncRef; intent: SyncIntent} | undefined> {
    return db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const on = (record: SyncRecordState) => enabled === undefined || enabled.includes(record.collection)
      const records = recordsOf(values[1], epoch), row = records.find(record => record.inFlight && !record.conflict && on(record)) ?? records.find(record => record.draft && !record.conflict && on(record))
      if (!row) return noWrites(undefined)
      const ref = {collection: row.collection, key: row.key}
      if (row.inFlight) return noWrites({ref, intent: row.inFlight})
      const draft = row.draft!
      row.inFlight = {generation: draft.generation, operationId: crypto.randomUUID(), baseRevision: row.remoteRevision}
      return {operations: [putRecord(row)], result: {ref, intent: row.inFlight}}
    })
  },

  /** 重新开启被关闭的同步范围后，从头核对远端；已应用的记录会按 revision 跳过。 */
  async rewind(epoch: string): Promise<void> {
    await db.atomic([STORE], [read(ACTIVE)], values => {
      const binding = requireBinding(values[0], epoch)
      delete binding.cursor
      return {operations: [put(bindingRow(binding)), put(bindingRow(binding, bindingKey(epoch)))], result: undefined}
    })
  },

  async prepare(epoch: string, operationId: string, raw: SyncPrepared, deleting: boolean): Promise<SyncIntent> {
    const snapshot = structuredClone(raw)
    return db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const row = matching(recordsOf(values[1], epoch), operationId), intent = row.inFlight!
      if (intent.prepared) return noWrites(intent)
      intent.prepared = checkedPrepared(snapshot, row, intent, deleting)
      return {operations: [putRecord(row)], result: intent}
    })
  },

  async checkpoint(epoch: string, operationId: string, checkpoint: UploadCheckpoint): Promise<void> {
    const snapshot = structuredClone(checkpoint)
    await db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      const binding = requireBinding(values[0], epoch), row = matching(recordsOf(values[1], epoch), operationId), intent = row.inFlight!
      const mutation = intent.prepared?.request.mutations[0]
      if (!mutation || mutation.type !== 'put' || mutation.objectRefs?.length !== 1 || snapshot.appId !== binding.appId || snapshot.spaceId !== binding.spaceId || snapshot.sha256 !== mutation.objectRefs[0].sha256 || snapshot.byteLength !== mutation.objectRefs[0].byteLength || !identifier(snapshot.uploadId) || Object.keys(snapshot).length !== 5) return invalid()
      intent.checkpoint = snapshot
      return {operations: [putRecord(row)], result: undefined}
    })
  },

  async acknowledge(epoch: string, operationId: string, receipt: CommitReceipt): Promise<void> {
    const snapshot = structuredClone(receipt)
    await db.atomic([STORE], [read(ACTIVE), {store: STORE, all: true, index: 'epoch', key: epoch}], values => {
      requireBinding(values[0], epoch)
      const row = matching(recordsOf(values[1], epoch), operationId), intent = row.inFlight!, mutation = intent.prepared?.request.mutations[0]
      if (!mutation || snapshot.operationId !== operationId || snapshot.protocolVersion !== 1) return invalid()
      if (snapshot.status === 'committed') {
        if (!positive(snapshot.revision) || snapshot.records.length !== 1 || snapshot.records[0].entityId !== mutation.entityId || snapshot.records[0].revision !== snapshot.revision || snapshot.records[0].deleted) return invalid()
        confirmed(row, snapshot.revision)
      } else {
        if (snapshot.status !== 'conflict' || snapshot.conflicts.length !== 1 || snapshot.conflicts[0].entityId !== mutation.entityId) return invalid()
        row.conflict = {localGeneration: row.generation, remoteRevision: snapshot.conflicts[0].currentRevision, remoteReady: false, operationId, receipt: snapshot}
      }
      return {operations: [putRecord(row)], result: undefined}
    })
  },

  async applyPage(epoch: string, expectedCursor: string | undefined, page: {cursor: string; records: SyncIncoming[]}): Promise<{changed: boolean; conflicts: number}> {
    if (typeof page.cursor !== 'string' || !page.cursor.length || page.cursor.length > 2048 || !Array.isArray(page.records) || page.records.length > 2000) return invalid()
    const incoming = page.records.map(raw => {
      const {ref, adapter} = checkedRef(raw.ref)
      if (!positive(raw.revision) || !identifier(raw.deviceId) || !identifier(raw.operationId) || !sha(raw.entityId)) return invalid()
      return {...raw, ref, value: adapter.check(raw.value)}
    })
    const refs = [...new Map(incoming.map(item => [refId(item.ref), item.ref])).values()]
    const reads: DbRead[] = [read(ACTIVE)], spans: {ref: SyncRef; adapter: SyncAdapter; offset: number; length: number}[] = []
    for (const ref of refs) {
      const adapter = adapterOf(ref.collection), local = adapter.reads(ref.key)
      spans.push({ref, adapter, offset: reads.length, length: local.length})
      reads.push(read(genKey(refId(ref))), read(recordKey(epoch, ref)), ...local)
    }
    const stores = [...new Set([...spans.flatMap(span => span.adapter.stores), STORE])]
    return db.atomic(stores, reads, values => {
      const binding = requireBinding(values[0], epoch)
      if (binding.cursor !== expectedCursor) throw new Error('增量同步游标已改变，未重复应用旧页面。')
      const states = new Map(spans.map(span => {
        const gen = generationOf(values[span.offset]), record = recordOf(values[span.offset + 1], epoch, span.ref) ?? freshRecord(epoch, span.ref, gen)
        return [refId(span.ref), {span, raws: values.slice(span.offset + 2, span.offset + 2 + span.length), gen: Math.max(gen, record.generation), record}]
      }))
      const operations: DbOperation[] = []; let changed = false, conflicts = 0
      for (const item of incoming) {
        const state = states.get(refId(item.ref))!, row = state.record
        if (item.revision <= (row.remoteRevision ?? 0)) continue
        if (row.inFlight?.operationId === item.operationId && item.deviceId === binding.deviceId) {
          confirmed(row, item.revision)
        } else if (row.draft || row.inFlight || row.conflict) {
          row.remoteRevision = item.revision
          row.conflict = {localGeneration: state.gen, remoteRevision: item.revision, remoteReady: true, remoteValue: item.value, ...(row.inFlight ? {operationId: row.inFlight.operationId} : {})}
          conflicts++
        } else {
          state.gen = nextGeneration(state.gen); row.generation = state.gen; row.remoteRevision = item.revision
          operations.push(...state.span.adapter.apply(item.ref.key, item.value, state.raws), put(generationRow(refId(item.ref), state.gen))); changed = true
        }
        operations.push(putRecord(structuredClone(row)))
      }
      binding.cursor = page.cursor
      operations.push(put(bindingRow(binding)), put(bindingRow(binding, bindingKey(epoch))))
      return {operations, result: {changed, conflicts}}
    })
  },

  async inspect(epoch?: string): Promise<{binding: SyncBinding | undefined; records: SyncRecordState[]}> {
    if (epoch !== undefined && !identifier(epoch)) return invalid()
    const target = epoch ?? (await this.active())?.epoch
    return db.atomic([STORE], [read(epoch === undefined ? ACTIVE : bindingKey(epoch)), ...(target ? [{store: STORE, all: true as const, index: 'epoch', key: target}] : [])], values => {
      const binding = bindingOf(values[0])
      if (epoch === undefined && binding?.epoch !== target) throw bindingChanged()
      return noWrites({binding, records: target ? recordsOf(values[1], target) : []})
    })
  },

  async resolve(epoch: string, rawRef: SyncRef, expected: SyncConflictVersion, choice: 'local' | 'remote'): Promise<{changed: boolean}> {
    const {ref, adapter} = checkedRef(rawRef)
    if (!isObject(expected) || Object.keys(expected).length !== 2 || !integer(expected.localGeneration) || !positive(expected.remoteRevision) || !['local', 'remote'].includes(choice)) return invalid()
    const {localGeneration: expectedGeneration, remoteRevision: expectedRemote} = expected
    return db.atomic([...adapter.stores, STORE], [read(ACTIVE), read(recordKey(epoch, ref)), read(genKey(refId(ref))), ...adapter.reads(ref.key)], values => {
      requireBinding(values[0], epoch)
      const row = recordOf(values[1], epoch, ref)
      if (!row?.conflict?.remoteReady) throw new Error('尚未读取到冲突的远端内容，请先继续同步。')
      const gen = Math.max(generationOf(values[2]), row.generation)
      if (gen !== expectedGeneration || row.conflict.localGeneration !== expectedGeneration) return stale()
      if (row.conflict.remoteRevision !== expectedRemote) throw new Error('远端冲突已出现新版本，请重新查看双方内容后选择。')
      const next = nextGeneration(gen), raws = values.slice(3), operations: DbOperation[] = []
      if (choice === 'remote') operations.push(...adapter.apply(ref.key, row.conflict.remoteValue as JsonValue | null, raws))
      row.generation = next; row.remoteRevision = row.conflict.remoteRevision; delete row.inFlight; delete row.conflict; delete row.draft
      if (choice === 'local') row.draft = {generation: next}
      operations.push(put(generationRow(refId(ref), next)), putRecord(row))
      return {operations, result: {changed: true}}
    })
  },
}
