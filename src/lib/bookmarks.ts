import {readData, writeData, SHARED} from './componentData'
import {uid} from './store'
import type {BookmarkGroup} from './types'

/**
 * 书签的所有操作都在这里：界面、AI 工具、导入导出共用同一套纯函数，
 * 校验和去重只写一份。
 *
 * 浏览器没有给网页读取书签的接口（只有扩展能读），所以「从浏览器拿书签」
 * 走的是浏览器自己能导出的文件：HTML 导出文件，或 Chrome 的 Bookmarks 文件。
 */

export const DEFAULT_GROUP = '未分类'
export const MAX_BOOKMARKS = 5000

export type BookmarkInput = {name?: string; url: string; group?: string}

export const getBookmarks = (): BookmarkGroup[] => readData<BookmarkGroup[]>(SHARED.bookmarks, [])
export const setBookmarks = (next: BookmarkGroup[]) => writeData(SHARED.bookmarks, next)

/** 只放行 http(s)。没写协议就补 https://。javascript: 之类一律拒绝。 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 去重用的键：忽略结尾斜杠和大小写。 */
const keyOf = (url: string) => url.replace(/\/$/, '').toLowerCase()

export const countBookmarks = (groups: BookmarkGroup[]) => groups.reduce((n, g) => n + g.items.length, 0)

export type AddResult = {groups: BookmarkGroup[]; added: number; skipped: string[]}

/**
 * 批量添加。分组不存在就新建；地址已经有了（在任何分组里）就跳过，不会重复。
 * 没写分组时放进第一个分组，一个分组都没有就建「未分类」。
 */
export function addBookmarks(groups: BookmarkGroup[], entries: BookmarkInput[]): AddResult {
  const next = groups.map((g) => ({...g, items: [...g.items]}))
  const seen = new Set(next.flatMap((g) => g.items.map((i) => keyOf(i.url))))
  let total = countBookmarks(next)
  let added = 0
  const skipped: string[] = []

  for (const entry of entries) {
    const url = normalizeUrl(entry.url)
    if (!url) {
      skipped.push(`${entry.url}（地址无效）`)
      continue
    }
    if (seen.has(keyOf(url))) {
      skipped.push(`${hostOf(url)}（已存在）`)
      continue
    }
    if (total >= MAX_BOOKMARKS) {
      skipped.push(`${hostOf(url)}（超过 ${MAX_BOOKMARKS} 条上限）`)
      continue
    }
    const groupName = entry.group?.trim() || next[0]?.name || DEFAULT_GROUP
    let group = next.find((g) => g.name === groupName)
    if (!group) {
      group = {id: uid(), name: groupName, items: []}
      next.push(group)
    }
    group.items.push({id: uid(), name: entry.name?.trim() || hostOf(url), url})
    seen.add(keyOf(url))
    total += 1
    added += 1
  }
  return {groups: next, added, skipped}
}

export type UpdatePatch = {name?: string; url?: string; group?: string}

/** 改一个书签：名称、地址、所属分组。换分组时会放到新分组末尾。 */
export function updateBookmark(groups: BookmarkGroup[], id: string, patch: UpdatePatch): {groups: BookmarkGroup[]; error?: string} {
  const source = groups.find((g) => g.items.some((i) => i.id === id))
  const current = source?.items.find((i) => i.id === id)
  if (!source || !current) return {groups, error: `没有这个书签：${id}`}

  let url = current.url
  if (patch.url !== undefined) {
    const normalized = normalizeUrl(patch.url)
    if (!normalized) return {groups, error: `地址无效：${patch.url}`}
    url = normalized
  }
  const updated = {...current, url, name: patch.name === undefined ? current.name : patch.name.trim() || hostOf(url)}
  const targetName = patch.group?.trim()

  let next = groups.map((g) => (g.id === source.id ? {...g, items: g.items.map((i) => (i.id === id ? updated : i))} : g))
  if (targetName && targetName !== source.name) {
    next = next.map((g) => (g.id === source.id ? {...g, items: g.items.filter((i) => i.id !== id)} : g))
    const target = next.find((g) => g.name === targetName)
    next = target ? next.map((g) => (g === target ? {...g, items: [...g.items, updated]} : g)) : [...next, {id: uid(), name: targetName, items: [updated]}]
  }
  return {groups: next}
}

/** 按 id 或地址删书签，返回删了几个。 */
export function removeBookmarks(groups: BookmarkGroup[], match: {ids?: string[]; urls?: string[]}): {groups: BookmarkGroup[]; removed: number} {
  const ids = new Set(match.ids ?? [])
  const urls = new Set((match.urls ?? []).map((u) => normalizeUrl(u) ?? u).map(keyOf))
  let removed = 0
  const next = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      const hit = ids.has(i.id) || urls.has(keyOf(i.url))
      if (hit) removed += 1
      return !hit
    }),
  }))
  return {groups: next, removed}
}

export function renameGroup(groups: BookmarkGroup[], id: string, name: string): {groups: BookmarkGroup[]; error?: string} {
  const clean = name.trim()
  if (!clean) return {groups, error: '分组名不能为空'}
  if (groups.some((g) => g.id !== id && g.name === clean)) return {groups, error: `已经有叫「${clean}」的分组`}
  return {groups: groups.map((g) => (g.id === id ? {...g, name: clean} : g))}
}

export const removeGroup = (groups: BookmarkGroup[], id: string) => groups.filter((g) => g.id !== id)

/* ---------- 导入 ---------- */

type Flat = {name: string; url: string; path: string[]}

/** 文件夹路径 → 分组名。根目录（书签栏/其他书签）本身不当分组，只取它下面的第一级。 */
export function groupName(path: string[], rootFallback: string): string {
  if (path.length === 0) return rootFallback
  if (path.length === 1) return path[0]
  return path.slice(1).join(' / ')
}

function fromHtml(text: string): Flat[] {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return [...doc.querySelectorAll('a[href]')].map((a) => {
    const path: string[] = []
    let node: Element | null = a.parentElement
    while (node) {
      const dl: Element | null = node.closest('dl')
      if (!dl) break
      const title = dl.previousElementSibling?.tagName === 'H3' ? dl.previousElementSibling : dl.parentElement?.querySelector(':scope > h3')
      if (title?.textContent?.trim()) path.unshift(title.textContent.trim())
      node = dl.parentElement
    }
    return {name: a.textContent?.trim() ?? '', url: a.getAttribute('href') ?? '', path}
  })
}

type ChromeNode = {type?: string; name?: string; url?: string; children?: ChromeNode[]}

function fromChrome(text: string): Flat[] {
  const roots = (JSON.parse(text) as {roots?: Record<string, ChromeNode>}).roots ?? {}
  const out: Flat[] = []
  const walk = (node: ChromeNode, path: string[]) => {
    if (node.type === 'url' && node.url) out.push({name: node.name ?? '', url: node.url, path})
    for (const child of node.children ?? []) walk(child, child.type === 'folder' ? [...path, child.name ?? ''] : path)
  }
  for (const root of Object.values(roots)) if (root && typeof root === 'object' && root.children) walk(root, root.name ? [root.name] : [])
  return out
}

/** 解析浏览器导出的书签：HTML（Chrome/Edge/Safari/Firefox 都能导出）或 Chrome 的 Bookmarks 文件。 */
export function parseBookmarkFile(text: string): BookmarkInput[] {
  const body = text.trim()
  const flat = body.startsWith('{') ? fromChrome(body) : fromHtml(body)
  return flat.map((item) => ({name: item.name, url: item.url, group: groupName(item.path, '书签栏')}))
}

/** 导出成 Netscape HTML：所有浏览器都能「导入书签」。 */
export function toHtml(groups: BookmarkGroup[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const folders = groups
    .map((g) => `    <DT><H3>${esc(g.name)}</H3>\n    <DL><p>\n${g.items.map((i) => `        <DT><A HREF="${esc(i.url)}">${esc(i.name)}</A>`).join('\n')}\n    </DL><p>`)
    .join('\n')
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${folders}\n</DL><p>\n`
}

/** 让用户选一个文件，读出文本。取消返回 null。 */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = async () => resolve((await input.files?.[0]?.text()) ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export function download(filename: string, content: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], {type}))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** 选文件 → 解析 → 合并进书签。返回给用户看的一句话。 */
export async function importFromFile(): Promise<string | null> {
  const text = await pickTextFile()
  if (text === null) return null
  let entries: BookmarkInput[]
  try {
    entries = parseBookmarkFile(text)
  } catch {
    return '这个文件读不了。请选浏览器导出的书签 HTML，或 Chrome 的 Bookmarks 文件。'
  }
  if (!entries.length) return '文件里没有找到书签。'
  const result = addBookmarks(getBookmarks(), entries)
  setBookmarks(result.groups)
  const dup = result.skipped.length
  return `导入了 ${result.added} 个书签${dup ? `，${dup} 个已存在或无效，已跳过` : ''}。`
}
