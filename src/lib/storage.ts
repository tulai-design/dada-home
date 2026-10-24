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
