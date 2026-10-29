import {createSyncClient} from '@tulai-design/sync-sdk'
import {createIncrementalSyncController} from './incrementalSync'
import {incrementalFetch} from './incrementalClient'
import {incrementalStore} from './incrementalStore'
import type {JsonValue, SyncConflictVersion, SyncRef} from './incrementalRows'
import {encodeSyncKey, parseSyncKey, syncKeyFromLegacyConfig, type SyncKeyMaterial} from './syncKey'

export type ServiceConflict = {ref: SyncRef; version: SyncConflictVersion; remoteReady: boolean; remoteValue?: JsonValue | null}
export type ServiceSyncResult = {pushed: number; pulled: number; conflicts: number; hasMore: boolean; needsReload: boolean; recovered?: boolean}

const bindingDiffers = (error: unknown) => error instanceof Error && error.message.includes('已有不同的增量同步绑定')

function controllerFor(material: SyncKeyMaterial) {
  return createIncrementalSyncController({
    endpoint: material.endpoint, appId: material.appId, spaceId: material.spaceId, deviceId: material.deviceId, token: material.token, keyring: material.keyring, fetchImpl: incrementalFetch,
  })
}

/** 同一把密钥重复绑定是空操作。换成另一把密钥时卸下旧绑定，不留下两套队列。 */
async function openBound(material: SyncKeyMaterial) {
  const connect = () => controllerFor(material)
  let controller = connect()
  try {
    await controller.bind()
    return controller
  } catch (error) {
    controller.close()
    if (!bindingDiffers(error)) throw error
    const active = await incrementalStore.active()
    if (active) await incrementalStore.detach(active.epoch)
    controller = connect()
    try {
      await controller.bind()
      return controller
    } catch (again) {
      controller.close()
      throw again
    }
  }
}

/** 只确认服务认这把密钥，不上传、不绑定。 */
export async function testServiceConnection(key: string): Promise<string> {
  const material = parseSyncKey(key)
  const client = createSyncClient({baseUrl: material.endpoint, appId: material.appId, spaceId: material.spaceId, token: material.token, retries: 1, timeoutMs: 15000, fetchImpl: incrementalFetch})
  const capabilities = await client.capabilities()
  const missing = (['records', 'atomicBatch', 'idempotency', 'changeLog', 'objects'] as const).filter(name => !capabilities[name])
  if (missing.length) throw new Error('这台同步服务还不能完成同步。')
  return '连接正常。这把密钥可以同步。'
}

const CONFIG_KEY = 'fp.sync.config'
const LEGACY_KEY = 'dada-incremental-config'
const wantedKeyId = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const match = /由密钥 (\S+) 加密/.exec(message)
  return match?.[1] ?? null
}
function rememberSyncKey(encoded: string) {
  let saved: unknown
  try {saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null')} catch {return}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
  localStorage.setItem(CONFIG_KEY, JSON.stringify({...saved, backend: 'sync', sync: {key: encoded}}))
}
/** 新生成的密钥读不了服务器上已有的记录时，改用本机旧设置里那把对得上的空间密钥。 */
function legacyMaterial(current: SyncKeyMaterial, error: unknown): SyncKeyMaterial | null {
  const wanted = wantedKeyId(error)
  if (!wanted || typeof localStorage === 'undefined') return null
  let raw: unknown
  try {raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null')} catch {return null}
  const key = syncKeyFromLegacyConfig(raw, wanted, current)
  if (!key) return null
  try {return parseSyncKey(key)} catch {return null}
}

/** 与其他同步方式一样：自动只上传，手动再拉取。 */
async function runServiceOnce(material: SyncKeyMaterial, mode: 'full' | 'push'): Promise<ServiceSyncResult> {
  const controller = await openBound(material)
  const total: ServiceSyncResult = {pushed: 0, pulled: 0, conflicts: 0, hasMore: false, needsReload: false}
  try {
    for (let round = 0; round < 100; round += 1) {
      const result = await controller.run({pull: false, maxPush: 100})
      total.pushed += result.pushed
      total.pulled += result.pulled
      total.needsReload ||= result.needsReload
      total.hasMore = result.hasMore
      if (!total.hasMore || total.needsReload) break
    }
    if (!total.hasMore && !total.needsReload && mode === 'full') {
      const result = await controller.run({maxPush: 0, maxPull: 10000})
      total.pushed += result.pushed
      total.pulled += result.pulled
      total.needsReload ||= result.needsReload
      total.hasMore = result.hasMore
    }
    total.conflicts = (await controller.inspect()).records.filter(record => record.conflict).length
    return total
  } finally {
    controller.close()
  }
}

export async function runServiceSync(key: string, mode: 'full' | 'push'): Promise<ServiceSyncResult> {
  const material = parseSyncKey(key)
  try {
    return await runServiceOnce(material, mode)
  } catch (error) {
    const legacy = legacyMaterial(material, error)
    if (!legacy) throw error
    rememberSyncKey(encodeSyncKey(legacy))
    try {
      return {...await runServiceOnce(legacy, mode), recovered: true}
    } catch (again) {
      rememberSyncKey(key)
      throw again
    }
  }
}

export async function serviceConflicts(key: string): Promise<ServiceConflict[]> {
  let material: SyncKeyMaterial
  try {material = parseSyncKey(key)} catch {return []}
  if (!await incrementalStore.active()) return []
  const controller = controllerFor(material)
  try {
    return (await controller.inspect()).records.filter(record => record.conflict && record.conflict.remoteRevision !== null).map(record => ({
      ref: {collection: record.collection, key: record.key},
      version: {localGeneration: record.conflict!.localGeneration, remoteRevision: record.conflict!.remoteRevision!},
      remoteReady: record.conflict!.remoteReady,
      remoteValue: record.conflict!.remoteValue,
    }))
  } catch {
    return []
  } finally {
    controller.close()
  }
}

export async function resolveService(key: string, ref: SyncRef, version: SyncConflictVersion, choice: 'local' | 'remote'): Promise<boolean> {
  const controller = await openBound(parseSyncKey(key))
  try {
    return (await controller.resolve(ref, version, choice)).needsReload
  } finally {
    controller.close()
  }
}
