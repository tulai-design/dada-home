import {validateApplicationData, validateApplicationDataRecord, type ApplicationData} from './applicationDataSchema'
import {projectApplicationData, restoreApplicationData} from './applicationSyncProjection'
import {hydrateTurn, validateConv, validateStoredTurn, validateToolDetail, type StoredTurn, type ToolDetail} from './chatStorageSchema'
import type {DbOperation, DbRead, StoreName} from './db'
import {invalid, isObject, type JsonValue, type SyncCollection} from './incrementalRows'

/**
 * 每个集合的本机读写边界：同步引擎不理解业务，只通过它在同一事务里读取当前本机值、写入远端值。
 * reads 的结果按相同顺序交给 value/apply，二者必须是纯函数，不能在事务里 await。
 */
export type SyncAdapter = {
  collection: SyncCollection
  stores: StoreName[]
  /** 绑定时把已有本机记录播种为待同步草稿。 */
  seed: {read: DbRead; key(raw: unknown): string}
  /** 规范化并校验身份；非法身份拒绝，不静默改写。 */
  key(raw: string): string
  reads(key: string): DbRead[]
  /** 可携值（已去除凭据）；本机不存在返回 null。 */
  value(key: string, raws: unknown[]): JsonValue | null
  /** 把远端可携值写入本机；current 用于恢复本机凭据。返回的操作与同步元数据同事务提交。 */
  apply(key: string, incoming: JsonValue | null, raws: unknown[]): DbOperation[]
  /** 远端值入站前的格式与大小校验。 */
  check(value: unknown): JsonValue | null
}

const applicationData: SyncAdapter = {
  collection: 'applicationData',
  stores: ['apps'],
  seed: {read: {store: 'apps', all: true}, key: raw => validateApplicationDataRecord(raw).k},
  key: raw => validateApplicationDataRecord({k: raw, v: {}}).k,
  reads: key => [{store: 'apps', key}],
  value(key, [raw]) {
    if (raw === undefined) return null
    const row = validateApplicationDataRecord(raw)
    if (row.k !== key) return invalid()
    return projectApplicationData(row.v) as JsonValue
  },
  apply(key, incoming, [raw]) {
    if (incoming === null) return [{store: 'apps', type: 'delete', key}]
    const current: ApplicationData = raw === undefined ? {} : validateApplicationDataRecord(raw).v
    return [{store: 'apps', type: 'put', value: {k: key, v: restoreApplicationData(validateApplicationData(incoming), current)}}]
  },
  check: value => value === null ? null : projectApplicationData(validateApplicationData(value)) as JsonValue,
}

const conversation: SyncAdapter = {
  collection: 'conversation',
  stores: ['convs'],
  seed: {read: {store: 'convs', all: true}, key: raw => validateConv(raw).id},
  key: raw => validateConv({id: raw, title: '', createdAt: 0, updatedAt: 0}).id,
  reads: key => [{store: 'convs', key}],
  value: (key, [raw]) => raw === undefined ? null : (validateConv(raw).id === key ? validateConv(raw) : invalid()) as unknown as JsonValue,
  apply: (key, incoming, []) => incoming === null ? [{store: 'convs', type: 'delete', key}] : [{store: 'convs', type: 'put', value: validateConv(incoming)}],
  check: value => value === null ? null : validateConv(value) as unknown as JsonValue,
}

/** 轮次与其工具正文是一个同步实体：正文只在这条记录的加密对象里，不另设集合。 */
type TurnValue = {turn: StoredTurn; details: ToolDetail[]}
function turnValue(value: unknown, key?: string): TurnValue {
  if (!isObject(value) || Object.keys(value).length !== 2 || !Array.isArray(value.details)) return invalid()
  const turn = validateStoredTurn(value.turn), details = value.details.map(validateToolDetail)
  if (key !== undefined && turn.id !== key) return invalid()
  const bodies = new Map(details.map(detail => [detail.id, detail]))
  if (bodies.size !== details.length || bodies.size !== turn.tools.length) return invalid()
  hydrateTurn(turn, bodies)
  return {turn, details: turn.tools.map(tool => bodies.get(tool.detailId)!)}
}
const turn: SyncAdapter = {
  collection: 'turn',
  stores: ['turns', 'toolDetails'],
  seed: {read: {store: 'turns', all: true}, key: raw => validateStoredTurn(raw).id},
  key: raw => validateStoredTurn({id: raw, convId: 'x', prompt: '', answer: '', reasoning: '', tools: [], error: '', startedAt: 0}).id,
  reads: key => [{store: 'turns', key}, {store: 'toolDetails', all: true, index: 'turnId', key}],
  value(key, [raw, details]) {
    if (raw === undefined) return null
    if (!Array.isArray(details)) return invalid()
    const stored = validateStoredTurn(raw), bodies = new Map(details.map(item => {const detail = validateToolDetail(item); return [detail.id, detail]}))
    hydrateTurn(stored, bodies)
    return turnValue({turn: stored, details: stored.tools.map(tool => bodies.get(tool.detailId)!)}, key) as unknown as JsonValue
  },
  apply(key, incoming, [, existing]) {
    const old = Array.isArray(existing) ? existing.map(item => validateToolDetail(item).id) : []
    if (incoming === null) return [...old.map(id => ({store: 'toolDetails' as const, type: 'delete' as const, key: id})), {store: 'turns', type: 'delete', key}]
    const next = turnValue(incoming, key), keep = new Set(next.details.map(detail => detail.id))
    return [
      ...old.filter(id => !keep.has(id)).map(id => ({store: 'toolDetails' as const, type: 'delete' as const, key: id})),
      ...next.details.map(detail => ({store: 'toolDetails' as const, type: 'put' as const, value: detail})),
      {store: 'turns', type: 'put', value: next.turn},
    ]
  },
  check: value => value === null ? null : turnValue(value) as unknown as JsonValue,
}

const ADAPTERS: Partial<Record<SyncCollection, SyncAdapter>> = {applicationData, conversation, turn}

export function adapterOf(collection: SyncCollection): SyncAdapter {
  const adapter = ADAPTERS[collection]
  if (!adapter) throw new Error(`集合 ${collection} 尚未接入增量同步。`)
  if (!isObject(adapter)) return invalid()
  return adapter
}
/** 已接入增量同步的本机数据表；绑定期间整包写入这些表会被拒绝。 */
export const syncedStores = (): StoreName[] => [...new Set(Object.values(ADAPTERS).flatMap(adapter => adapter!.stores))]
