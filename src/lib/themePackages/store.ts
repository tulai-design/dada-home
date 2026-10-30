import {isThemePackageChanging, getThemeDependencyGeneration, getTransientThemePackageDependents} from './state'
import {WorkspaceError} from '../errors'
import {assertThemeEntry} from '../themes'
import {getWorkspace, commit, subscribeWorkspace} from '../workspaceStore'
import type {ThemeEntry, Workspace} from '../workspace'
import {canonicalJson, assertPackageIdentity} from './boundary'
import {hydrateThemePackage, serializeThemePackage, themePackageCompatible, themePackageDigest} from './codec'
import {samePackage, type PackageIdentity, type ThemePackageDependent, type ThemePackageRuntime, type ThemePackagePreparation, type ThemePackageManifest} from './contracts'
import {initThemePackages, requireInstalledThemePackage, resourceReaderFor, updateThemePackageEnabled, removeThemePackage, readLocalThemeFont} from './repository'

let runtime: ThemePackageRuntime | undefined
let selection = 0
let selected: string | undefined
let tracking = false
function trackSelection() {
  if (tracking) return
  tracking = true; selected = getWorkspace().theme.active
  subscribeWorkspace(() => {const next = getWorkspace().theme.active; if (next !== selected) {selected = next; selection += 1}})
}
export function registerThemePackageRuntime(next: ThemePackageRuntime): () => void {
  runtime = next
  return () => {if (runtime === next) runtime = undefined}
}
function aborted(signal?: AbortSignal) {if (signal?.aborted) throw new DOMException('主题包操作已停止', 'AbortError')}
function releaseLater(preparations: ThemePackagePreparation[]) {
  let released = false, first = 0, second = 0
  const finish = () => {if (released) return; released = true; clearTimeout(timer); if (typeof cancelAnimationFrame === 'function') {cancelAnimationFrame(first); cancelAnimationFrame(second)}; preparations.forEach(item => item.release?.())}
  const timer = setTimeout(finish, 500)
  if (typeof requestAnimationFrame === 'function') first = requestAnimationFrame(() => {second = requestAnimationFrame(finish)})
  else queueMicrotask(finish)
}
export async function setThemePackageEnabled(identity: PackageIdentity, enabled: boolean, options: {signal?: AbortSignal} = {}): Promise<void> {
  assertPackageIdentity(identity)
  if (typeof enabled !== 'boolean') throw new WorkspaceError('enabled必须是布尔值')
  aborted(options.signal)
  await initThemePackages()
  aborted(options.signal)
  const row = requireInstalledThemePackage(identity)
  const assertCurrentInstallation = () => {
    aborted(options.signal)
    // 安装记录发布后不可变；同版本卸载重装会生成新记录，即使 generation 又从 1 开始。
    if (requireInstalledThemePackage(identity) !== row) throw new WorkspaceError('主题包安装或状态在准备期间已变化，请重试')
  }
  if (row.enabled === enabled) return
  if (!enabled) {await updateThemePackageEnabled(identity, false, row.generation, assertCurrentInstallation); return}
  if (!themePackageCompatible(row)) throw new WorkspaceError('主题包类型、数据或renderer合同不受支持，未启用')
  const host = runtime
  if (!host) throw new WorkspaceError('主题包资源宿主尚未就绪')
  const prepared: ThemePackagePreparation[] = []
  let success = false
  try {
    for (const contribution of row.manifest.contributions) {
      const theme = hydrateThemePackage(row.manifest, contribution.id, `package-${contribution.id}`)
      const result = await host.prepare(theme, {signal: options.signal, localResources: resourceReaderFor(row)})
      prepared.push(result)
      aborted(options.signal)
      if (!result.ready) throw new WorkspaceError(result.reason || '主题包字体准备失败，未启用')
    }
    if (runtime !== host) throw new WorkspaceError('资源宿主在准备期间已变化')
    aborted(options.signal)
    await updateThemePackageEnabled(identity, true, row.generation, assertCurrentInstallation)
    success = true
  } finally {if (success) releaseLater(prepared); else prepared.forEach(item => item.release?.())}
}
function depends(theme: ThemeEntry, identity: PackageIdentity): boolean {
  return !!theme.packageRef && samePackage(theme.packageRef, identity) || !!theme.fonts?.some(font => font.resource && samePackage(font.resource, identity))
}
export function getThemePackageDependents(identity: PackageIdentity, workspace: Workspace = getWorkspace()): ThemePackageDependent[] {
  assertPackageIdentity(identity)
  return [...workspace.themes.filter(theme => depends(theme, identity)).map(theme => ({kind: 'theme' as const, id: theme.id, name: theme.name})),
    ...workspace.templates.filter(template => template.snapshot.theme && depends(template.snapshot.theme, identity)).map(template => ({kind: 'template' as const, id: template.id, name: template.name})), ...getTransientThemePackageDependents(identity)]
}
export async function uninstallThemePackage(identity: PackageIdentity): Promise<void> {
  await initThemePackages()
  const row = requireInstalledThemePackage(identity)
  const assertUnused = () => {const refs = getThemePackageDependents(identity); if (refs.length) throw new WorkspaceError(`主题包仍被引用：${refs.map(item => `${item.kind === 'theme' ? '主题' : item.kind === 'template' ? '模板' : '草稿'}「${item.name}」`).join('、')}。请先移除这些依赖，再卸载。`)}
  assertUnused()
  await removeThemePackage(identity, row.generation, assertUnused)
}
export async function activateThemePackage(identity: PackageIdentity, themeId: string, options: {signal?: AbortSignal} = {}): Promise<ThemeEntry> {
  assertPackageIdentity(identity); aborted(options.signal)
  await initThemePackages(); trackSelection()
  const generation = selection
  const row = requireInstalledThemePackage(identity)
  if (!row.enabled || !themePackageCompatible(row)) throw new WorkspaceError('主题包尚未启用或合同不受支持')
  if (isThemePackageChanging(identity)) throw new WorkspaceError('主题包状态正在更新，请稍后重试')
  const original = hydrateThemePackage(row.manifest, themeId, `package-${themeId}`)
  const dependencyGeneration = getThemeDependencyGeneration(original)
  const host = runtime
  if (!host) throw new WorkspaceError('主题包资源宿主尚未就绪')
  const result = await host.prepare(original, {signal: options.signal, localResources: readLocalThemeFont})
  let success = false
  try {
    aborted(options.signal)
    const latestRow = requireInstalledThemePackage(identity)
    if (!result.ready) throw new WorkspaceError(result.reason || '主题资源准备失败')
    if (runtime !== host || latestRow.generation !== row.generation || !latestRow.enabled || selection !== generation || isThemePackageChanging(identity) || getThemeDependencyGeneration(original) !== dependencyGeneration) throw new WorkspaceError('主题选择或包状态在准备期间已变化，请重试')
    const workspace = getWorkspace()
    const design = ({id: _id, builtin: _builtin, ...theme}: ThemeEntry) => canonicalJson(theme)
    const existing = workspace.themes.find(theme => design(theme) === design(original))
    let theme = existing ?? original
    if (!existing) {
      if (workspace.themes.length >= 24) throw new WorkspaceError('主题库已满，请先删除不用的主题')
      const base = `pkg-${identity.packageId}-${themeId}`.slice(0, 110)
      let id = base
      for (let n = 2; workspace.themes.some(item => item.id === id); n += 1) id = `${base}-${n}`
      theme = {...original, id}
    }
    assertThemeEntry(theme)
    // 最后一次重核与commit之间不await，仅合并主题字段，保持最新业务树。
    commit({...workspace, themes: existing ? workspace.themes : [...workspace.themes, theme], theme: {...workspace.theme, active: theme.id, mode: theme.mode ?? workspace.theme.base}})
    success = true
    return theme
  } finally {if (success) releaseLater([result]); else result.release?.()}
}
export async function exportThemePackage(identity: PackageIdentity): Promise<string> {
  await initThemePackages()
  return serializeThemePackage(requireInstalledThemePackage(identity))
}
export async function exportThemeWithDependencies(input: ThemeEntry): Promise<string> {
  const theme = structuredClone(input)
  assertThemeEntry(theme)
  await initThemePackages()
  if (theme.opaqueDesign || theme.rendererContract && (theme.rendererContract.schemaVersion !== 1 || theme.rendererContract.skinVersion !== 1 || theme.rendererContract.shellVersion !== 1) || theme.fonts === undefined || theme.fonts.some(font => !font.resource)) throw new WorkspaceError('此方案含默认/远端字体或未知设计；请先在作者中选择系统字体或本地资源再导出')
  const descriptors: ThemePackageManifest['resources'] = [], resources: {id: string; bytes: ArrayBuffer}[] = []
  const fonts = []
  for (const font of theme.fonts) {
    const ref = font.resource!
    const installed = requireInstalledThemePackage(ref)
    const bytes = await resourceReaderFor(installed)(ref)
    let descriptor = descriptors.find(item => item.sha256 === ref.sha256)
    if (!descriptor) {
      descriptor = {id: `font-${descriptors.length + 1}`, mime: 'font/woff2' as const, bytes: bytes.byteLength, sha256: ref.sha256}
      descriptors.push(descriptor); resources.push({id: descriptor.id, bytes})
    }
    fonts.push({family: font.family, ...(font.role ? {role: font.role} : {}), resourceId: descriptor.id})
  }
  const {id: _id, builtin: _builtin, packageRef: _package, rendererContract: _contract, fonts: _fonts, ...design} = structuredClone(theme)
  const manifest: ThemePackageManifest = {packageId: `local.theme-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, version: '1.0.0', digest: '', kind: 'declarative-theme', schemaVersion: 1,
    name: theme.name, description: theme.description, requiredRenderers: [{skin: theme.skin, shell: theme.shell, skinVersion: 1, shellVersion: 1}], contributions: [{id: 'theme', kind: 'theme', design: {...design, fonts}}], resources: descriptors}
  manifest.digest = await themePackageDigest(manifest)
  return serializeThemePackage({manifest, resources})
}
