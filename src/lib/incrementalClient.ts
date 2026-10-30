import {createSyncClient, type Device} from '@tulai-design/sync-sdk'
import {createKeyring, unwrapKeyring, wrapKeyring, type Keyring} from '@tulai-design/sync-sdk/crypto'
import {useSyncExternalStore} from 'react'
import {createIncrementalSyncController} from './incrementalSync'
import {SYNC_COLLECTIONS, type JsonValue, type SyncCollection, type SyncConflictVersion, type SyncRef} from './incrementalRows'
import {incrementalStore} from './incrementalStore'
import {getPersistenceStatus} from './persistence'
import {prepareExtensionRequest} from './platform'

/**
 * 自建增量同步在设置页的运行时：连接信息、状态、自动调度、设备配对与冲突。
 * 访问令牌与同步空间密钥只存在本机（与快照同步的口令一样），不进入备份之外的任何同步通道。
 */
export type IncrementalConfig = {
  endpoint: string; appId: string; spaceId: string; deviceId: string; token: string
  keyring: Keyring | null; collections: SyncCollection[]; auto: boolean
}
export type IncrementalStatus = {
  phase: 'idle' | 'syncing' | 'ok' | 'error'; message?: string; at?: number
  pushed?: number; pulled?: number; conflicts?: number; needsReload?: boolean; hasMore?: boolean
}
export type ConflictItem = {ref: SyncRef; version: SyncConflictVersion; remoteReady: boolean; remoteValue?: JsonValue | null}
export type PairingInvite = {format: 'dada-sync-invite'; version: 1; endpoint: string; appId: string; spaceId: string; pairingToken: string; deviceId: string; keyring: unknown}

const KEY = 'dada-incremental-config'
export const COLLECTION_LABELS: Record<SyncCollection, string> = {
  config: '配置与偏好', component: '组件数据', applicationData: '应用业务数据', conversation: '聊天会话', turn: '聊天内容与工具明细',
}

const randomId = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
export const defaultIncrementalConfig = (): IncrementalConfig => ({
  endpoint: '', appId: 'dada', spaceId: 'personal', deviceId: randomId('web'), token: '', keyring: null, collections: [...SYNC_COLLECTIONS], auto: false,
})

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener)}}
function normalize(raw: unknown): IncrementalConfig {
  const base = defaultIncrementalConfig()
  if (!raw || typeof raw !== 'object') return base
  const item = raw as Partial<IncrementalConfig>
  const text = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback
  const collections = Array.isArray(item.collections) ? SYNC_COLLECTIONS.filter(name => item.collections!.includes(name)) : base.collections
  return {
    endpoint: text(item.endpoint, ''), appId: text(item.appId, base.appId), spaceId: text(item.spaceId, base.spaceId), deviceId: text(item.deviceId, base.deviceId),
    token: text(item.token, ''), keyring: item.keyring && typeof item.keyring === 'object' ? item.keyring as Keyring : null, collections, auto: item.auto === true,
  }
}
export function readIncrementalConfig(): IncrementalConfig {
  try {return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'))} catch {return defaultIncrementalConfig()}
}
export function writeIncrementalConfig(config: IncrementalConfig): void {
  localStorage.setItem(KEY, JSON.stringify(normalize(config)))
  emit()
}
export const useIncrementalConfigVersion = () => useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) ?? '')
export function incrementalConfigProblem(config: IncrementalConfig): string {
  if (!config.endpoint.trim()) return '请先填写服务地址。'
  try {const url = new URL(config.endpoint); if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '服务地址需要使用 https（本机调试除外）。'} catch {return '服务地址格式不正确。'}
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.appId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.spaceId)) return '应用标识与空间标识只能包含字母、数字、点、下划线和连字符。'
  if (!config.token.trim()) return '请填写访问令牌，或用配对邀请加入。'
  if (!config.keyring) return '还没有同步空间密钥：新建一个，或用配对邀请加入已有空间。'
  if (!config.collections.length) return '请至少选择一类同步内容。'
  return ''
}
export const incrementalConfigured = (config = readIncrementalConfig()) => !incrementalConfigProblem(config)

let status: IncrementalStatus = {phase: 'idle'}
const setStatus = (next: IncrementalStatus) => {status = next; emit()}
export const useIncrementalStatus = () => useSyncExternalStore(subscribe, () => status)

/**
 * 浏览器 fetch 会自动解压响应，但反向代理（Coolify 的 Traefik/Caddy 等）压缩后写的 Content-Length 是压缩后的大小，
 * SDK 严格比对「响应头长度 = 读到的字节数」，会把这种正常响应判成 invalid_response。
 * 这里读出已解压的正文，去掉失真的长度头再交给 SDK；正文大小仍由 SDK 按实际读到的字节数限制。
 */
const NO_BODY = new Set([101, 204, 205, 304])
export const incrementalFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (NO_BODY.has(res.status) || res.body === null) return res
  const headers = new Headers(res.headers)
  headers.delete('content-length'); headers.delete('content-encoding')
  return new Response(await res.arrayBuffer(), {status: res.status, statusText: res.statusText, headers})
}

const controllerFor = (config: IncrementalConfig) => {
  const problem = incrementalConfigProblem(config)
  if (problem) throw new Error(problem)
  return createIncrementalSyncController({
    endpoint: config.endpoint.trim(), appId: config.appId, spaceId: config.spaceId, deviceId: config.deviceId, token: config.token.trim(),
    keyring: config.keyring!, collections: config.collections, fetchImpl: incrementalFetch,
  })
}
const clientFor = (config: Pick<IncrementalConfig, 'endpoint' | 'appId' | 'spaceId' | 'token'>) =>
  createSyncClient({baseUrl: config.endpoint.trim(), appId: config.appId, spaceId: config.spaceId, token: config.token.trim(), retries: 1, timeoutMs: 15000, fetchImpl: incrementalFetch})
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/** 只读预检：确认服务可达、令牌有效、协议能力齐全；不上传也不应用任何数据。 */
export async function preflight(config: IncrementalConfig): Promise<string> {
  if (!config.endpoint.trim() || !config.token.trim()) throw new Error('请先填写服务地址和访问令牌。')
  await prepareExtensionRequest(config.endpoint.trim())
  const capabilities = await clientFor(config).capabilities()
  const missing = (['records', 'atomicBatch', 'idempotency', 'changeLog', 'objects'] as const).filter(name => !capabilities[name])
  if (missing.length) throw new Error(`目标服务缺少所需能力：${missing.join('、')}。`)
  return `连接正常${capabilities.encryption ? '，服务支持客户端加密' : ''}。`
}

/** 服务器上这个空间是否已有数据。已有数据说明密钥在别的设备上，新建一把只会读不了。 */
export async function serverHasData(config: IncrementalConfig): Promise<boolean> {
  await prepareExtensionRequest(config.endpoint.trim())
  const page = await clientFor(config).changes({limit: 1})
  return page.commits.length > 0 || page.hasMore
}

/** 新建空间密钥：服务器已有数据、或无法确认时一律拒绝，避免生成一把读不了现有数据的密钥。 */
export async function createSpaceKeyring(config: IncrementalConfig): Promise<Keyring> {
  let has: boolean
  try {has = await serverHasData(config)} catch (error) {throw new Error(`无法确认服务器上是否已有数据，没有新建密钥：${messageOf(error)}`)}
  if (has) throw new Error('服务器上这个空间已有数据，请用另一台设备生成的邀请加入，而不是新建密钥。')
  return createKeyring({appId: config.appId, spaceId: config.spaceId})
}

/** 绑定当前设备到这个空间：之后的本机修改才会进入待同步队列。 */
export async function bindIncremental(config = readIncrementalConfig()): Promise<void> {
  const controller = controllerFor(config)
  try {await controller.bind()} finally {controller.close()}
}
export async function isBound(): Promise<boolean> {return Boolean(await incrementalStore.active())}

let running: Promise<IncrementalStatus> | undefined
/** 先排空上传，再在一次门禁内拉取；有界预算耗尽必须显示未完成，不能谎报成功。 */
export function runIncremental(options: {pull: boolean} = {pull: true}): Promise<IncrementalStatus> {
  if (running) return running
  running = (async () => {
    const config = readIncrementalConfig()
    setStatus({...status, phase: 'syncing', message: undefined})
    const controller = (() => {try {return controllerFor(config)} catch (error) {setStatus({...status, phase: 'error', message: messageOf(error)}); return undefined}})()
    if (!controller) return status
    const total = {pushed: 0, pulled: 0, conflicts: 0, needsReload: false, hasMore: false}
    const add = (result: Awaited<ReturnType<typeof controller.run>>) => {
      total.pushed += result.pushed; total.pulled += result.pulled; total.conflicts += result.conflicts
      total.needsReload ||= result.needsReload; total.hasMore = result.hasMore
    }
    try {
      // 授权等待不计入 SDK 的网络超时，也不占用同步保存锁。
      await prepareExtensionRequest(config.endpoint.trim())
      // 上传阶段没有远端应用，允许分批继续；避免第一页入站后再次采样旧内存。
      for (let round = 0; round < 100; round++) {
        add(await controller.run({pull: false, maxPush: 100}))
        if (!total.hasMore || total.needsReload) break
      }
      if (!total.hasMore && !total.needsReload && options.pull) add(await controller.run({maxPush: 0, maxPull: 10000}))
      const open = (await controller.inspect()).records.filter(record => record.conflict).length
      const message = total.hasMore
        ? `本次同步尚未完成，剩余进度已保存。${total.needsReload ? '请重新加载后继续同步。' : '请再次同步以继续。'}`
        : open ? `有 ${open} 处冲突等待选择。` : undefined
      setStatus({phase: total.hasMore ? 'error' : 'ok', at: Date.now(), ...total, conflicts: open, message})
    } catch (error) {
      // controller 可能已提交前几页后才遇到网络或落盘错误，异常没有正常 result。
      const needsReload = total.needsReload || getPersistenceStatus().errors.some(item => item.source === 'sync-reload')
      setStatus({phase: 'error', at: Date.now(), ...total, message: messageOf(error), needsReload})
    } finally {controller.close()}
    return status
  })().finally(() => {running = undefined})
  return running
}

export async function listConflicts(config = readIncrementalConfig()): Promise<ConflictItem[]> {
  const controller = controllerFor(config)
  try {
    return (await controller.inspect()).records.filter(record => record.conflict && record.conflict.remoteRevision !== null).map(record => ({
      ref: {collection: record.collection, key: record.key},
      version: {localGeneration: record.conflict!.localGeneration, remoteRevision: record.conflict!.remoteRevision!},
      remoteReady: record.conflict!.remoteReady, remoteValue: record.conflict!.remoteValue,
    }))
  } finally {controller.close()}
}
export async function resolveConflict(item: ConflictItem, choice: 'local' | 'remote'): Promise<boolean> {
  const controller = controllerFor(readIncrementalConfig())
  try {
    const result = await controller.resolve(item.ref, item.version, choice)
    if (result.needsReload) setStatus({...status, needsReload: true})
    return result.needsReload
  } catch (error) {
    if (getPersistenceStatus().errors.some(item => item.source === 'sync-reload')) setStatus({...status, needsReload: true})
    throw error
  } finally {controller.close()}
}

/** 范围改动：新开启的集合需要从头核对远端，补上关闭期间被跳过的记录。 */
export async function applyCollections(next: SyncCollection[]): Promise<void> {
  const before = readIncrementalConfig()
  const added = next.filter(name => !before.collections.includes(name))
  writeIncrementalConfig({...before, collections: next})
  if (added.length && await isBound()) {
    const controller = controllerFor({...before, collections: next})
    try {await controller.rewind()} finally {controller.close()}
  }
}

/** 解绑只清除本机同步状态，不删除任何本地或远端数据。 */
export async function detachIncremental(): Promise<void> {
  const controller = controllerFor(readIncrementalConfig())
  try {await controller.detach()} finally {controller.close()}
  setStatus({phase: 'idle'})
}

export async function listDevices(config = readIncrementalConfig()): Promise<Device[]> {
  await prepareExtensionRequest(config.endpoint.trim())
  return (await clientFor(config).devices()).devices
}
export async function revokeDevice(deviceId: string, config = readIncrementalConfig()): Promise<void> {
  await prepareExtensionRequest(config.endpoint.trim())
  await clientFor(config).revoke(deviceId)
}

/** 服务允许的设备期限上限（一年）；null 表示设备长期有效。配对码本身另有服务端固定的短期限。 */
const MAX_DEVICE_TERM_MS = 366 * 86_400_000

/** 在已配置的设备上生成邀请：一次性配对码，加上用口令包装的空间密钥。expiresAt 是新设备的使用期限（Unix 毫秒），null 为长期有效。 */
export async function createInvite(passphrase: string, deviceId: string, expiresAt: number | null, config = readIncrementalConfig()): Promise<string> {
  if (!config.keyring) throw new Error('当前设备还没有同步空间密钥。')
  if (passphrase.length < 8) throw new Error('邀请口令至少 8 个字符，用于加密传递空间密钥。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deviceId)) throw new Error('设备标识只能包含字母、数字、点、下划线和连字符。')
  if (expiresAt !== null && !(expiresAt > Date.now() && expiresAt <= Date.now() + MAX_DEVICE_TERM_MS)) throw new Error('设备到期时间必须在未来，且最长一年；需要更久请选择长期有效。')
  await prepareExtensionRequest(config.endpoint.trim())
  const pairing = await clientFor(config).pair({deviceId, scopes: [{appId: config.appId, spaceId: config.spaceId}], expiresAt})
  const invite: PairingInvite = {
    format: 'dada-sync-invite', version: 1, endpoint: config.endpoint.trim(), appId: config.appId, spaceId: config.spaceId,
    pairingToken: pairing.pairingToken, deviceId, keyring: await wrapKeyring(config.keyring, passphrase),
  }
  return JSON.stringify(invite)
}

/** 在新设备上接受邀请：自己生成随机访问令牌，兑换后保存配置；口令错误时不会兑换。 */
export async function acceptInvite(text: string, passphrase: string): Promise<IncrementalConfig> {
  let invite: PairingInvite
  try {invite = JSON.parse(text) as PairingInvite} catch {throw new Error('邀请内容不是有效的 JSON。')}
  if (invite?.format !== 'dada-sync-invite' || invite.version !== 1 || typeof invite.pairingToken !== 'string' || typeof invite.endpoint !== 'string') throw new Error('这不是搭搭的同步邀请。')
  const keyring = await unwrapKeyring(invite.keyring, passphrase, {appId: invite.appId, spaceId: invite.spaceId})
  await prepareExtensionRequest(invite.endpoint.trim())
  const bytes = crypto.getRandomValues(new Uint8Array(32)), token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  await clientFor({endpoint: invite.endpoint, appId: invite.appId, spaceId: invite.spaceId, token}).redeem({pairingToken: invite.pairingToken, token})
  const config: IncrementalConfig = {...readIncrementalConfig(), endpoint: invite.endpoint, appId: invite.appId, spaceId: invite.spaceId, deviceId: invite.deviceId, token, keyring}
  writeIncrementalConfig(config)
  return config
}

let started = false
/** 启动、恢复联网和定时检查时只上传本机变更；拉取由用户在设置页手动触发。 */
export function startIncrementalAuto(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const run = async () => {
    const config = readIncrementalConfig()
    if (!config.auto || !incrementalConfigured(config) || !navigator.onLine || !await isBound().catch(() => false)) return
    await runIncremental({pull: false})
  }
  window.setTimeout(() => void run(), 2500)
  window.setInterval(() => void run(), 60_000)
  window.addEventListener('online', () => void run())
}
