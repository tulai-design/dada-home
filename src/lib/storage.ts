import {initChat} from './chat'
import {validateStoredChat, type Conv, type StoredTurn, type ToolDetail} from './chatStorageSchema'
import {initComponentData} from './componentData'
import {db} from './db'
import {validateApplicationDataRecord, type ApplicationDataRecord} from './applicationDataSchema'
import {commitStorage, readLocal, recoverStorage, replaceOperations, saveBarrier} from './storageCommit'
export {recoverStorage} from './storageCommit'
import {waitForSyncIdle} from './sync'

/** 整包 JSON 备份的读取预算，不是 IndexedDB 或浏览器存储配额。 */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024
const BACKUP_APP = 'dada-backup'
const BACKUP_VERSION = 3

type DataSnapshot = {apps: ApplicationDataRecord[]; kv: {k: string; v: unknown}[]; convs: Conv[]; turns: StoredTurn[]; toolDetails: ToolDetail[]}
type LocalSnapshot = Record<string, string>
export type BackupSummary = {keys: number; convs: number; turns: number; data: number; apps: number}
type ValidBackup = {dump: Record<string, unknown>; summary: BackupSummary; local: LocalSnapshot; data: DataSnapshot}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function invalid(message = '这不像完整的搭搭备份文件。'): never {throw new Error(message)}

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
  if (!object(raw) || !Array.isArray(raw.kv) || !Array.isArray(raw.apps) || !object(raw.chat) || !Array.isArray(raw.chat.convs) || !Array.isArray(raw.chat.turns) || !Array.isArray(raw.chat.toolDetails)) invalid('备份缺少完整的组件、应用或对话数据。')
  const data = {kv: raw.kv, apps: raw.apps.map(validateApplicationDataRecord), convs: raw.chat.convs, turns: raw.chat.turns, toolDetails: raw.chat.toolDetails}
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
  checkIds(data.apps, 'k', '应用数据')
  for (const row of data.kv) if (!object(row) || !own(row, 'v')) invalid('组件数据缺少记录值。')
  validateStoredChat(data.convs, data.turns, data.toolDetails)
  return data as DataSnapshot
}

function checkLocal(raw: Record<string, unknown>): LocalSnapshot {
  const local: LocalSnapshot = Object.create(null)
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('fp.')) continue
    // 当前备份只从 indexedDB 接收业务数据。禁止旧键在重载时触发迁移、
    // 覆盖新仓或使初始化失败；原样导出仍保留它们供人工救援，不是兼容导入。
    if (key === 'fp.chatTurns.v2' || key.startsWith('fp.data.') || key.startsWith('fp.app.') || key.startsWith('fp.applet.')) {
      invalid(`备份包含不支持导入的旧业务存储「${key}」。原文可用于救援；当前格式的业务数据必须位于 indexedDB。`)
    }
    if (typeof value !== 'string') invalid('备份的配置值必须是字符串。')
    let parsed: unknown
    try {parsed = JSON.parse(value)} catch {invalid(`配置「${key}」不是有效 JSON。`)}
    // 工作空间至少要有一个可被现有 migrate 接受的页面，否则会静默回落成默认库。
    // 旧版本、扩展字段与其余领域规整仍由各自的迁移入口处理。
    if (key === 'fp.workspace' && (!object(parsed) || !Array.isArray(parsed.pages) || !parsed.pages.some(page => object(page) && id(page.id) && Array.isArray(page.components)))) invalid('备份的工作空间缺少可恢复的页面。')
    local[key] = value
  }
  return local
}

function validateBackup(raw: unknown): ValidBackup {
  if (!object(raw)) invalid()
  checkJson(raw)
  const text = JSON.stringify(raw)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) invalid('备份超过当前整包读取预算（256 MiB），没有导入任何数据。')
  if (raw.app !== BACKUP_APP || raw.version !== BACKUP_VERSION) invalid('不支持这个备份版本，请使用当前格式的搭搭备份。')
  const local = checkLocal(raw)
  const data = checkData(raw.indexedDB)
  // 复制经校验的 JSON，避免确认弹窗打开后调用者修改对象影响实际替换。
  const dump = JSON.parse(text) as Record<string, unknown>
  return {dump, local: checkLocal(dump), data: checkData(dump.indexedDB), summary: {keys: Object.keys(local).length, convs: data.convs.length, turns: data.turns.length, data: data.kv.length, apps: data.apps.length}}
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
  const dump = {app: BACKUP_APP, version: BACKUP_VERSION, ...readLocal(), indexedDB: {kv: data.kv, apps: data.apps, chat: {convs: data.convs, turns: data.turns, toolDetails: data.toolDetails}}}
  // 配置和业务数据库并无共同事务；此快照不声称覆盖屏障之后所有并发改动。
  // 原样救援保留损坏配置与旧业务键；这类文件可供人工恢复，不能通过当前格式导入。
  if (new TextEncoder().encode(JSON.stringify(dump)).byteLength > MAX_BACKUP_BYTES) invalid('备份超过当前整包读取预算（256 MiB），没有截断数据。')
  return dump
}

/** 保留旧调用接口，仍先等待已接受更改，不返回读取失败的空表。 */
export async function exportIdb() {
  await saveBarrier()
  const data = await db.snapshot()
  return {kv: data.kv, apps: data.apps, chat: {convs: data.convs, turns: data.turns, toolDetails: data.toolDetails}}
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
  await commitStorage({local: target.local, operations: replaceOperations(target.data), replace: true})
  location.reload()
}

/** 整体替换，而不是合并；再次校验直接调用的输入，清库前无副作用。 */
export async function importBackup(dump: Record<string, unknown>): Promise<void> {
  await replaceStorage(validateBackup(dump))
}

/** 重置保留非搭搭存储；排空旧队列后用同样的可恢复替换流程清理。 */
export async function resetStorage(): Promise<void> {
  await replaceStorage(validateBackup({app: BACKUP_APP, version: BACKUP_VERSION, indexedDB: {kv: [], apps: [], chat: {convs: [], turns: [], toolDetails: []}}}))
}
