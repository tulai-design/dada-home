import {proxied} from './rss'
import {FILE, MAX_GIST_BYTES, MAX_SYNC_BYTES, type RemoteRead, type RemoteVersion, type SyncConfig, type SyncRemote} from './syncTypes'

export {FILE, MAX_GIST_BYTES, MAX_SYNC_BYTES} from './syncTypes'
export type {RemoteVersion, SyncRemote} from './syncTypes'

type ErrorCode = 'auth' | 'rate-limit' | 'conflict' | 'http' | 'network' | 'timeout' | 'invalid-response' | 'too-large' | 'invalid-config'
export class SyncProviderError extends Error {
  conflict?: boolean
  retryAt?: number
  constructor(message: string, readonly code: ErrorCode, details: {conflict?: boolean; retryAt?: number} = {}) {
    super(message)
    this.name = 'SyncProviderError'
    Object.assign(this, details)
  }
}

const TIMEOUT_MS = 20_000
const encoder = new TextEncoder()
const cooldowns = new Map<string, {retryAt: number; strikes: number}>()
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
function invalid(message: string): never {throw new SyncProviderError(message, 'invalid-response')}
function limitError(limit: number): never {throw new SyncProviderError(`同步正文超过处理预算（${limit / 1024 / 1024} MiB），没有截断数据。`, 'too-large')}

function connectionKey(config: SyncConfig): string {
  if (config.backend === 'gist') return `gist:${config.gist.id.trim()}`
  if (config.backend === 'sync') return `sync:${config.sync.key.length}:${config.sync.key.slice(-8)}`
  const value = config.backend === 'webdav' ? config.webdav : config.http
  return `${config.backend}:${value.url.trim()}:${value.proxy.trim()}`
}

export function getProviderRetryAt(config: SyncConfig): number | undefined {
  const retryAt = cooldowns.get(connectionKey(config))?.retryAt
  return retryAt && retryAt > Date.now() ? retryAt : undefined
}

function assertReady(key: string) {
  const retryAt = cooldowns.get(key)?.retryAt
  if (retryAt && retryAt > Date.now()) throw new SyncProviderError('同步服务暂时限流或不可用，请到重试时间后再试。', 'rate-limit', {retryAt})
}

function endpoint(value: string): URL {
  let url: URL
  try {url = new URL(value)} catch {throw new SyncProviderError('同步地址不是有效的 HTTP(S) 地址。', 'invalid-config')}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new SyncProviderError('同步地址仅支持 HTTP(S)，账号和令牌请填在独立连接字段。', 'invalid-config')
  if (/^\/__proxy\/?$/.test(url.pathname)) throw new SyncProviderError('内置取数代理只读，不能用于同步；请使用支持读写的同步代理。', 'invalid-config')
  url.hash = ''
  return url
}

function connectionUrl(value: string, proxy: string, directory: boolean): string {
  const target = endpoint(value.trim())
  if (directory && !/\.json$/i.test(target.pathname)) target.pathname = `${target.pathname.replace(/\/+$/, '')}/${FILE}`
  return endpoint(proxied(target.toString(), proxy)).toString()
}

/** 业务基线按实际目标绑定，凭据和代理路由不改变同一个远端资源。 */
export function syncResourceIdentity(config: SyncConfig): {id: string} | {url: string; user?: string} {
  if (config.backend === 'gist') return {id: config.gist.id.trim()}
  if (config.backend === 'sync') return {url: 'service'}
  const webdav = config.backend === 'webdav'
  const value = webdav ? config.webdav : config.http
  return {url: connectionUrl(value.url, '', webdav), ...(webdav ? {user: config.webdav.user} : {})}
}

function byteLength(text: string, limit: number): number {
  const bytes = encoder.encode(text).byteLength
  if (bytes > limit) limitError(limit)
  return bytes
}

/** Content-Length 仅用于提前拒绝；实际流仍逐块计字节，不信任小报的长度。 */
async function readText(response: Response, limit: number): Promise<{text: string; bytes: number}> {
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body?.cancel().catch(() => undefined)
    limitError(limit)
  }
  if (!response.body) return {text: '', bytes: 0}
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', {fatal: true})
  let bytes = 0
  const parts: string[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) {void reader.cancel().catch(() => undefined); limitError(limit)}
      try {parts.push(decoder.decode(next.value, {stream: true}))} catch {invalid('同步正文不是有效的 UTF-8 编码。')}
    }
    try {parts.push(decoder.decode())} catch {invalid('同步正文不是完整的 UTF-8 编码。')}
  } finally {reader.releaseLock()}
  return {text: parts.join(''), bytes}
}

function parsedJson(text: string): unknown {
  try {return JSON.parse(text)} catch {return invalid('同步服务返回了无效的 JSON。')}
}

function retryDeadline(response: Response, strikes: number, rateLimited: boolean): number {
  const now = Date.now()
  const after = response.headers.get('retry-after')
  if (after) {
    const at = /^\d+(?:\.\d+)?$/.test(after) ? now + Number(after) * 1000 : Date.parse(after)
    if (Number.isFinite(at)) return Math.max(now + 1000, at)
  }
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
  if (response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > now) return reset
  return now + Math.min(rateLimited ? 3_600_000 : 300_000, (rateLimited ? 60_000 : 5000) * 2 ** Math.min(strikes - 1, 6))
}

async function check(response: Response, label: string, key: string, webdav: boolean) {
  if (response.ok) return
  if (response.status === 412 || (response.status === 409 && !webdav)) throw new SyncProviderError('云端版本刚被更新，请重新同步。', 'conflict', {conflict: true})
  if (response.status === 409 && webdav) throw new SyncProviderError('WebDAV 返回 409，请先确认同步目录存在。', 'http')
  let secondaryLimit = false
  if (response.status === 403 && !response.headers.has('retry-after') && response.headers.get('x-ratelimit-remaining') !== '0') {
    try {
      const {text} = await readText(response, 16 * 1024)
      const error = JSON.parse(text) as unknown
      secondaryLimit = object(error) && typeof error.message === 'string' && /rate limit|abuse detection/i.test(error.message)
    } catch { /* 不在错误中泄漏供应商响应正文。 */ }
  }
  const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0' || secondaryLimit))
  if (rateLimited || response.status >= 500) {
    const strikes = (cooldowns.get(key)?.strikes ?? 0) + 1
    const retryAt = retryDeadline(response, strikes, rateLimited)
    cooldowns.set(key, {retryAt, strikes})
    throw new SyncProviderError(`${label}：${rateLimited ? '请求受到限流' : '服务暂时不可用'}（${response.status}），请稍后重试。`, rateLimited ? 'rate-limit' : 'http', {retryAt})
  }
  if (response.status === 401 || response.status === 403) throw new SyncProviderError(`${label}：访问被拒绝（${response.status}），请检查账号或令牌权限。`, 'auth')
  throw new SyncProviderError(`${label}：请求失败（${response.status}）。`, 'http')
}

/** 超时覆盖请求和正文读取；不靠长时间 sleep 重试或挂住上层同步。 */
async function request<T>(url: string, init: RequestInit, label: string, key: string, consume: (response: Response) => Promise<T>): Promise<T> {
  assertReady(key)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SyncProviderError(`${label}：请求超时，请检查网络后重试。`, 'timeout'))
      controller.abort()
    }, TIMEOUT_MS)
  })
  try {
    return await Promise.race([(async () => consume(await fetch(url, {...init, signal: controller.signal, cache: 'no-store', redirect: 'error'})))(), timeout])
  } catch (error) {
    controller.abort()
    if (error instanceof SyncProviderError) throw error
    throw new SyncProviderError(`${label}：连接失败，请检查地址、网络和跨域（CORS）设置。`, 'network')
  } finally {if (timer !== undefined) clearTimeout(timer)}
}

function versionOf(response: Response): RemoteVersion {
  const etag = response.headers.get('etag')
  return etag && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? {kind: 'etag', etag} : {kind: 'unprotected'}
}

function httpRemote(config: SyncConfig): SyncRemote {
  const webdav = config.backend === 'webdav'
  const value = webdav ? config.webdav : config.http
  const url = connectionUrl(value.url, value.proxy, webdav)
  const key = connectionKey(config), label = webdav ? 'WebDAV' : '同步服务'
  const headers: Record<string, string> = {}
  if (webdav && config.webdav.user) headers.authorization = `Basic ${btoa(String.fromCharCode(...encoder.encode(`${config.webdav.user}:${config.webdav.pass}`)))}`
  if (!webdav && config.http.token) headers.authorization = `Bearer ${config.http.token}`
  return {
    read: () => request(url, {headers}, label, key, async response => {
      if (response.status === 404) {void response.body?.cancel().catch(() => undefined); cooldowns.delete(key); return {text: null, version: {kind: 'missing'}, bytes: 0}}
      await check(response, label, key, webdav)
      const body = await readText(response, MAX_SYNC_BYTES)
      if (!body.text.trim()) invalid('云端同步文件正文为空，未把它当作新文件覆盖。')
      cooldowns.delete(key)
      return {...body, version: versionOf(response)}
    }),
    write: (text, expected) => {
      const bytes = byteLength(text, MAX_SYNC_BYTES)
      const conditions: Record<string, string> = expected.kind === 'missing' ? {'if-none-match': '*'} : expected.kind === 'etag' ? {'if-match': expected.etag} : {}
      return request(url, {method: 'PUT', headers: {...headers, ...conditions, 'content-type': 'application/json'}, body: text}, label, key, async response => {
        await check(response, label, key, webdav)
        void response.body?.cancel().catch(() => undefined)
        cooldowns.delete(key)
        return {bytes}
      })
    },
  }
}

function gistId(value: unknown): value is string {return typeof value === 'string' && /^[\w-]{1,128}$/.test(value)}

function gistRawUrl(value: unknown): string {
  if (typeof value !== 'string') return invalid('Gist 正文已截断，但没有可用的 raw 下载地址。')
  let url: URL
  try {url = new URL(value)} catch {return invalid('Gist raw 下载地址无效。')}
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['gist.githubusercontent.com', 'raw.githubusercontent.com'].includes(url.hostname)) invalid('Gist raw 下载地址不是受支持的 GitHub HTTPS 来源。')
  return url.toString()
}

function gistRemote(config: SyncConfig): SyncRemote {
  const token = config.gist.token.trim()
  if (!token) throw new SyncProviderError('请填写 GitHub Gist 访问令牌。', 'invalid-config')
  let id = config.gist.id.trim()
  if (id && !gistId(id)) throw new SyncProviderError('Gist ID 格式无效。', 'invalid-config')
  const key = connectionKey(config), label = 'GitHub Gist'
  const headers = {authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28'}
  const apiUrl = () => `https://api.github.com/gists${id ? `/${encodeURIComponent(id)}` : ''}`
  return {
    read: async (): Promise<RemoteRead> => {
      assertReady(key)
      if (!id) return {text: null, version: {kind: 'missing'}, bytes: 0}
      const metadata = await request(apiUrl(), {headers}, label, key, async response => {
        if (response.status === 404) throw new SyncProviderError('GitHub Gist 不存在或无权访问，请检查 ID 和令牌权限。', 'auth')
        await check(response, label, key, false)
        const body = await readText(response, MAX_GIST_BYTES)
        return {...body, data: parsedJson(body.text)}
      })
      const data = metadata.data
      if (!object(data) || !object(data.files) || (own(data, 'truncated') && typeof data.truncated !== 'boolean')) invalid('GitHub Gist 文件列表格式无效。')
      if (!own(data.files, FILE)) {
        if (data.truncated) invalid('GitHub Gist 文件列表已截断，无法确认同步文件是否存在。')
        cooldowns.delete(key)
        return {text: null, version: {kind: 'missing'}, bytes: metadata.bytes}
      }
      const entry = data.files[FILE]
      if (!object(entry) || (own(entry, 'truncated') && typeof entry.truncated !== 'boolean')) invalid('GitHub Gist 同步文件格式无效。')
      if (own(entry, 'size') && (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0)) invalid('GitHub Gist 文件大小无效。')
      if (typeof entry.size === 'number' && entry.size > MAX_GIST_BYTES) limitError(MAX_GIST_BYTES)
      if (entry.truncated) {
        const raw = await request(gistRawUrl(entry.raw_url), {}, label, key, async response => {
          await check(response, label, key, false)
          return readText(response, MAX_GIST_BYTES)
        })
        if (!raw.text.trim()) invalid('Gist raw 同步文件正文为空。')
        cooldowns.delete(key)
        return {text: raw.text, version: {kind: 'unprotected'}, bytes: metadata.bytes + raw.bytes}
      }
      if (typeof entry.content !== 'string') invalid('GitHub Gist 同步文件缺少正文。')
      if (!entry.content.trim()) invalid('GitHub Gist 同步文件正文为空。')
      byteLength(entry.content, MAX_GIST_BYTES)
      cooldowns.delete(key)
      return {text: entry.content, version: {kind: 'unprotected'}, bytes: metadata.bytes}
    },
    write: async text => {
      byteLength(text, MAX_GIST_BYTES)
      const creating = !id
      const body = JSON.stringify({...(creating ? {description: '搭搭配置同步', public: false} : {}), files: {[FILE]: {content: text}}})
      const bytes = byteLength(body, MAX_GIST_BYTES)
      return request(apiUrl(), {method: creating ? 'POST' : 'PATCH', headers: {...headers, 'content-type': 'application/json'}, body}, label, key, async response => {
        await check(response, label, key, false)
        const result = parsedJson((await readText(response, MAX_GIST_BYTES)).text)
        if (!object(result) || !gistId(result.id) || (!creating && result.id !== id)) invalid('GitHub Gist 写入回复缺少有效 ID，尚未确认同步结果。')
        cooldowns.delete(key)
        if (creating) {id = result.id; return {createdGistId: id, bytes}}
        return {bytes}
      })
    },
  }
}

/** 网络层不解析搭搭业务协议，不访问本机存储，也不保存新建的 Gist ID。 */
export function createRemote(config: SyncConfig): SyncRemote {
  if (config.backend === 'sync') throw new SyncProviderError('自建同步服务不使用整包快照。', 'invalid-config')
  if (config.backend === 'gist') return gistRemote(config)
  return httpRemote(config)
}
