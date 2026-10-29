import {useSyncExternalStore} from 'react'
import {assertPersistenceWritable, reportPersistenceError} from './persistence'
import {commitStorage, saveBarrier} from './storageCommit'
import {createRemote, getProviderRetryAt, syncResourceIdentity} from './syncProviders'
import {changes, collect, project, validateAssociations, validateRecord} from './syncData'
import {canonical, compare, decode, digest, encode, object, recordHash, type Snapshot, type SyncRecord} from './syncProtocol'
import {parseSyncKey} from './syncKey'
import type {SyncConflictVersion, SyncRef} from './incrementalRows'
import type {SyncConfig, SyncScope} from './syncTypes'
export type {Backend, SyncConfig, SyncScope} from './syncTypes'

export const SYNC_OPEN_FLAG = 'dada-open-sync'

const CONFIG_KEY = 'fp.sync.config'
const META_KEY = 'fp.sync.meta.v2'
export const scopeForBackend = (backend: SyncConfig['backend']): SyncScope => backend === 'gist' ? 'configuration' : 'full'
export const defaultSyncConfig = (): SyncConfig => ({backend: 'webdav', webdav: {url: '', user: '', pass: '', proxy: ''}, gist: {token: '', id: ''}, http: {url: '', token: '', proxy: ''}, sync: {key: ''}, secrets: false, passphrase: '', auto: true, device: crypto.randomUUID()})
function validConfig(value: unknown): value is SyncConfig {
  if (!object(value) || typeof value.backend !== 'string' || !['webdav', 'http', 'gist', 'sync'].includes(value.backend) || typeof value.secrets !== 'boolean' || typeof value.auto !== 'boolean' || typeof value.passphrase !== 'string' || typeof value.device !== 'string' || !value.device || value.device.length > 200) return false
  const sections: [string, string[]][] = [['webdav', ['url', 'user', 'pass', 'proxy']], ['gist', ['token', 'id']], ['http', ['url', 'token', 'proxy']], ['sync', ['key']]]
  return sections.every(([name, fields]) => {
    const section = value[name]
    return object(section) && fields.every(key => typeof section[key] === 'string')
  })
}
/** 旧配置没有同步密钥字段时补空串，避免一打开设置就把原来的 WebDAV 或 Gist 连接清掉。 */
function storedConfig(value: unknown): unknown {
  if (!object(value)) return value
  const sync = object(value.sync) && typeof value.sync.key === 'string' ? value.sync : {key: ''}
  return {...value, sync}
}
export function readSyncConfig(): SyncConfig {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null')
    const config = storedConfig(saved)
    if (validConfig(config)) return config
  } catch { /* 设置页仍可修正损坏的本机连接配置。 */ }
  return defaultSyncConfig()
}
export function writeSyncConfig(config: SyncConfig): void {
  assertPersistenceWritable()
  if (!validConfig(config)) throw new Error('同步连接配置的格式无效。')
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  setStatus({phase: 'idle', needsReload: status.needsReload})
}
export function syncConfigured(config = readSyncConfig()): boolean {
  if (!validConfig(storedConfig(config))) return false
  if (config.backend === 'webdav') return Boolean(config.webdav.url.trim())
  if (config.backend === 'gist') return Boolean(config.gist.token.trim())
  if (config.backend === 'sync') {try {parseSyncKey(config.sync.key); return true} catch {return false}}
  return Boolean(config.http.url.trim())
}
export function syncConfigProblem(config: SyncConfig): string {
  const stored = storedConfig(config)
  if (!validConfig(stored)) return '同步连接配置的格式无效。'
  if (stored.backend === 'sync') {
    if (!stored.sync.key.trim()) return '先粘贴同步密钥。'
    try {parseSyncKey(stored.sync.key)} catch (error) {return error instanceof Error ? error.message : '同步密钥无效。'}
    return ''
  }
  if (!syncConfigured(stored)) return '先把连接信息填完整。'
  if (stored.secrets && !stored.passphrase) return '同步密钥必须设置加密口令。'
  if (!stored.device || stored.device.length > 200) return '设备标识无效。'
  return ''
}

/** 管理页用 `#sync=` 打开本站时，把密钥写入同步设置并清掉地址里的密钥。 */
export function consumeSyncKeyFromLocation(): void {
  if (typeof location === 'undefined') return
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '')
  const key = params.get('sync')
  if (!key) return
  try {parseSyncKey(key)} catch {return}
  try {writeSyncConfig({...readSyncConfig(), backend: 'sync', sync: {key: key.trim()}})} catch {return}
  params.delete('sync')
  const next = params.toString()
  history.replaceState(null, '', `${location.pathname}${location.search}${next ? `#${next}` : ''}`)
  sessionStorage.setItem(SYNC_OPEN_FLAG, '1')
}
export type SyncStatus = {phase: 'idle' | 'syncing' | 'ok' | 'error'; at?: number; message?: string; scope?: SyncScope; protection?: 'conditional' | 'unprotected'; downloadedBytes?: number; uploadedBytes?: number; retryAt?: number; needsReload?: boolean}
let status: SyncStatus = {phase: 'idle'}
const listeners = new Set<() => void>()
function setStatus(next: SyncStatus): void {status = next; listeners.forEach(fn => fn())}
export function useSyncStatus(): SyncStatus {return useSyncExternalStore(fn => {listeners.add(fn); return () => {listeners.delete(fn)}}, () => status)}
export function useSyncConfigVersion(): string {return useSyncExternalStore(fn => {listeners.add(fn); return () => {listeners.delete(fn)}}, () => localStorage.getItem(CONFIG_KEY) ?? '')}
export type SyncOptions = {decryptPassphrase?: string}
export type SyncResult = {pulled: number; pushed: number; scope?: SyncScope; protection?: 'conditional' | 'unprotected'; downloadedBytes?: number; uploadedBytes?: number; needsReload?: boolean}
export type SyncMode = 'full' | 'push'

type Known = Omit<SyncRecord, 'value'>
type Meta = {version: 2; initialized: boolean; checkpoint?: true; binding: string; counter: number; records: Record<string, Known>}
function binding(config: SyncConfig): string {
  const resource = syncResourceIdentity(config)
  return canonical({version: 2, scope: scopeForBackend(config.backend), backend: config.backend, resource})
}
function readMeta(key: string): Meta | null {
  const text = localStorage.getItem(META_KEY)
  if (!text) return null
  const raw: unknown = JSON.parse(text)
  if (!object(raw) || raw.version !== 2 || raw.binding !== key) return null
  if ((raw.checkpoint !== undefined && raw.checkpoint !== true) || typeof raw.initialized !== 'boolean' || !Number.isSafeInteger(raw.counter) || (raw.counter as number) < 0 || !object(raw.records)) throw new Error('本机同步元数据损坏，请保留数据后重建同步基线。')
  for (const row of Object.values(raw.records)) if (!object(row) || !object(row.revision) || !Number.isSafeInteger(row.revision.counter) || (row.revision.counter as number) < 0 || typeof row.revision.device !== 'string' || !row.revision.device || typeof row.hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.hash) || (row.deleted !== undefined && row.deleted !== true)) throw new Error('本机同步元数据损坏。')
  return raw as Meta
}
const known = (record: SyncRecord): Known => ({revision: record.revision, hash: record.hash, ...(record.deleted ? {deleted: true} : {})})
function assertConfig(original: string): void {if ((localStorage.getItem(CONFIG_KEY) ?? '') !== original) throw new Error('同步期间连接设置已改变，请按新设置重试。')}

/** 只读检查；Gist 尚未创建时没有网络调用，也不声称已验证令牌。 */
export async function testConnection(config: SyncConfig, options: SyncOptions = {}): Promise<string> {
  const problem = syncConfigProblem(config); if (problem) throw new Error(problem)
  if (config.backend === 'sync') return (await import('./syncService')).testServiceConnection(config.sync.key)
  if (config.backend === 'gist' && !config.gist.id.trim()) return '尚未创建 Gist，首次同步时创建；此检查没有验证令牌。'
  const {text} = await createRemote(config).read()
  if (text === null) return '连接成功，云端还没有数据。'
  const scope = scopeForBackend(config.backend)
  const {snapshot} = await decode(text, options.decryptPassphrase ?? config.passphrase, scope, (id, value, deleted) => validateRecord(id, value, deleted, scope))
  validateAssociations(snapshot.records)
  validatePolicy(snapshot)
  return `连接成功，云端有 ${Object.values(snapshot.records).filter(rec => !rec.deleted).length} 条记录。`
}
function validatePolicy(snapshot: Snapshot): void {
  if (snapshot.secrets) return
  for (const [id, rec] of Object.entries(snapshot.records)) if (!rec.deleted && canonical(project(id, rec.value, snapshot.scope, false)) !== canonical(rec.value)) throw new Error('不含密钥的快照携带已知凭据，已拒绝同步。')
}

let tail: Promise<unknown> = Promise.resolve()
const pending = new Map<string, Promise<SyncResult>>()
export function runSync(mode: SyncMode = 'full', options: SyncOptions = {}): Promise<SyncResult> {
  const key = `${mode}:${options.decryptPassphrase ?? ''}:${localStorage.getItem(CONFIG_KEY) ?? ''}`
  const existing = pending.get(key); if (existing) return existing
  const run = tail.catch(() => undefined).then(() => doSync(mode, options))
  pending.set(key, run)
  tail = run.finally(() => {pending.delete(key)})
  // 记录排队失败，但不产生未处理的拒绝；调用者仍收到原始错误。
  void tail.catch(() => undefined)
  return run
}
export async function waitForSyncIdle(): Promise<void> {await tail.catch(() => undefined)}

async function doSync(mode: SyncMode, options: SyncOptions): Promise<SyncResult> {
  const configRaw = localStorage.getItem(CONFIG_KEY) ?? '', config = readSyncConfig(), scope = scopeForBackend(config.backend)
  const problem = syncConfigProblem(config)
  if (problem) throw new Error(problem)
  const retryAt = getProviderRetryAt(config)
  if (retryAt && retryAt > Date.now()) {const error = Object.assign(new Error('同步服务仍在限流冷却中，请稍后重试。'), {retryAt}); setStatus({phase: 'error', scope, message: error.message, retryAt}); throw error}
  setStatus({phase: 'syncing', scope, at: status.at, needsReload: status.needsReload})
  let downloadedBytes = 0, uploadedBytes = 0
  let protection: 'conditional' | 'unprotected' | undefined
  try {
    assertPersistenceWritable()
    if (config.backend === 'sync') return await runServiceMode(mode, config.sync.key)
    await saveBarrier()
    const local = await collect(scope, config.secrets), key = await digest(binding(config)), previous = readMeta(key)
    const assertUnchanged = async () => {
      assertConfig(configRaw)
      if ((await collect(scope, config.secrets)).fingerprint !== local.fingerprint) throw new Error('同步期间本机数据有新变化，请重试；新编辑已保留。')
    }
    const remote = createRemote(config)
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await remote.read(); downloadedBytes += read.bytes
      await saveBarrier(); await assertUnchanged()
      protection = config.backend === 'gist' || read.version.kind === 'unprotected' ? 'unprotected' : 'conditional'
      const decoded = read.text === null ? null : await decode(read.text, options.decryptPassphrase ?? config.passphrase, scope, (id, value, deleted) => validateRecord(id, value, deleted, scope))
      const theirs = decoded?.snapshot.records ?? {}
      if (decoded) {validatePolicy(decoded.snapshot); validateAssociations(theirs)}
      let counter = Object.values(theirs).reduce((highest, rec) => Math.max(highest, rec.revision.counter), previous?.counter ?? 0)
      const nextRevision = () => {if (counter >= Number.MAX_SAFE_INTEGER) throw new Error('同步逻辑版本已超出预算。'); return {counter: ++counter, device: config.device}}
      const baseline = !previous || !previous.initialized
      const changedSinceBaseline = new Set<string>()
      const mine: Record<string, SyncRecord> = Object.create(null)
      for (const [id, value] of local.values) {
        const hash = await recordHash({value}), before = previous?.records[id]
        if (previous && (!before || before.deleted || before.hash !== hash)) changedSinceBaseline.add(id)
        mine[id] = {revision: before && !before.deleted && before.hash === hash ? before.revision : previous ? nextRevision() : {counter: 0, device: config.device}, hash, value}
      }
      for (const [id, before] of Object.entries(previous?.records ?? {})) {
        validateRecord(id, undefined, true, scope)
        if (!local.values.has(id) && !local.deferred.has(id)) {
          if (!before.deleted) changedSinceBaseline.add(id)
          mine[id] = before.deleted ? before : {revision: nextRevision(), hash: await recordHash({deleted: true}), deleted: true}
        }
      }
      const out: Record<string, SyncRecord> = Object.create(null), toApply: [string, SyncRecord][] = []
      let pushed = 0
      for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
        const ours = mine[id], other = theirs[id]
        const winner = !ours ? other : !other ? ours : (baseline && !changedSinceBaseline.has(id)) || local.deferred.has(id) ? other : compare(ours, other) >= 0 ? ours : other
        if (!winner) continue
        const clean = winner.deleted ? winner : {...winner, value: project(id, winner.value, scope, config.secrets)}
        clean.hash = await recordHash(clean)
        out[id] = clean
        if (!other || canonical(clean) !== canonical(other)) pushed++
        if (mode === 'full' && !local.deferred.has(id) && (!ours || ours.hash !== clean.hash || Boolean(ours.deleted) !== Boolean(clean.deleted))) toApply.push([id, clean])
      }
      // 远端会话删除不能留下本机/远端孤立轮次；先校验整份合并结果。
      validateAssociations(out)
      const snapshot: Snapshot = {app: 'dada-sync', version: 2, scope, secrets: config.secrets, records: out}
      const representationChanged = !decoded || decoded.encrypted !== Boolean(config.passphrase) || decoded.snapshot.secrets !== config.secrets || options.decryptPassphrase !== undefined
      let createdGistId: string | undefined
      if (pushed || representationChanged) {
        const body = await encode(snapshot, config.passphrase)
        await saveBarrier(); await assertUnchanged(); assertPersistenceWritable()
        // 首次上传前记住采样。PUT 期间新增编辑或进程重启后，下一次不能把刚上传的旧采样当成全新远端基线。
        if (!previous) {
          const staged: Meta = {version: 2, initialized: false, checkpoint: true, binding: key, counter, records: Object.fromEntries(Object.entries(mine).map(([id, rec]) => [id, known(rec)]))}
          await commitStorage({local: {[META_KEY]: JSON.stringify(staged)}, operations: [], validate: assertUnchanged})
        }
        try {const written = await remote.write(body, read.version); uploadedBytes += written.bytes; createdGistId = written.createdGistId} catch (error) {
          if (attempt < 2 && object(error) && error.conflict === true) continue
          throw error
        }
        await saveBarrier(); await assertUnchanged()
      }
      // 仅同一个连接可以接收自动创建的 ID 与基线；原口令不进入设置或元数据。
      assertConfig(configRaw)
      const savedConfig = createdGistId ? {...config, gist: {...config.gist, id: createdGistId}} : config
      const meta: Meta = {version: 2, initialized: mode === 'full' || previous?.initialized === true, binding: await digest(binding(savedConfig)), counter, records: Object.create(null)}
      for (const [id, rec] of Object.entries(mine)) meta.records[id] = known(rec)
      if (mode === 'full') for (const [id, rec] of Object.entries(out)) if (!local.deferred.has(id)) meta.records[id] = known(rec)
      // push 未应用云端记录：保留本机旧基线，后续 full 仍会真正拉取。
      const update = changes(toApply, local, scope, config.secrets)
      update.local[META_KEY] = JSON.stringify(meta)
      if (createdGistId) update.local[CONFIG_KEY] = JSON.stringify(savedConfig)
      await commitStorage({...update, validate: assertUnchanged, onCommitted: () => {
        if (toApply.length) reportPersistenceError('sync-reload', new Error('已拉取新的数据，请重新加载以更新页面。'))
      }})
      const needsReload = Boolean(toApply.length) || Boolean(status.needsReload)
      const result = {pulled: toApply.length, pushed, scope, protection, downloadedBytes, uploadedBytes, needsReload}
      setStatus({phase: 'ok', at: Date.now(), message: toApply.length || pushed ? `拉取 ${toApply.length} 条，上传 ${pushed} 条` : '已是最新', ...result})
      return result
    }
    throw new Error('云端连续发生并发更改，请稍后重试。')
  } catch (error) {
    setStatus({phase: 'error', at: Date.now(), scope, protection, downloadedBytes, uploadedBytes, needsReload: status.needsReload, message: error instanceof Error ? error.message : String(error), ...(object(error) && typeof error.retryAt === 'number' ? {retryAt: error.retryAt} : {})})
    throw error
  }
}
let started = false
export function startAutoSync(): void {
  if (started || typeof window === 'undefined') return
  started = true
  // 自动同步只上传；显式完整同步再由用户选择重新加载，保护正在输入的内容。
  const run = async () => {
    const config = readSyncConfig()
    if (!config.auto || !syncConfigured(config) || syncConfigProblem(config) || !navigator.onLine) return
    if (config.backend !== 'sync' && (await import('./incrementalClient')).incrementalConfigured()) return
    await runSync('push')
  }
  const tick = () => void run().catch(() => undefined)
  window.setTimeout(tick, 1500)
  window.setInterval(tick, 3 * 60_000)
  window.addEventListener('online', tick)
}
export const syncNow = (options: SyncOptions = {}): Promise<SyncResult> => runSync('full', options)

async function runServiceMode(mode: SyncMode, key: string): Promise<SyncResult> {
  const {runServiceSync} = await import('./syncService')
  const result = await runServiceSync(key, mode)
  const message = result.hasMore
    ? `本次同步尚未完成，剩余进度已保存。${result.needsReload ? '请重新加载后继续。' : '请再次同步以继续。'}`
    : result.conflicts ? `有 ${result.conflicts} 处需要选择保留哪一版。` : result.recovered ? `已换回本机原来的同步密钥。${result.pulled || result.pushed ? `拉取 ${result.pulled} 条，上传 ${result.pushed} 条` : '服务器上的数据可以继续读取。'}` : result.pulled || result.pushed ? `拉取 ${result.pulled} 条，上传 ${result.pushed} 条` : mode === 'push' ? '本机没有新的变更。读取服务器上的数据需要手动同步。' : '已是最新'
  setStatus({phase: result.hasMore ? 'error' : 'ok', at: Date.now(), scope: 'full', message, needsReload: result.needsReload})
  return {pulled: result.pulled, pushed: result.pushed, scope: 'full', needsReload: result.needsReload}
}

/** 同一服务的两端改了同一条时，在同步页里选择保留哪一版。 */
export async function resolveServiceConflict(ref: SyncRef, version: SyncConflictVersion, choice: 'local' | 'remote'): Promise<void> {
  const {resolveService} = await import('./syncService')
  const needsReload = await resolveService(readSyncConfig().sync.key, ref, version, choice)
  if (needsReload) setStatus({...status, needsReload: true, message: choice === 'remote' ? '已采用另一端的版本，重新加载后生效。' : '已保留本机版本。'})
}
