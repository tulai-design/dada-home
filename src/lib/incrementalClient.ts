import {createSyncClient, type Device} from '@tulai-design/sync-sdk'
import {createKeyring, unwrapKeyring, wrapKeyring, type Keyring} from '@tulai-design/sync-sdk/crypto'
import {useSyncExternalStore} from 'react'
import {createIncrementalSyncController} from './incrementalSync'
import {SYNC_COLLECTIONS, type JsonValue, type SyncCollection, type SyncConflictVersion, type SyncRef} from './incrementalRows'
import {incrementalStore} from './incrementalStore'

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
  pushed?: number; pulled?: number; conflicts?: number; needsReload?: boolean
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

const controllerFor = (config: IncrementalConfig) => {
  const problem = incrementalConfigProblem(config)
  if (problem) throw new Error(problem)
  return createIncrementalSyncController({
    endpoint: config.endpoint.trim(), appId: config.appId, spaceId: config.spaceId, deviceId: config.deviceId, token: config.token.trim(),
    keyring: config.keyring!, collections: config.collections,
  })
}
const clientFor = (config: Pick<IncrementalConfig, 'endpoint' | 'appId' | 'spaceId' | 'token'>) =>
  createSyncClient({baseUrl: config.endpoint.trim(), appId: config.appId, spaceId: config.spaceId, token: config.token.trim(), retries: 1, timeoutMs: 15000})
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/** 只读预检：确认服务可达、令牌有效、协议能力齐全；不上传也不应用任何数据。 */
export async function preflight(config: IncrementalConfig): Promise<string> {
  if (!config.endpoint.trim() || !config.token.trim()) throw new Error('请先填写服务地址和访问令牌。')
  const capabilities = await clientFor(config).capabilities()
  const missing = (['records', 'atomicBatch', 'idempotency', 'changeLog', 'objects'] as const).filter(name => !capabilities[name])
  if (missing.length) throw new Error(`目标服务缺少所需能力：${missing.join('、')}。`)
  return `连接正常${capabilities.encryption ? '，服务支持客户端加密' : ''}。`
}

export function createSpaceKeyring(config: IncrementalConfig): Keyring {return createKeyring({appId: config.appId, spaceId: config.spaceId})}

/** 绑定当前设备到这个空间：之后的本机修改才会进入待同步队列。 */
export async function bindIncremental(config = readIncrementalConfig()): Promise<void> {
  const controller = controllerFor(config)
  try {await controller.bind()} finally {controller.close()}
}
export async function isBound(): Promise<boolean> {return Boolean(await incrementalStore.active())}

let running: Promise<IncrementalStatus> | undefined
/** 同步直到队列清空；auto 只上传，手动同步同时拉取。拉取后需要重新加载才能继续编辑。 */
export function runIncremental(options: {pull: boolean} = {pull: true}): Promise<IncrementalStatus> {
  if (running) return running
  running = (async () => {
    const config = readIncrementalConfig()
    setStatus({...status, phase: 'syncing', message: undefined})
    const controller = (() => {try {return controllerFor(config)} catch (error) {setStatus({phase: 'error', message: messageOf(error)}); return undefined}})()
    if (!controller) return status
    const total = {pushed: 0, pulled: 0, conflicts: 0, needsReload: false}
    try {
      for (let round = 0; round < 50; round++) {
        const result = await controller.run({pull: options.pull})
        total.pushed += result.pushed; total.pulled += result.pulled; total.conflicts += result.conflicts; total.needsReload ||= result.needsReload
        if (!result.hasMore) break
      }
      const open = (await controller.inspect()).records.filter(record => record.conflict).length
      setStatus({phase: 'ok', at: Date.now(), ...total, conflicts: open, message: open ? `有 ${open} 处冲突等待选择。` : undefined})
    } catch (error) {
      setStatus({phase: 'error', at: Date.now(), message: messageOf(error), needsReload: total.needsReload})
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

export const listDevices = (config = readIncrementalConfig()): Promise<Device[]> => clientFor(config).devices().then(result => result.devices)
export const revokeDevice = (deviceId: string, config = readIncrementalConfig()) => clientFor(config).revoke(deviceId).then(() => undefined)

/** 服务允许的设备期限上限（一年）；null 表示设备长期有效。配对码本身另有服务端固定的短期限。 */
const MAX_DEVICE_TERM_MS = 366 * 86_400_000

/** 在已配置的设备上生成邀请：一次性配对码，加上用口令包装的空间密钥。expiresAt 是新设备的使用期限（Unix 毫秒），null 为长期有效。 */
export async function createInvite(passphrase: string, deviceId: string, expiresAt: number | null, config = readIncrementalConfig()): Promise<string> {
  if (!config.keyring) throw new Error('当前设备还没有同步空间密钥。')
  if (passphrase.length < 8) throw new Error('邀请口令至少 8 个字符，用于加密传递空间密钥。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deviceId)) throw new Error('设备标识只能包含字母、数字、点、下划线和连字符。')
  if (expiresAt !== null && !(expiresAt > Date.now() && expiresAt <= Date.now() + MAX_DEVICE_TERM_MS)) throw new Error('设备到期时间必须在未来，且最长一年；需要更久请选择长期有效。')
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
