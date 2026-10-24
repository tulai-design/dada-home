import {clearChat, exportChat, initChat} from './chat'
import {dropPendingData, initComponentData} from './componentData'
import {db, openDb} from './db'

/**
 * 启动：渲染前把 IndexedDB 里的数据读进内存。
 * 组件数据要同步读（组件一挂载就要拿到），所以必须先读完；
 * 读库很快，几十毫秒，用户感觉不到。
 */
export async function initStorage(): Promise<void> {
  await initComponentData()
  await initChat()
}

/** 恢复出厂：清掉 IndexedDB 和 localStorage，然后重新加载。 */
export async function resetStorage(): Promise<void> {
  dropPendingData()
  await clearChat()
  await openDb()
  await db.clear('kv')
  localStorage.clear()
  location.reload()
}

/** 导出 IndexedDB 里的全部数据（对话 + 组件数据）。 */
export async function exportIdb() {
  await openDb()
  return {chat: await exportChat(), kv: await db.all<{k: string; v: unknown}>('kv')}
}

export type BackupSummary = {keys: number; convs: number; turns: number; data: number}

/** 读一份备份文件并检查格式。不对就抛带中文说明的错，不会动现有数据。 */
export function parseBackup(text: string): {dump: Record<string, unknown>; summary: BackupSummary} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('这不是有效的 JSON 文件。')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('这不像搭搭的备份文件。')
  const dump = raw as Record<string, unknown>
  const keys = Object.keys(dump).filter((k) => k.startsWith('fp.') && typeof dump[k] === 'string')
  const idb = dump.indexedDB as {chat?: {convs?: unknown; turns?: unknown}; kv?: unknown} | undefined
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const summary = {keys: keys.length, convs: list(idb?.chat?.convs).length, turns: list(idb?.chat?.turns).length, data: list(idb?.kv).length}
  if (!keys.length && !idb) throw new Error('这不像搭搭的备份文件。')
  return {dump, summary}
}

/**
 * 用备份整体替换当前数据（localStorage 里 fp.* 的配置 + IndexedDB 的对话和组件数据），然后重新加载。
 * 是替换不是合并：合并会让两边的页面、实例 id 混在一起，更容易出乱子。
 */
export async function importBackup(dump: Record<string, unknown>): Promise<void> {
  const idb = dump.indexedDB as {chat?: {convs?: unknown[]; turns?: unknown[]}; kv?: unknown[]} | undefined
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  dropPendingData()
  await clearChat()
  await openDb()
  await db.clear('kv')
  await db.putMany('kv', list(idb?.kv).filter((item) => !!item && typeof (item as {k?: unknown}).k === 'string'))
  await db.putMany('convs', list(idb?.chat?.convs).filter((item) => !!item && typeof (item as {id?: unknown}).id === 'string'))
  await db.putMany('turns', list(idb?.chat?.turns).filter((item) => !!item && typeof (item as {id?: unknown}).id === 'string'))
  for (const key of Object.keys(localStorage)) if (key.startsWith('fp.')) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(dump)) {
    if (key.startsWith('fp.') && typeof value === 'string') localStorage.setItem(key, value)
  }
  location.reload()
}
