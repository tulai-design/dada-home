import {validateApplicationData, validateApplicationDataRecord} from './applicationDataSchema'
import {hydrateTurn, validateConv, validateStoredTurn, validateToolDetail, type StoredTurn, type ToolDetail} from './chatStorageSchema'
import type {DbOperation, DbRead, StoreName} from './db'
import {STORE, configApplyKey, invalid, isObject, put, read, type JsonValue, type SyncCollection} from './incrementalRows'
import {applyIncrementalConfig, INCREMENTAL_CONFIG_NAMES, projectIncrementalConfig} from './incrementalConfigSchema'

/**
 * 每个集合的本机读写边界：同步引擎不理解业务，只通过它在同一事务里读取当前本机值、写入远端值。
 * reads 的结果按相同顺序交给 value/apply，二者必须是纯函数，不能在事务里 await。
 */
export type SyncAdapter = {
  collection: SyncCollection
  stores: StoreName[]
  /** 绑定时把已有本机记录播种为待同步草稿；不在事务仓内的集合（配置）由对账补上。 */
  seed?: {read: DbRead; key(raw: unknown): string}
  /** 规范化并校验身份；非法身份拒绝，不静默改写。 */
  key(raw: string): string
  reads(key: string): DbRead[]
  /** 完整加密业务值（含凭据）；本机不存在返回 null。 */
  value(key: string, raws: unknown[]): JsonValue | null
  /** 把远端值写入本机；只保留设备本机授权。返回的操作与同步元数据同事务提交。 */
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
    return row.v as JsonValue
  },
  apply(key, incoming) {
    if (incoming === null) return [{store: 'apps', type: 'delete', key}]
    return [{store: 'apps', type: 'put', value: {k: key, v: validateApplicationData(incoming)}}]
  },
  check: value => value === null ? null : validateApplicationData(value) as JsonValue,
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

const VALUE_LIMIT = 8 * 1024 * 1024
/** 组件与配置的值可能是 null 或原始类型，而 null 在引擎里表示“不存在”，所以统一包成 {v}。 */
function wrapped(value: unknown): {v: unknown} {
  if (!isObject(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, 'v')) return invalid()
  return value as {v: unknown}
}
function bounded(value: unknown): JsonValue {
  let text: string
  try {text = JSON.stringify(value)} catch {return invalid()}
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > VALUE_LIMIT) return invalid()
  return JSON.parse(text) as JsonValue
}
const identity = (raw: unknown): string => typeof raw === 'string' && raw.length > 0 && raw.length <= 1000 ? raw : invalid()

const component: SyncAdapter = {
  collection: 'component',
  stores: ['kv'],
  seed: {read: {store: 'kv', all: true}, key: raw => isObject(raw) ? identity(raw.k) : invalid()},
  key: identity,
  reads: key => [{store: 'kv', key}],
  value(key, [raw]) {
    if (raw === undefined) return null
    if (!isObject(raw) || raw.k !== key || !Object.prototype.hasOwnProperty.call(raw, 'v')) return invalid()
    return bounded({v: raw.v})
  },
  apply(key, incoming) {
    if (incoming === null) return [{store: 'kv', type: 'delete', key}]
    return [{store: 'kv', type: 'put', value: {k: key, v: wrapped(incoming).v}}]
  },
  check: value => value === null ? null : bounded({v: wrapped(value).v}),
}

/** 配置在 localStorage：同步读取是事务内允许的纯读取；写入走“待应用”行，提交后再落到 localStorage。 */
export const CONFIG_NAMES = INCREMENTAL_CONFIG_NAMES
const configName = (raw: unknown): string => typeof raw === 'string' && CONFIG_NAMES.includes(raw) ? raw : invalid()
export type ConfigApply = {k: string; type: 'config-apply'; name: string; value: string | null}
const pendingOf = (name: string, raw: unknown): ConfigApply | undefined => {
  if (raw === undefined) return undefined
  if (!isObject(raw) || raw.type !== 'config-apply' || raw.name !== name || raw.k !== configApplyKey(name) || raw.value !== null && typeof raw.value !== 'string') return invalid()
  return raw as ConfigApply
}
/** 本机当前完整配置；有未落盘的入站值时，以它为基准。undefined 表示不存在。 */
export function localConfig(name: string, pending?: ConfigApply): unknown {
  const text = pending ? pending.value : (typeof localStorage === 'undefined' ? null : localStorage.getItem(`fp.${name}`))
  if (text === null) return undefined
  try {return JSON.parse(text) as unknown} catch {throw new Error(`本机配置「fp.${name}」不是完整 JSON，同步已停止。`)}
}
/** 可携投影：纯本机字段（网络授权等）不算同步内容。 */
export function configValue(name: string, local: unknown): JsonValue | null {
  if (local === undefined) return null
  const projected = projectIncrementalConfig(name, local)
  return projected === undefined ? null : bounded({v: projected})
}
const config: SyncAdapter = {
  collection: 'config',
  stores: [],
  key: configName,
  reads: key => [read(configApplyKey(key))],
  value: (key, [raw]) => configValue(key, localConfig(key, pendingOf(key, raw))),
  apply(key, incoming, [raw]) {
    const pending = pendingOf(key, raw), base = localConfig(key, pending)
    const remote = incoming === null ? undefined : wrapped(incoming).v
    const next = applyIncrementalConfig(key, remote, base)
    const row: ConfigApply = {k: configApplyKey(key), type: 'config-apply', name: key, value: next === undefined ? null : JSON.stringify(next)}
    return [put(row)]
  },
  check(value) {
    if (value === null) return null
    const inner = wrapped(value).v
    return bounded({v: inner})
  },
}

const ADAPTERS: Partial<Record<SyncCollection, SyncAdapter>> = {applicationData, config, component, conversation, turn}

export function adapterOf(collection: SyncCollection): SyncAdapter {
  const adapter = ADAPTERS[collection]
  if (!adapter) throw new Error(`集合 ${collection} 尚未接入增量同步。`)
  if (!isObject(adapter)) return invalid()
  return adapter
}
/** 已接入增量同步的本机数据表；绑定期间整包写入这些表会被拒绝。 */
export const syncedStores = (): StoreName[] => [...new Set(Object.values(ADAPTERS).flatMap(adapter => adapter!.stores))]
export const syncStoreName = STORE
