import {db, type DbOperation} from './db'
import {validateApplicationData, validateApplicationDataRecord, type ApplicationData} from './applicationDataSchema'
import {refId} from './incrementalStore'
import {syncedStores} from './incrementalAdapters'
import {ACTIVE, STORE, bindingOf, freshRecord, generationOf, generationRow, genKey, integer, invalid, isObject, nextGeneration, noWrites, put, putRecord, read, recordKey, recordOf, stale, touchRecord} from './incrementalRows'

const ref = (key: string) => ({collection: 'applicationData' as const, key})
const appOperation = (key: string, value: ApplicationData | null): DbOperation => value === null ? {store: 'apps', type: 'delete', key} : {store: 'apps', type: 'put', value: {k: key, v: value}}

/** 应用业务数据的本机读写：业务写入与同步草稿标记同事务提交，其余协调逻辑在 incrementalStore。 */
export const applicationSyncStore = {
  async active() {return bindingOf(await db.get(STORE, ACTIVE))},

  /** 恢复/整包同步专用：绑定期间不得改写已接入同步的数据表，同时使其他标签的缓存版本失效。 */
  async commitExternal(operations: DbOperation[]): Promise<void> {
    const synced = new Set<string>(syncedStores())
    if (!operations.some(operation => synced.has(operation.store))) {await db.batch(operations); return}
    const snapshot = structuredClone(operations)
    const stores = [...new Set([...snapshot.map(operation => operation.store), 'apps' as const, STORE])]
    await db.atomic(stores, [read(ACTIVE), {store: 'apps', all: true}, {store: STORE, all: true, index: 'type', key: 'generation'}], values => {
      if (bindingOf(values[0])) throw new Error('增量同步仍已绑定，请先显式解绑，再恢复备份或整包快照。')
      if (!Array.isArray(values[1]) || !Array.isArray(values[2])) return invalid()
      const changed = new Set<string>(), all = new Set<string>()
      for (const raw of values[1]) {if (!isObject(raw) || typeof raw.k !== 'string') return invalid(); all.add(raw.k)}
      const generations = new Map<string, unknown>()
      for (const raw of values[2]) {if (!isObject(raw) || typeof raw.k !== 'string') return invalid(); generations.set(raw.k, raw)}
      for (const operation of snapshot) if (operation.store === 'apps') {
        if (operation.type === 'clear') for (const key of all) changed.add(key)
        else {
          const key = operation.type === 'delete' ? operation.key : isObject(operation.value) && typeof operation.value.k === 'string' ? operation.value.k : invalid()
          changed.add(key); if (operation.type === 'put') all.add(key)
        }
      }
      const bumps = [...changed].map(key => put(generationRow(refId(ref(key)), nextGeneration(generationOf(generations.get(genKey(refId(ref(key)))))))))
      return {operations: [...snapshot, ...bumps], result: undefined}
    })
  },

  async loadLocal(rawKey: string): Promise<{value: ApplicationData | null; generation: number}> {
    const key = validateApplicationDataRecord({k: rawKey, v: {}}).k
    return db.atomic(['apps', STORE], [{store: 'apps', key}, read(genKey(refId(ref(key))))], values => {
      let value: ApplicationData | null = null
      if (values[0] !== undefined) {const row = validateApplicationDataRecord(values[0]); value = row.k === key ? row.v : invalid()}
      return noWrites({value, generation: generationOf(values[1])})
    })
  },

  async saveLocal(rawKey: string, rawValue: ApplicationData | null, expectedGeneration: number): Promise<number> {
    const key = validateApplicationDataRecord({k: rawKey, v: {}}).k, value = rawValue === null ? null : validateApplicationData(rawValue), id = refId(ref(key))
    if (!integer(expectedGeneration)) return invalid()
    const sampled = await this.active()
    // 绑定与 record 均须同事务读取；先前 epoch 的结果不能写入当前绑定。
    return db.atomic(['apps', STORE], [read(ACTIVE), read(genKey(id)), ...(sampled ? [read(recordKey(sampled.epoch, ref(key)))] : [])], values => {
      const gen = generationOf(values[1]); if (gen !== expectedGeneration) return stale()
      const next = nextGeneration(gen), binding = bindingOf(values[0]), operations: DbOperation[] = [appOperation(key, value), put(generationRow(id, next))]
      if (binding?.epoch !== sampled?.epoch) throw new Error('保存期间增量同步绑定已改变，请重试保存。')
      if (binding) operations.push(putRecord(touchRecord(recordOf(values[2], binding.epoch, ref(key)) ?? freshRecord(binding.epoch, ref(key), gen), next)))
      return {operations, result: next}
    })
  },
}
