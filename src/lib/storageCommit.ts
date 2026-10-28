import {flushApplicationData} from './applicationData'
import {flush as flushChat} from './chat'
import {flush as flushData} from './componentData'
import {db, openDb, type DbOperation, type DbSnapshot} from './db'
import {assertPersistenceHealthy, clearPersistenceError, reportPersistenceError, retryPersistence, withPersistenceExclusive} from './persistence'

const RECOVERY_KEY = 'backup-restore'
type DataSnapshot = DbSnapshot
type LocalSnapshot = Record<string, string>
type RestorePoint = {k: typeof RECOVERY_KEY; version: 2; before: {local: LocalSnapshot; data: DataSnapshot | null}}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function invalid(message: string): never {throw new Error(message)}

export function readLocal(): LocalSnapshot {
  const result: LocalSnapshot = Object.create(null)
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith('fp.')) continue
    const value = localStorage.getItem(key)
    if (value !== null) result[key] = value
  }
  return result
}

function replaceLocal(local: LocalSnapshot): void {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('fp.')) keys.push(key)
  }
  // 先删目标中不存在的项，给正常写入和失败回退留出可用空间。
  for (const key of keys) if (!own(local, key)) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value)
}

export function replaceOperations(data: DataSnapshot): DbOperation[] {
  return [
    {store: 'kv', type: 'clear'}, {store: 'apps', type: 'clear'}, {store: 'convs', type: 'clear'}, {store: 'turns', type: 'clear'},
    ...data.apps.map(value => ({store: 'apps' as const, type: 'put' as const, value})),
    ...data.kv.map(value => ({store: 'kv' as const, type: 'put' as const, value})),
    ...data.convs.map(value => ({store: 'convs' as const, type: 'put' as const, value})),
    ...data.turns.map(value => ({store: 'turns' as const, type: 'put' as const, value})),
  ]
}

export async function saveBarrier(): Promise<void> {
  await Promise.all([flushData(), flushChat(), flushApplicationData()])
  await retryPersistence()
  assertPersistenceHealthy()
}

function checkRestorePoint(raw: unknown): RestorePoint {
  if (!object(raw) || raw.k !== RECOVERY_KEY || raw.version !== 2 || !object(raw.before) || !object(raw.before.local) || (raw.before.data !== null && !object(raw.before.data))) invalid('恢复日志损坏，已停止启动，请保留本机数据。')
  const before = raw.before
  const data = before.data as Record<string, unknown>
  // 日志保留的是替换前原样数据，可能含坏配置或旧孤立轮次。
  // 不能套用导入文件的领域校验，否则会拒绝恢复唯一的旧状态。
  const local: LocalSnapshot = Object.create(null)
  for (const [key, value] of Object.entries(before.local as Record<string, unknown>)) {
    if (!key.startsWith('fp.') || typeof value !== 'string') invalid('恢复日志中的配置无效，已停止启动。')
    local[key] = value
  }
  if (before.data !== null) for (const store of ['kv', 'apps', 'convs', 'turns'] as const) {
    const rows = data[store]
    if (!Array.isArray(rows)) invalid('恢复日志中的数据表无效，已停止启动。')
    const seen = new Set<string>()
    for (const row of rows) {
      const key = store === 'kv' || store === 'apps' ? 'k' : 'id'
      if (!object(row) || !id(row[key]) || seen.has(row[key])) invalid('恢复日志中的记录无效，已停止启动。')
      seen.add(row[key])
    }
  }
  return {k: RECOVERY_KEY, version: 2, before: {local, data: before.data === null ? null : data as DataSnapshot}}
}

async function withRestoreLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此浏览器不支持安全恢复锁，请使用支持 Web Locks 的浏览器恢复数据。')
  return await navigator.locks.request('dada-storage-restore', {mode: 'exclusive'}, work)
}

async function rollback(point: RestorePoint): Promise<void> {
  // 日志最后删除。任一阶段失败，下一次启动仍可重试同一份旧快照。
  if (point.before.data !== null) await db.batch(replaceOperations(point.before.data))
  replaceLocal(point.before.local)
  await db.del('recovery', RECOVERY_KEY)
  clearPersistenceError('backup-restore')
}

/** 启动在业务初始化前检查恢复日志；有未完成替换就回到替换前的快照。 */
export async function recoverStorage(): Promise<void> {
  if (!await openDb()) return
  if ((typeof navigator === 'undefined' || !navigator.locks) && await db.get('recovery', RECOVERY_KEY) === undefined) return
  // 活跃替换持有同源锁；新标签页等待它结束后再判断是否真的中断。
  await withRestoreLock(async () => {
    const raw = await db.get<unknown>('recovery', RECOVERY_KEY)
    if (raw === undefined) {clearPersistenceError('backup-restore'); return}
    await withPersistenceExclusive(async () => {
      try {await rollback(checkRestorePoint(raw))} catch (error) {
        reportPersistenceError('backup-restore', error)
        throw error
      }
    }, {recovering: true})
  })
}


/** 同步与备份共用提交边界；validate 在排空保存队列后的写入门禁内执行。 */
export async function commitStorage(update: {local: Record<string, string | null>; operations: DbOperation[]; replace?: boolean; validate?: () => void | Promise<void>; onCommitted?: () => void}): Promise<void> {
  await withRestoreLock(() => withPersistenceExclusive(async () => {
    await saveBarrier()
    await update.validate?.()
    if (await db.get('recovery', RECOVERY_KEY) !== undefined) throw new Error('还有未完成的数据恢复，请刷新页面先完成恢复。')
    const point: RestorePoint = {k: RECOVERY_KEY, version: 2, before: {local: readLocal(), data: update.operations.length ? await db.snapshot() : null}}
    await db.batch([{store: 'recovery', type: 'put', value: point}, ...update.operations])
    try {
      if (update.replace) replaceLocal(update.local as LocalSnapshot)
      else for (const [key, value] of Object.entries(update.local)) {
        if (!key.startsWith('fp.')) throw new Error('配置写入目标无效。')
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      }
      await db.del('recovery', RECOVERY_KEY)
    } catch (error) {
      try {await rollback(point)} catch (rollbackError) {
        reportPersistenceError('backup-restore', rollbackError)
        throw new Error('保存没有完成，原数据的恢复日志已保留。请刷新页面重试恢复，暂勿继续编辑。', {cause: error})
      }
      throw error
    }
    update.onCommitted?.()
  }))
}
