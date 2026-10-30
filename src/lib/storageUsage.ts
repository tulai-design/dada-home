import {deleteConv, exportChat, flush} from './chat'
import {db} from './db'
import {download} from './bookmarks'
import {flushThemePackages} from './themePackages/repository'
import {validateStoredThemePackage} from './themePackages/codec'

/**
 * 容量统计与聊天清理预览。统计只读；清理走 deleteConv，因此会与增量同步的删除标记同事务提交。
 * 字节数是 JSON 文本的 UTF-8 长度，用于判断相对大小，不等于浏览器实际占用的磁盘空间。
 */
export type UsageItem = {id: 'config' | 'component' | 'application' | 'conversation' | 'turn' | 'tool' | 'theme-package'; label: string; count: number; bytes: number}
export type Usage = {items: UsageItem[]; total: number; quota?: number; browserUsage?: number}
export type CleanupPreview = {cutoff: number; convIds: string[]; turns: number; bytes: number}

const encoder = new TextEncoder()
const sizeOf = (value: unknown) => encoder.encode(JSON.stringify(value) ?? '').length

function localConfigUsage(): {count: number; bytes: number} {
  let count = 0, bytes = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith('fp.')) continue
    count++; bytes += encoder.encode(key + (localStorage.getItem(key) ?? '')).length
  }
  return {count, bytes}
}

type Conv = {id: string; updatedAt: number}
type Turn = {id: string; convId: string}
type Detail = {convId: string; bytes: number}

export async function measureUsage(): Promise<Usage> {
  await flush()
  await flushThemePackages()
  const [kv, apps, convs, turns, details, rawPackages] = await Promise.all([
    db.all<unknown>('kv'), db.all<unknown>('apps'), db.all<unknown>('convs'), db.all<unknown>('turns'), db.all<Detail>('toolDetails'),
    db.all<unknown>('themePackages'),
  ])
  const packages = await Promise.all(rawPackages.map(validateStoredThemePackage))
  const config = localConfigUsage()
  const items: UsageItem[] = [
    {id: 'config', label: '配置与偏好', ...config},
    {id: 'component', label: '组件数据', count: kv.length, bytes: sizeOf(kv)},
    {id: 'application', label: '应用业务数据', count: apps.length, bytes: sizeOf(apps)},
    {id: 'conversation', label: '聊天会话', count: convs.length, bytes: sizeOf(convs)},
    {id: 'turn', label: '聊天内容', count: turns.length, bytes: sizeOf(turns)},
    {id: 'tool', label: '工具明细', count: details.length, bytes: details.reduce((sum, detail) => sum + (Number.isFinite(detail.bytes) ? detail.bytes : 0), 0)},
    {id: 'theme-package', label: '本地主题包与字体', count: packages.length, bytes: packages.reduce((sum, row) => sum + sizeOf(row.manifest) + row.resources.reduce((bytes, resource) => bytes + resource.bytes.byteLength, 0), 0)},
  ]
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
  return {items, total: items.reduce((sum, item) => sum + item.bytes, 0), quota: estimate?.quota, browserUsage: estimate?.usage}
}

/** 预览：更新时间早于 cutoff 的会话，连同它们的聊天内容和工具明细。 */
export async function previewCleanup(days: number): Promise<CleanupPreview> {
  await flush()
  const cutoff = Date.now() - days * 86_400_000
  const [convs, turns, details] = await Promise.all([db.all<Conv>('convs'), db.all<Turn>('turns'), db.all<Detail>('toolDetails')])
  const old = new Set(convs.filter(conv => conv.updatedAt < cutoff).map(conv => conv.id))
  const picked = turns.filter(turn => old.has(turn.convId))
  const bytes = sizeOf(picked) + details.filter(detail => old.has(detail.convId)).reduce((sum, detail) => sum + detail.bytes, 0)
  return {cutoff, convIds: [...old], turns: picked.length, bytes}
}

/** 清理前的导出：整份聊天（含工具正文）下载为 JSON。 */
export async function exportChatFile(): Promise<void> {
  download(`dada-chat-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportChat()), 'application/json')
}

/** 逐个删除；某个会话正在生成等原因失败时跳过并报告，不中断其余会话。 */
export async function cleanupConversations(ids: string[]): Promise<{deleted: number; failed: number; firstError?: string}> {
  let deleted = 0, failed = 0, firstError: string | undefined
  for (const id of ids) {
    try {await deleteConv(id); deleted++} catch (error) {failed++; firstError ??= error instanceof Error ? error.message : String(error)}
  }
  return {deleted, failed, firstError}
}
