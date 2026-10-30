import {db} from '../db'
import {WorkspaceError} from '../errors'
import {cleanLocalThemeFontRef, verifyLocalThemeFontBytes} from '../fontResource'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from '../persistence'
import {assertPackageIdentity} from './boundary'
import {cloneThemePackageImport, assertThemePackageRepositoryBudget, summarizeThemePackage, validateStoredThemePackage} from './codec'
import {packageKey, samePackage, type LocalThemeFontRef, type LocalThemeResourceReader, type PackageIdentity, type StoredThemePackage, type ThemePackageImport, type ThemePackageSummary} from './contracts'
import {getThemePackageRecords, publishThemePackages, isThemePackageChanging, markThemePackageChanging} from './state'

let initialized = false
let opening: Promise<void> | undefined
let tail: Promise<unknown> = Promise.resolve()
export async function initThemePackages(): Promise<void> {
  if (initialized) return
  if (opening) return opening
  const attempt = (async () => {
    const raw = await db.all<unknown>('themePackages')
    const rows: StoredThemePackage[] = []
    for (const item of raw) rows.push(await validateStoredThemePackage(item))
    assertThemePackageRepositoryBudget(rows)
    publishThemePackages(rows)
    initialized = true
    clearPersistenceError('theme-packages-read')
  })()
  opening = attempt
  try {await attempt} catch (error) {
    reportPersistenceError('theme-packages-read', error, initThemePackages)
    throw error
  } finally {if (opening === attempt) opening = undefined}
}
export async function flushThemePackages(): Promise<void> {await tail}
const expectedRejection = (error: unknown): boolean => error instanceof WorkspaceError || error instanceof Error && error.name === 'AbortError'
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  assertPersistenceWritable()
  const next = tail.catch(() => undefined).then(async () => {
    assertPersistenceWritable()
    await initThemePackages()
    try {const result = await work(); clearPersistenceError('theme-packages-write'); return result}
    catch (error) {if (!expectedRejection(error)) reportPersistenceError('theme-packages-write', error, undefined, false); throw error}
  })
  tail = next.catch(error => {if (!expectedRejection(error)) throw error})
  void tail.catch(() => undefined)
  void next.catch(() => undefined)
  return next
}
export function listThemePackages(): readonly ThemePackageSummary[] {return getThemePackageRecords().map(summarizeThemePackage)}
export function requireInstalledThemePackage(identity: PackageIdentity): StoredThemePackage {
  assertPackageIdentity(identity)
  const row = getThemePackageRecords().find(item => samePackage(item.manifest, identity))
  if (!row) throw new WorkspaceError('此设备未安装精确版本和摘要的主题包')
  return row
}
export async function installThemePackage(input: ThemePackageImport): Promise<ThemePackageSummary> {
  // await之前复制，确认弹窗持有者随后修改原对象不能改变实际安装内容。
  const detached = cloneThemePackageImport(input)
  return enqueue(async () => {
    const row = await validateStoredThemePackage({...detached, k: packageKey(detached.manifest), enabled: false, generation: 1, installedAt: Date.now(), state: detached.unsupportedEnvelope ? 'unsupported' : 'installed'})
    const result = await db.atomic(['themePackages'], [{store: 'themePackages', all: true}], values => {
      const rows = values[0] as StoredThemePackage[]
      const existing = rows.find(item => item.k === row.k)
      if (existing) {
        if (!samePackage(existing.manifest, row.manifest)) throw new WorkspaceError('同一主题包 ID/版本已有不同摘要；不能覆盖不可变版本')
        return {operations: [], result: existing}
      }
      assertThemePackageRepositoryBudget([...rows, row])
      return {operations: [{store: 'themePackages', type: 'put', value: row}], result: row}
    })
    if (!getThemePackageRecords().some(item => item.k === result.k)) publishThemePackages([...getThemePackageRecords(), result])
    return summarizeThemePackage(result)
  })
}
export async function updateThemePackageEnabled(identity: PackageIdentity, enabled: boolean, expectedGeneration: number, beforeCommit: () => void = () => {}): Promise<void> {
  await enqueue(async () => {
    beforeCommit()
    const current = requireInstalledThemePackage(identity)
    if (current.generation !== expectedGeneration) throw new WorkspaceError('主题包状态在准备期间已变化，请重试')
    const next = {...current, enabled, generation: current.generation + 1}
    markThemePackageChanging(identity, true)
    try {await db.atomic(['themePackages'], [{store: 'themePackages', key: current.k}], values => {
      beforeCommit()
      const row = values[0] as StoredThemePackage | undefined
      if (!row || !samePackage(row.manifest, identity) || row.generation !== expectedGeneration) throw new WorkspaceError('主题包本机版本已变化')
      return {operations: [{store: 'themePackages', type: 'put', value: next}], result: undefined}
    })
    publishThemePackages(getThemePackageRecords().map(item => item.k === next.k ? next : item))
    } finally {markThemePackageChanging(identity, false)}
  })
}
export async function removeThemePackage(identity: PackageIdentity, expectedGeneration: number, assertUnused: () => void): Promise<void> {
  await enqueue(async () => {
    assertUnused()
    const current = requireInstalledThemePackage(identity)
    if (current.generation !== expectedGeneration) throw new WorkspaceError('主题包状态已变化，请重新卸载')
    markThemePackageChanging(identity, true)
    try {await db.atomic(['themePackages'], [{store: 'themePackages', key: current.k}], values => {
      const row = values[0] as StoredThemePackage | undefined
      if (!row || !samePackage(row.manifest, identity) || row.generation !== expectedGeneration) throw new WorkspaceError('主题包本机版本已变化')
      assertUnused()
      return {operations: [{store: 'themePackages', type: 'delete', key: current.k}], result: undefined}
    })
    publishThemePackages(getThemePackageRecords().filter(item => item.k !== current.k))
    } finally {markThemePackageChanging(identity, false)}
  })
}
/** 只读已启用的精确资源；返回独立副本，调用者transfer不会使仓库缓存失效。 */
export async function readLocalThemeFont(raw: LocalThemeFontRef, signal?: AbortSignal): Promise<ArrayBuffer> {
  const ref = cleanLocalThemeFontRef(raw)
  if (signal?.aborted) throw new DOMException('字体读取已停止', 'AbortError')
  await initThemePackages()
  const row = requireInstalledThemePackage(ref)
  if (!row.enabled || row.state !== 'installed' || isThemePackageChanging(ref)) throw new WorkspaceError('本地字体包未启用')
  const generation = row.generation
  const bytes = await resourceReaderFor(row)(ref, signal)
  const latest = requireInstalledThemePackage(ref)
  if (!latest.enabled || latest.generation !== generation || isThemePackageChanging(ref)) throw new WorkspaceError('本地字体包在读取期间已变化')
  return bytes
}
/** 仅供一次显式启用预备；闭包只能读取刚校验的这一精确包。 */
export function resourceReaderFor(row: StoredThemePackage): LocalThemeResourceReader {
  return async (raw, signal) => {
    const ref = cleanLocalThemeFontRef(raw)
    if (!samePackage(row.manifest, ref)) throw new WorkspaceError('资源预备不能读取其他主题包')
    const descriptor = row.manifest.resources.find(item => item.id === ref.resourceId && item.sha256 === ref.sha256)
    const stored = row.resources.find(item => item.id === ref.resourceId)
    if (!descriptor || !stored) throw new WorkspaceError('主题包未声明该精确字体')
    const copy = stored.bytes.slice(0)
    await verifyLocalThemeFontBytes(ref, copy, signal)
    if (copy.byteLength !== descriptor.bytes) throw new WorkspaceError('本地字体长度不匹配')
    return copy
  }
}
