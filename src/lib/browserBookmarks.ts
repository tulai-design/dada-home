import {useEffect, useState} from 'react'
import {addBookmarks, getBookmarks, groupName, setBookmarks, type BookmarkInput} from './bookmarks'

/**
 * 和「搭搭书签桥」浏览器扩展对话，读写浏览器里真正的书签。
 *
 * 网页本身没有这个权限，只有扩展有。通信走 window.postMessage：
 * 网页 → 扩展的内容脚本 → 扩展后台（调用 chrome.bookmarks）→ 原路返回。
 * 扩展只在用户手动点了「在此网站启用」的网站里才会注入内容脚本。
 */

/** 上架应用商店后填在这里，安装按钮就变成一键跳转。留空则走「下载 + 加载已解压」。 */
export const EXTENSION_STORE_URL = ''
export const EXTENSION_ZIP = `${import.meta.env.BASE_URL}dada-bookmarks-extension.zip`

/** 搭搭自己在浏览器书签里建的文件夹，「同步到浏览器」只写这里。 */
export const SYNC_FOLDER = '搭搭'

export type BrowserItem = {id: string; title: string; url: string; path: string[]}
export type BrowserFolder = {id: string; title: string; path: string[]; count: number}

type Reply = {source: 'dada-ext'; id: string; ok: boolean; data?: unknown; error?: string}

let seq = 0

export function call<T>(op: string, args: unknown = {}, timeout = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${seq++}`
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('NO_EXTENSION'))
    }, timeout)
    function onMessage(event: MessageEvent<Reply>) {
      const msg = event.data
      if (event.source !== window || !msg || msg.source !== 'dada-ext' || msg.id !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (msg.ok) resolve(msg.data as T)
      else reject(new Error(msg.error ?? '扩展出错'))
    }
    window.addEventListener('message', onMessage)
    window.postMessage({source: 'dada-app', id, op, args}, window.location.origin)
  })
}

/** 扩展装了、而且在这个网站启用了，才会回应。 */
export async function detect(timeout = 900): Promise<boolean> {
  try {
    await call('ping', {}, timeout)
    return true
  } catch {
    return false
  }
}

export const NO_EXTENSION_HINT = '还没连上浏览器扩展「搭搭书签桥」。请用户在书签页点「导入与同步」，按提示安装并在此网站启用。'

/** 扩展连接状态。open 为 true 时每 1.5 秒查一次，装好后界面自动变化。 */
export function useExtension(poll: boolean): 'checking' | 'ready' | 'missing' {
  const [state, setState] = useState<'checking' | 'ready' | 'missing'>('checking')
  useEffect(() => {
    let alive = true
    const check = async () => {
      const ok = await detect()
      if (alive) setState(ok ? 'ready' : 'missing')
    }
    void check()
    if (!poll) return () => void (alive = false)
    const timer = window.setInterval(check, 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [poll])
  return state
}

export const listBrowser = () => call<{items: BrowserItem[]; folders: BrowserFolder[]}>('list')

/** 把浏览器里的书签并进搭搭书签。重复的网址跳过。 */
export async function importFromBrowser(): Promise<string> {
  const {items} = await listBrowser()
  const entries: BookmarkInput[] = items
    // 搭搭自己同步过去的那个文件夹不再导回来，免得绕圈
    .filter((item) => !(item.path[1] === SYNC_FOLDER))
    .map((item) => ({name: item.title, url: item.url, group: groupName(item.path, '书签栏')}))
  const result = addBookmarks(getBookmarks(), entries)
  setBookmarks(result.groups)
  return `从浏览器读到 ${items.length} 个书签，新增 ${result.added} 个，${result.skipped.length} 个已存在或无效。`
}

/** 把搭搭的书签写进浏览器书签栏的「搭搭」文件夹，按分组建子文件夹。只增不删。 */
export async function pushToBrowser(): Promise<string> {
  const groups = getBookmarks()
  const items = groups.flatMap((g) => g.items.map((i) => ({url: i.url, title: i.name, path: ['@bar', SYNC_FOLDER, g.name]})))
  if (!items.length) return '搭搭里还没有书签。'
  let created = 0
  let skipped = 0
  for (let i = 0; i < items.length; i += 200) {
    const result = await call<{created: number; skipped: string[]}>('create', {items: items.slice(i, i + 200)}, 30000)
    created += result.created
    skipped += result.skipped.length
  }
  return `已写入浏览器书签栏的「${SYNC_FOLDER}」文件夹：新增 ${created} 个，${skipped} 个已存在。`
}
