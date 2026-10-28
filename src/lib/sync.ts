import {useSyncExternalStore} from 'react'
import {flush as flushChat} from './chat'
import {flush as flushData, dropPendingData} from './componentData'
import {db, openDb} from './db'
import {proxied} from './rss'
import {assertPersistenceHealthy, assertPersistenceWritable, retryPersistence} from './persistence'

/**
 * 跨设备同步。纯前端：把数据整份放到用户自己的存储里（WebDAV / GitHub Gist / 自建 HTTP），
 * 每台设备各自拉取、按「记录」合并、再推回去。没有我们自己的服务端。
 *
 * 记录（record）是合并的最小单位：
 *   ls:<key>   localStorage 里的一份配置（工作空间、设置、人设……）
 *   kv:<id>    组件数据（待办、日程、书签……）
 *   conv:<id>  对话
 *   turn:<id>  对话里的一轮
 * 每条记录有最后修改时间 t，同一条记录两边都改了，新的赢；只在一边出现的，两边取并集。
 * 删除用墓碑（d）记下来，不然另一台设备会把它「找回来」。
 *
 * 业务代码不用改：本地有没有改过，靠每次同步时比对内容哈希发现（meta）。
 *
 * 密钥默认不同步：API Key、监控 Token / 密码、.ics 订阅地址会在上传前剔掉，
 * 下载时又用本机的值补回去。勾选「同步密钥」后才一起传，且必须设口令加密。
 */

const CONFIG_KEY = 'fp.sync.config'
const META_KEY = 'fp.sync.meta'
const FILE = 'dada-sync.json'
const TOMBSTONE_DAYS = 90

export type Backend = 'webdav' | 'gist' | 'http'

export type SyncConfig = {
  backend: Backend
  webdav: {url: string; user: string; pass: string; proxy: string}
  gist: {token: string; id: string}
  http: {url: string; token: string; proxy: string}
  /** 连同密钥一起同步（必须设口令） */
  secrets: boolean
  /** 端到端加密口令；留空不加密 */
  passphrase: string
  auto: boolean
  /** 这台设备的标识，只用来排查 */
  device: string
}

export const defaultSyncConfig = (): SyncConfig => ({
  backend: 'webdav',
  webdav: {url: '', user: '', pass: '', proxy: ''},
  gist: {token: '', id: ''},
  http: {url: '', token: '', proxy: ''},
  secrets: false,
  passphrase: '',
  auto: true,
  device: Math.random().toString(36).slice(2, 8),
})

export function readSyncConfig(): SyncConfig {
  const base = defaultSyncConfig()
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<SyncConfig>
    return {...base, ...saved, webdav: {...base.webdav, ...saved.webdav}, gist: {...base.gist, ...saved.gist}, http: {...base.http, ...saved.http}}
  } catch {
    return base
  }
}

export function writeSyncConfig(config: SyncConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  emit()
}

export function syncConfigured(config = readSyncConfig()): boolean {
  if (config.backend === 'webdav') return Boolean(config.webdav.url.trim())
  if (config.backend === 'gist') return Boolean(config.gist.token.trim())
  return Boolean(config.http.url.trim())
}

/** 配置有问题时的提示；没问题返回空串。 */
export function syncConfigProblem(config: SyncConfig): string {
  if (!syncConfigured(config)) return '先把连接信息填完整。'
  if (config.secrets && !config.passphrase) return '同步密钥必须设置加密口令。'
  return ''
}

// ───────────────────────── 状态 ─────────────────────────

export type SyncStatus = {phase: 'idle' | 'syncing' | 'ok' | 'error'; at?: number; message?: string}

let status: SyncStatus = {phase: 'idle'}
try {
  const saved = JSON.parse(localStorage.getItem('fp.sync.last') ?? 'null') as SyncStatus | null
  if (saved) status = saved
} catch {
  /* 没有上次的结果 */
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
function setStatus(next: SyncStatus) {
  status = next
  if (next.phase !== 'syncing') {
    try {
      localStorage.setItem('fp.sync.last', JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
  }
  emit()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => status,
  )
}
/** 订阅配置变化（给设置页刷新用）。 */
export function useSyncConfigVersion(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => localStorage.getItem(CONFIG_KEY) ?? '',
  )
}

// ───────────────────────── 记录与密钥 ─────────────────────────

type Rec = {t: number; h: string; v?: unknown; d?: 1}
type Meta = {mode: 0 | 1; recs: Record<string, {h: string; t: number; d?: 1}>}
type Local = {v: unknown; full: unknown; h: string; secret: boolean}

/** 每台设备自己的状态，不跟着走。 */
const DEVICE_ONLY = new Set(['fp.page', 'fp.conv', 'fp.focusState', 'fp.repoStats', 'fp.chatTurns.v2'])

const SECRET_FIELDS = new Set(['apiKey', 'token', 'password', 'secret', 'keys'])
const ICS_FIELDS = new Set(['url'])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function strip(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, fields))
  if (!isObj(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (!fields.has(k)) out[k] = strip(v, fields)
  return out
}

/** 把本机的密钥字段补回远端来的值里。onlyMissing：远端自己带了的就用远端的。 */
function restore(remote: unknown, local: unknown, fields: Set<string>, onlyMissing: boolean): unknown {
  if (Array.isArray(remote)) {
    const localList = Array.isArray(local) ? local : []
    const byId = new Map(localList.filter((i) => isObj(i) && typeof i.id === 'string').map((i) => [(i as {id: string}).id, i]))
    return remote.map((item, index) => {
      const id = isObj(item) && typeof item.id === 'string' ? item.id : undefined
      return restore(item, id ? byId.get(id) : localList[index], fields, onlyMissing)
    })
  }
  if (!isObj(remote)) return remote
  const mine = isObj(local) ? local : {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(remote)) out[k] = restore(v, mine[k], fields, onlyMissing)
  for (const f of fields) {
    if (onlyMissing) {
      if (!(f in out) && f in mine) out[f] = mine[f]
    } else if (f in mine) out[f] = mine[f]
    else delete out[f]
  }
  return out
}

const fieldsFor = (id: string) => (id === 'kv:@shared.icsSubs' ? ICS_FIELDS : SECRET_FIELDS)

/** 32 位 FNV-1a，够用来发现「内容变了没有」。 */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`
}

function readMeta(): Meta | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as Meta) : null
  } catch {
    return null
  }
}
const writeMeta = (meta: Meta) => localStorage.setItem(META_KEY, JSON.stringify(meta))

async function collectLocal(withSecrets: boolean): Promise<Map<string, Local>> {
  const out = new Map<string, Local>()
  const put = (id: string, full: unknown) => {
    const fields = fieldsFor(id)
    const shown = withSecrets ? full : strip(full, fields)
    const secret = JSON.stringify(strip(full, fields)) !== JSON.stringify(full)
    out.set(id, {v: shown, full, h: hash(JSON.stringify(shown)), secret})
  }
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('fp.') || key.startsWith('fp.sync.') || key.startsWith('fp.data.') || DEVICE_ONLY.has(key)) continue
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = {__raw: raw}
    }
    put(`ls:${key}`, parsed)
  }
  await openDb()
  for (const row of await db.all<{k: string; v: unknown}>('kv')) put(`kv:${row.k}`, row.v)
  for (const conv of await db.all<{id: string}>('convs')) put(`conv:${conv.id}`, conv)
  for (const turn of await db.all<{id: string; endedAt?: number}>('turns')) {
    if (turn.endedAt === undefined) continue // 还在生成的那一轮先不传
    put(`turn:${turn.id}`, turn)
  }
  return out
}

/** 把一条远端记录写进本机。 */
async function applyOne(id: string, rec: Rec, localFull: unknown, withSecrets: boolean) {
  const sep = id.indexOf(':')
  const kind = id.slice(0, sep)
  const name = id.slice(sep + 1)
  if (rec.d) {
    if (kind === 'ls') localStorage.removeItem(name)
    else if (kind === 'kv') await db.del('kv', name)
    else if (kind === 'conv') await db.del('convs', name)
    else if (kind === 'turn') await db.del('turns', name)
    return
  }
  // 本机没有的密钥字段保持为空；远端自己带了密钥就用远端的
  const value = restore(rec.v, localFull, fieldsFor(id), withSecrets)
  if (kind === 'ls') {
    const raw = isObj(value) && typeof value.__raw === 'string' && Object.keys(value).length === 1 ? value.__raw : JSON.stringify(value)
    localStorage.setItem(name, raw)
  } else if (kind === 'kv') await db.put('kv', {k: name, v: value})
  else if (kind === 'conv') await db.put('convs', value)
  else if (kind === 'turn') await db.put('turns', value)
}

// ───────────────────────── 加密 ─────────────────────────

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function aesKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt: salt as BufferSource, iterations: 150_000, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt'])
}

async function seal(text: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(pass, salt)
  const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(text)))
  return JSON.stringify({app: 'dada', enc: 1, salt: b64(salt), iv: b64(iv), data: b64(data)})
}

async function unseal(text: string, pass: string): Promise<Record<string, Rec>> {
  let file = JSON.parse(text) as {app?: string; enc?: number; salt?: string; iv?: string; data?: string; recs?: Record<string, Rec>}
  if (file.app !== 'dada') throw new Error('远端文件不是搭搭的同步数据。')
  if (file.enc) {
    if (!pass) throw new Error('云端的数据加了密，先填上加密口令。')
    try {
      const key = await aesKey(pass, unb64(file.salt ?? ''))
      const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(file.iv ?? '') as BufferSource}, key, unb64(file.data ?? '') as BufferSource)
      file = JSON.parse(new TextDecoder().decode(plain))
    } catch {
      throw new Error('口令不对，解不开云端的数据。')
    }
  }
  return file.recs ?? {}
}

// ───────────────────────── 后端 ─────────────────────────

type Remote = {read(): Promise<{text: string | null; etag?: string}>; write(text: string, etag?: string): Promise<void>}

async function check(res: Response, what: string) {
  if (res.ok) return
  if (res.status === 401 || res.status === 403) throw new Error(`${what}：账号或令牌不对（${res.status}）。`)
  if (res.status === 412) throw Object.assign(new Error('云端刚被另一台设备更新了。'), {conflict: true})
  throw new Error(`${what}：${res.status} ${res.statusText}`.trim())
}

function guard<T>(run: () => Promise<T>, what: string): Promise<T> {
  return run().catch((error) => {
    if (error instanceof TypeError) throw new Error(`${what}：连不上。可能是地址不对，或服务器没有开放跨域（CORS）。`)
    throw error
  })
}

function webdav(config: SyncConfig['webdav']): Remote {
  const base = config.url.trim()
  const url = proxied(/\.json$/i.test(base) ? base : `${base.replace(/\/+$/, '')}/${FILE}`, config.proxy)
  const auth: Record<string, string> = config.user ? {authorization: `Basic ${btoa(unescape(encodeURIComponent(`${config.user}:${config.pass}`)))}`} : {}
  return {
    read: () =>
      guard(async () => {
        const res = await fetch(url, {headers: auth, cache: 'no-store'})
        if (res.status === 404) return {text: null}
        await check(res, 'WebDAV')
        return {text: await res.text(), etag: res.headers.get('etag') ?? undefined}
      }, 'WebDAV'),
    write: (text, etag) =>
      guard(async () => {
        const res = await fetch(url, {method: 'PUT', headers: {...auth, 'content-type': 'application/json', ...(etag ? {'if-match': etag} : {})}, body: text})
        if (res.status === 409) throw new Error('WebDAV：目录不存在，先在服务器上建好这个文件夹。')
        await check(res, 'WebDAV')
      }, 'WebDAV'),
  }
}

function gist(config: SyncConfig['gist'], save: (id: string) => void): Remote {
  const headers = {authorization: `Bearer ${config.token.trim()}`, accept: 'application/vnd.github+json'}
  let id = config.id.trim()
  return {
    read: () =>
      guard(async () => {
        if (!id) return {text: null}
        const res = await fetch(`https://api.github.com/gists/${id}`, {headers, cache: 'no-store'})
        if (res.status === 404) throw new Error('GitHub：找不到这个 Gist，检查 ID 和令牌的 gist 权限。')
        await check(res, 'GitHub')
        const file = ((await res.json()) as {files?: Record<string, {content?: string; truncated?: boolean; raw_url?: string}>}).files?.[FILE]
        if (!file) return {text: null}
        if (file.truncated && file.raw_url) return {text: await (await fetch(file.raw_url, {cache: 'no-store'})).text()}
        return {text: file.content ?? null}
      }, 'GitHub'),
    write: (text) =>
      guard(async () => {
        const files = {[FILE]: {content: text}}
        const res = id
          ? await fetch(`https://api.github.com/gists/${id}`, {method: 'PATCH', headers, body: JSON.stringify({files})})
          : await fetch('https://api.github.com/gists', {method: 'POST', headers, body: JSON.stringify({description: '搭搭同步数据（勿改）', public: false, files})})
        await check(res, 'GitHub')
        if (!id) {
          id = ((await res.json()) as {id: string}).id
          save(id)
        }
      }, 'GitHub'),
  }
}

function http(config: SyncConfig['http']): Remote {
  const url = proxied(config.url.trim(), config.proxy)
  const auth: Record<string, string> = config.token ? {authorization: `Bearer ${config.token}`} : {}
  return {
    read: () =>
      guard(async () => {
        const res = await fetch(url, {headers: auth, cache: 'no-store'})
        if (res.status === 404) return {text: null}
        await check(res, '服务器')
        const text = await res.text()
        return {text: text.trim() ? text : null, etag: res.headers.get('etag') ?? undefined}
      }, '服务器'),
    write: (text, etag) =>
      guard(async () => {
        const res = await fetch(url, {method: 'PUT', headers: {...auth, 'content-type': 'application/json', ...(etag ? {'if-match': etag} : {})}, body: text})
        await check(res, '服务器')
      }, '服务器'),
  }
}

function remoteFor(config: SyncConfig): Remote {
  if (config.backend === 'webdav') return webdav(config.webdav)
  if (config.backend === 'gist') return gist(config.gist, (id) => writeSyncConfig({...readSyncConfig(), gist: {...readSyncConfig().gist, id}}))
  return http(config.http)
}

/** 只测连得通不通、口令对不对，不改任何数据。 */
export async function testConnection(config: SyncConfig): Promise<string> {
  const problem = syncConfigProblem(config)
  if (problem) throw new Error(problem)
  const {text} = await remoteFor(config).read()
  if (text === null) return '连接成功，云端还没有数据，首次同步会把这台设备的数据传上去。'
  const recs = await unseal(text, config.passphrase)
  return `连接成功，云端有 ${Object.keys(recs).filter((id) => !recs[id].d).length} 条记录。`
}

// ───────────────────────── 同步 ─────────────────────────

export type SyncResult = {pulled: number; pushed: number}
export type SyncMode = 'full' | 'push'

let running: Promise<SyncResult> | null = null

/** 恢复本机数据前，等待已经开始的同步结束；未开始的新同步由保存门禁阻止。 */
export async function waitForSyncIdle(): Promise<void> {
  if (running) await running.catch(() => undefined)
}

/**
 * 同步一次。
 * full：拉、合并、写回本机、推。写回本机之后需要刷新页面才生效，所以只在启动、手动、页面在后台时用。
 * push：页面正开着时只推送本机的改动，不动本机数据，免得改到用户正在编辑的内容。
 */
export function runSync(mode: SyncMode = 'full'): Promise<SyncResult> {
  running ??= doSync(mode, 0).finally(() => {
    running = null
  })
  return running
}

async function doSync(mode: SyncMode, attempt: number): Promise<SyncResult> {
  const config = readSyncConfig()
  const problem = syncConfigProblem(config)
  if (problem) throw new Error(problem)
  setStatus({phase: 'syncing', at: status.at})
  try {
    assertPersistenceWritable()
    await retryPersistence()
    await Promise.all([flushData(), flushChat()])
    assertPersistenceHealthy()
    const now = Date.now()
    const withSecrets = config.secrets
    const local = await collectLocal(withSecrets)

    // 1) 发现本机改动：内容哈希变了就记新的修改时间
    const first = readMeta()
    const meta: Meta = first ?? {mode: withSecrets ? 1 : 0, recs: {}}
    const modeChanged = first !== null && first.mode !== (withSecrets ? 1 : 0)
    for (const [id, item] of local) {
      const known = meta.recs[id]
      if (!known) meta.recs[id] = {h: item.h, t: first ? now : 0}
      else if (known.d) meta.recs[id] = {h: item.h, t: now}
      else if (known.h !== item.h) meta.recs[id] = {h: item.h, t: modeChanged && !withSecrets ? known.t : now}
    }
    for (const [id, known] of Object.entries(meta.recs)) {
      if (!local.has(id) && !known.d) meta.recs[id] = {h: '', t: now, d: 1}
    }
    meta.mode = withSecrets ? 1 : 0

    // 2) 读云端
    const remote = remoteFor(config)
    const {text, etag} = await remote.read()
    const theirs = text === null ? {} : await unseal(text, config.passphrase)

    // 3) 合并
    const toApply: [string, Rec][] = []
    const out: Record<string, Rec> = {...theirs}
    let pushed = 0
    for (const id of new Set([...Object.keys(theirs), ...Object.keys(meta.recs)])) {
      const mine = meta.recs[id]
      const rec = theirs[id]
      if (!rec) {
        if (mine && !mine.d) {
          out[id] = {t: mine.t, h: mine.h, v: local.get(id)?.v}
          pushed += 1
        } else if (mine?.d) {
          out[id] = {t: mine.t, h: '', d: 1}
          pushed += 1
        }
        continue
      }
      if (!mine) {
        if (!rec.d) toApply.push([id, rec])
        continue
      }
      const remoteWins = rec.t > mine.t || (rec.t === mine.t && mine.t === 0 && rec.h !== mine.h && !mine.d)
      if (remoteWins) {
        if (rec.d && mine.d) continue
        toApply.push([id, rec])
      } else if (mine.t > rec.t) {
        out[id] = mine.d ? {t: mine.t, h: '', d: 1} : {t: mine.t, h: mine.h, v: local.get(id)?.v}
        pushed += 1
      }
    }

    // 4) 写回本机（页面正开着时不写）
    let pulled = 0
    if (mode === 'full' && toApply.length) {
      assertPersistenceWritable()
      dropPendingData()
      for (const [id, rec] of toApply) {
        await applyOne(id, rec, local.get(id)?.full, withSecrets)
        pulled += 1
      }
      const after = await collectLocal(withSecrets)
      for (const [id, rec] of toApply) {
        meta.recs[id] = rec.d ? {h: '', t: rec.t, d: 1} : {h: after.get(id)?.h ?? rec.h, t: rec.t}
      }
    }

    // 5) 推送
    if (pushed || text === null) {
      assertPersistenceWritable()
      const cutoff = now - TOMBSTONE_DAYS * 86_400_000
      for (const [id, rec] of Object.entries(out)) if (rec.d && rec.t < cutoff) delete out[id]
      const body = JSON.stringify({app: 'dada', v: 1, at: now, device: config.device, recs: out})
      await remote.write(config.passphrase ? await seal(body, config.passphrase) : body, etag)
    }
    for (const [id, known] of Object.entries(meta.recs)) if (known.d && known.t < now - TOMBSTONE_DAYS * 86_400_000) delete meta.recs[id]
    writeMeta(meta)
    setStatus({phase: 'ok', at: Date.now(), message: pulled || pushed ? `拉取 ${pulled} 条，上传 ${pushed} 条` : '已是最新'})
    return {pulled, pushed}
  } catch (error) {
    if (attempt < 1 && (error as {conflict?: boolean}).conflict) return doSync(mode, attempt + 1)
    const message = error instanceof Error ? error.message : String(error)
    setStatus({phase: 'error', at: Date.now(), message})
    throw error
  }
}

// ───────────────────────── 自动同步 ─────────────────────────

let started = false
let lastRun = 0

/** 启动时调用一次：启动即同步，之后定时推送，切到后台时完整同步一次。 */
export function startAutoSync() {
  if (started || typeof window === 'undefined') return
  started = true
  const ready = () => {
    const config = readSyncConfig()
    return config.auto && syncConfigured(config) && !syncConfigProblem(config) && navigator.onLine
  }
  const run = async (mode: SyncMode, reloadOnPull: boolean) => {
    if (!ready()) return
    lastRun = Date.now()
    try {
      const result = await runSync(mode)
      if (result.pulled && reloadOnPull) location.reload()
    } catch {
      /* 错误已记在状态里，设置页能看到 */
    }
  }
  window.setTimeout(() => void run('full', true), 1500)
  window.setInterval(() => document.visibilityState === 'visible' && void run('push', false), 3 * 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void run('full', true)
    else if (Date.now() - lastRun > 60_000) void run('push', false)
  })
  window.addEventListener('online', () => void run('push', false))
}

/** 手动同步：完整同步，有拉下来的数据就刷新页面。 */
export async function syncNow(): Promise<SyncResult> {
  const result = await runSync('full')
  if (result.pulled) window.setTimeout(() => location.reload(), 600)
  return result
}
