import {flush as flushChat, initChat, validateLegacyTurns, type Conv, type Turn} from './chat'
import {flush as flushData, initComponentData} from './componentData'
import {db, openDb, type DbOperation} from './db'
import {assertPersistenceHealthy, clearPersistenceError, reportPersistenceError, retryPersistence, withPersistenceExclusive} from './persistence'
import {waitForSyncIdle} from './sync'

/** 整包 JSON 备份的读取预算，不是 IndexedDB 或浏览器存储配额。 */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024
const BACKUP_APP = 'dada-backup'
const BACKUP_VERSION = 1
const RECOVERY_KEY = 'backup-restore'

type DataSnapshot = {kv: {k: string; v: unknown}[]; convs: Conv[]; turns: Turn[]}
type LocalSnapshot = Record<string, string>
type RestorePoint = {k: typeof RECOVERY_KEY; version: 1; before: {local: LocalSnapshot; data: DataSnapshot}}
export type BackupSummary = {keys: number; convs: number; turns: number; data: number}
type ValidBackup = {dump: Record<string, unknown>; summary: BackupSummary; local: LocalSnapshot; data: DataSnapshot}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function invalid(message = '这不像完整的搭搭备份文件。'): never {throw new Error(message)}
const emptyData = (): DataSnapshot => ({kv: [], convs: [], turns: []})

/** JSON.parse 的文件与直接调用 importBackup 的对象共用同一可信边界。 */
function checkJson(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 200) invalid('备份的数据嵌套过深。')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || ancestors.has(value)) invalid('备份含有不能保存的 JSON 数据。')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, String(index))) invalid('备份含有不完整的数组。')
      checkJson(value[index], ancestors, depth + 1)
    }
  } else {
    for (const item of Object.values(value)) checkJson(item, ancestors, depth + 1)
  }
  ancestors.delete(value)
}

function checkData(raw: unknown): DataSnapshot {
  if (!object(raw) || !Array.isArray(raw.kv) || !object(raw.chat) || !Array.isArray(raw.chat.convs) || !Array.isArray(raw.chat.turns)) invalid('备份缺少完整的组件数据或对话数据。')
  const data = {kv: raw.kv, convs: raw.chat.convs, turns: raw.chat.turns}
  const checkIds = (rows: unknown[], key: 'id' | 'k', label: string) => {
    const seen = new Set<string>()
    for (const row of rows) {
      if (!object(row) || !id(row[key])) invalid(`${label}的记录标识无效。`)
      if (seen.has(row[key])) invalid(`${label}含有重复记录。`)
      seen.add(row[key])
    }
    return seen
  }
  checkIds(data.kv, 'k', '组件数据')
  for (const row of data.kv) if (!object(row) || !own(row, 'v')) invalid('组件数据缺少记录值。')
  const convIds = checkIds(data.convs, 'id', '对话')
  for (const row of data.convs) {
    if (!object(row) || typeof row.title !== 'string' || !finite(row.createdAt) || !finite(row.updatedAt)) invalid('对话的标题或时间无效。')
  }
  checkIds(data.turns, 'id', '聊天轮次')
  for (const row of data.turns) {
    if (!object(row) || !id(row.convId) || !convIds.has(row.convId)) invalid('聊天轮次没有对应的对话。')
    for (const key of ['prompt', 'answer', 'reasoning', 'error']) if (typeof row[key] !== 'string') invalid('聊天轮次的正文格式无效。')
    if (!finite(row.startedAt) || (row.endedAt !== undefined && !finite(row.endedAt)) || (row.aborted !== undefined && typeof row.aborted !== 'boolean')) invalid('聊天轮次的时间或状态无效。')
    if (!Array.isArray(row.tools)) invalid('聊天工具记录格式无效。')
    for (const tool of row.tools) {
      if (!object(tool) || typeof tool.name !== 'string' || typeof tool.title !== 'string' || typeof tool.text !== 'string' || typeof tool.ok !== 'boolean') invalid('聊天工具记录格式无效。')
    }
    if (row.article !== undefined) {
      const article = row.article
      if (!object(article) || ['title', 'link', 'context'].some(key => typeof article[key] !== 'string')) invalid('聊天参考资料格式无效。')
    }
    if (row.pending !== undefined && (!object(row.pending) || !object(row.pending.request) || typeof row.pending.request.tool !== 'string' || typeof row.pending.request.summary !== 'string')) invalid('聊天确认记录格式无效。')
  }
  return data as DataSnapshot
}

function checkLocal(raw: Record<string, unknown>): LocalSnapshot {
  const local: LocalSnapshot = Object.create(null)
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('fp.')) continue
    if (typeof value !== 'string') invalid('备份的配置值必须是字符串。')
    let parsed: unknown
    try {parsed = JSON.parse(value)} catch {invalid(`配置「${key}」不是有效 JSON。`)}
    // 工作空间至少要有一个可被现有 migrate 接受的页面，否则会静默回落成默认库。
    // 旧版本、扩展字段与其余领域规整仍由各自的迁移入口处理。
    if (key === 'fp.workspace' && (!object(parsed) || !Array.isArray(parsed.pages) || !parsed.pages.some(page => object(page) && id(page.id) && Array.isArray(page.components)))) invalid('备份的工作空间缺少可恢复的页面。')
    if (key === 'fp.chatTurns.v2') validateLegacyTurns(parsed)
    local[key] = value
  }
  return local
}

function validateBackup(raw: unknown): ValidBackup {
  if (!object(raw)) invalid()
  checkJson(raw)
  const text = JSON.stringify(raw)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) invalid('备份超过当前整包读取预算（256 MiB），没有导入任何数据。')
  const versioned = own(raw, 'app') || own(raw, 'version')
  if (versioned && (raw.app !== BACKUP_APP || raw.version !== BACKUP_VERSION)) invalid('不支持这个备份版本，请使用兼容的搭搭版本。')
  const local = checkLocal(raw)
  const data = own(raw, 'indexedDB') ? checkData(raw.indexedDB) : emptyData()
  if ((versioned && !own(raw, 'indexedDB')) || (!versioned && !own(raw, 'indexedDB') && !Object.keys(local).length)) invalid()
  // 复制经校验的 JSON，避免确认弹窗打开后调用者修改对象影响实际替换。
  const dump = JSON.parse(text) as Record<string, unknown>
  return {dump, local: checkLocal(dump), data: own(dump, 'indexedDB') ? checkData(dump.indexedDB) : data, summary: {keys: Object.keys(local).length, convs: data.convs.length, turns: data.turns.length, data: data.kv.length}}
}

function readLocal(): LocalSnapshot {
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

function replaceOperations(data: DataSnapshot): DbOperation[] {
  return [
    {store: 'kv', type: 'clear'}, {store: 'convs', type: 'clear'}, {store: 'turns', type: 'clear'},
    ...data.kv.map(value => ({store: 'kv' as const, type: 'put' as const, value})),
    ...data.convs.map(value => ({store: 'convs' as const, type: 'put' as const, value})),
    ...data.turns.map(value => ({store: 'turns' as const, type: 'put' as const, value})),
  ]
}

async function saveBarrier(): Promise<void> {
  await Promise.all([flushData(), flushChat()])
  await retryPersistence()
  assertPersistenceHealthy()
}

function checkRestorePoint(raw: unknown): RestorePoint {
  if (!object(raw) || raw.k !== RECOVERY_KEY || raw.version !== 1 || !object(raw.before) || !object(raw.before.local) || !object(raw.before.data)) invalid('恢复日志损坏，已停止启动，请保留本机数据。')
  const before = raw.before
  const data = before.data as Record<string, unknown>
  // 日志保留的是替换前原样数据，可能含坏配置或旧孤立轮次。
  // 不能套用导入文件的领域校验，否则会拒绝恢复唯一的旧状态。
  const local: LocalSnapshot = Object.create(null)
  for (const [key, value] of Object.entries(before.local as Record<string, unknown>)) {
    if (!key.startsWith('fp.') || typeof value !== 'string') invalid('恢复日志中的配置无效，已停止启动。')
    local[key] = value
  }
  for (const store of ['kv', 'convs', 'turns'] as const) {
    const rows = data[store]
    if (!Array.isArray(rows)) invalid('恢复日志中的数据表无效，已停止启动。')
    const seen = new Set<string>()
    for (const row of rows) {
      const key = store === 'kv' ? 'k' : 'id'
      if (!object(row) || !id(row[key]) || seen.has(row[key])) invalid('恢复日志中的记录无效，已停止启动。')
      seen.add(row[key])
    }
  }
  return {k: RECOVERY_KEY, version: 1, before: {local, data: data as DataSnapshot}}
}

async function withRestoreLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此浏览器不支持安全恢复锁，请使用支持 Web Locks 的浏览器恢复数据。')
  return await navigator.locks.request('dada-storage-restore', {mode: 'exclusive'}, work)
}

async function rollback(point: RestorePoint): Promise<void> {
  // 日志最后删除。任一阶段失败，下一次启动仍可重试同一份旧快照。
  await db.batch(replaceOperations(point.before.data))
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

/** 先处理上次未完成恢复，再初始化业务数据；失败交给宿主展示和重试。 */
export async function initStorage(): Promise<void> {
  await recoverStorage()
  await initComponentData()
  await initChat()
}

/** 导出屏障包含调用前修改；生成中的新片段可继续保存，不锁住聊天。 */
export async function exportBackupSnapshot(): Promise<Record<string, unknown>> {
  await saveBarrier()
  const data = await db.snapshot()
  const dump = {app: BACKUP_APP, version: BACKUP_VERSION, ...readLocal(), indexedDB: {kv: data.kv, chat: {convs: data.convs, turns: data.turns}}}
  // 配置和业务数据库并无共同事务；此快照不声称覆盖屏障之后所有并发改动。
  // 原样救援也需保留损坏的旧配置；导入时仍严格校验，不把损坏值当有效配置应用。
  if (new TextEncoder().encode(JSON.stringify(dump)).byteLength > MAX_BACKUP_BYTES) invalid('备份超过当前整包读取预算（256 MiB），没有截断数据。')
  return dump
}

/** 保留旧调用接口，仍先等待已接受更改，不返回读取失败的空表。 */
export async function exportIdb() {
  await saveBarrier()
  const data = await db.snapshot()
  return {kv: data.kv, chat: {convs: data.convs, turns: data.turns}}
}

/** 检查格式与完整性；此函数不会修改任何存储。 */
export function parseBackup(text: string): {dump: Record<string, unknown>; summary: BackupSummary} {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) invalid('备份超过当前整包读取预算（256 MiB）。')
  let raw: unknown
  try {raw = JSON.parse(text)} catch {invalid('这不是有效的 JSON 文件。')}
  const {dump, summary} = validateBackup(raw)
  return {dump, summary}
}

async function replaceStorage(target: ValidBackup): Promise<void> {
  await waitForSyncIdle()
  await withRestoreLock(() => withPersistenceExclusive(async () => {
    await saveBarrier()
    // 先检查旧恢复日志，绝不以新恢复点覆盖唯一的旧恢复信息。
    const previous = await db.get<unknown>('recovery', RECOVERY_KEY)
    if (previous !== undefined) throw new Error('还有未完成的数据恢复，请刷新页面先完成恢复。')
    const point: RestorePoint = {k: RECOVERY_KEY, version: 1, before: {local: readLocal(), data: await db.snapshot() as DataSnapshot}}
    await db.batch([{store: 'recovery', type: 'put', value: point}, ...replaceOperations(target.data)])
    try {
      replaceLocal(target.local)
      await db.del('recovery', RECOVERY_KEY)
    } catch (error) {
      try {await rollback(point)} catch (rollbackError) {
        reportPersistenceError('backup-restore', rollbackError)
        throw new Error('导入没有完成，原数据的恢复日志已保留。请刷新页面重试恢复，暂勿继续编辑。', {cause: error})
      }
      throw error
    }
    location.reload()
  }))
}

/** 整体替换，而不是合并；再次校验直接调用的输入，清库前无副作用。 */
export async function importBackup(dump: Record<string, unknown>): Promise<void> {
  await replaceStorage(validateBackup(dump))
}

/** 重置保留非搭搭存储；排空旧队列后用同样的可恢复替换流程清理。 */
export async function resetStorage(): Promise<void> {
  await replaceStorage(validateBackup({app: BACKUP_APP, version: BACKUP_VERSION, indexedDB: {kv: [], chat: {convs: [], turns: []}}}))
}
