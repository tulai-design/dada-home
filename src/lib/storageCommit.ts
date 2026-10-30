import {flushApplicationData} from './applicationData'
import {flush as flushChat} from './chat'
import {flush as flushData} from './componentData'
import {db, openDb, type DbOperation, type DbSnapshot} from './db'
import {assertPersistenceHealthy, clearPersistenceError, reportPersistenceError, retryPersistence, withPersistenceExclusive} from './persistence'
import {applicationSyncStore} from './applicationSyncStore'
import {flushThemePackages} from './themePackages/repository'

const RECOVERY_KEY = 'backup-restore'
type DataSnapshot = Partial<DbSnapshot>
type LocalSnapshot = Record<string, string>
type RestorePoint = {k: typeof RECOVERY_KEY; version: 5; before: {local: LocalSnapshot; data: DataSnapshot | null}}
const DATA_STORES = ['kv', 'apps', 'convs', 'turns', 'toolDetails', 'themePackages'] as const
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
  return DATA_STORES.flatMap(store => data[store] === undefined ? [] : [
    {store, type: 'clear'} as DbOperation,
    ...data[store]!.map(value => ({store, type: 'put' as const, value})),
  ])
}

export async function saveBarrier(): Promise<void> {
  await Promise.all([flushData(), flushChat(), flushApplicationData(), flushThemePackages()])
  await retryPersistence()
  assertPersistenceHealthy()
}

function checkRestorePoint(raw: unknown): RestorePoint {
  if (!object(raw) || raw.k !== RECOVERY_KEY || raw.version !== 5 || !object(raw.before) || !object(raw.before.local) || (raw.before.data !== null && !object(raw.before.data))) invalid('恢复日志损坏，已停止启动，请保留本机数据。')
  const before = raw.before
  const data = before.data as Record<string, unknown>
  // 日志保留的是替换前原样数据，可能含坏配置或旧孤立轮次。
  // 不能套用导入文件的领域校验，否则会拒绝恢复唯一的旧状态。
  const local: LocalSnapshot = Object.create(null)
  for (const [key, value] of Object.entries(before.local as Record<string, unknown>)) {
    if (!key.startsWith('fp.') || typeof value !== 'string') invalid('恢复日志中的配置无效，已停止启动。')
    local[key] = value
  }
  if (before.data !== null && Object.keys(data).some(store => !DATA_STORES.some(known => known === store))) invalid('恢复日志中的数据表无效，已停止启动。')
  if (before.data !== null) for (const store of DATA_STORES) {
    if (!own(data, store)) continue
    const rows = data[store]
    if (!Array.isArray(rows)) invalid('恢复日志中的数据表无效，已停止启动。')
    const seen = new Set<string>()
    for (const row of rows) {
      const key = store === 'kv' || store === 'apps' || store === 'themePackages' ? 'k' : 'id'
      if (!object(row) || !id(row[key]) || seen.has(row[key])) invalid('恢复日志中的记录无效，已停止启动。')
      seen.add(row[key])
    }
  }
  return {k: RECOVERY_KEY, version: 5, before: {local, data: before.data === null ? null : data as DataSnapshot}}
}

async function withRestoreLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此浏览器不支持安全恢复锁，请使用支持 Web Locks 的浏览器恢复数据。')
  return await navigator.locks.request('dada-storage-restore', {mode: 'exclusive'}, work)
}

async function rollback(point: RestorePoint): Promise<void> {
  // 日志最后删除。任一阶段失败，下一次启动仍可重试同一份旧快照。
  if (point.before.data !== null) await applicationSyncStore.commitExternal(replaceOperations(point.before.data))
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
    if (update.operations.some(operation => operation.store === 'apps') && await applicationSyncStore.active()) throw new Error('应用增量同步仍已绑定，请先显式解绑，再恢复备份或应用整包快照。')
    await saveBarrier()
    await update.validate?.()
    if (await db.get('recovery', RECOVERY_KEY) !== undefined) throw new Error('还有未完成的数据恢复，请刷新页面先完成恢复。')
    const affected = new Set(update.operations.map(operation => operation.store))
    if ([...affected].some(store => !DATA_STORES.some(known => known === store))) throw new Error('恢复提交不能修改本机同步或恢复元数据。')
    const snapshot = affected.size ? await db.snapshot() : null
    // 日志仅保存实际触及的业务仓。非apps提交失败不能回退期间未修改的apps，
    // 也不能因活动增量绑定而让配置/普通组件的回滚永久卡住。
    const data = snapshot === null ? null : Object.fromEntries(Object.entries(snapshot).filter(([store]) => affected.has(store as keyof DbSnapshot))) as DataSnapshot
    const point: RestorePoint = {k: RECOVERY_KEY, version: 5, before: {local: readLocal(), data}}
    await applicationSyncStore.commitExternal([{store: 'recovery', type: 'put', value: point}, ...update.operations])
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
