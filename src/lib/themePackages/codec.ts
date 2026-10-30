import {WorkspaceError} from '../errors'
import {validateWoff2Bytes, sha256Bytes} from '../fontResource'
import {isThemeRenderer} from '../themeCatalog'
import {assertThemeEntry} from '../themes'
import type {ThemeEntry} from '../workspace'
import {assertBoundedJson, assertPlainContainer, assertPackageIdentity, boundedText, canonicalJson, exact, object, RESOURCE_ID} from './boundary'
import {PACKAGE_LIMITS, packageKey, type StoredThemePackage, type ThemePackageImport, type ThemePackageManifest, type ThemePackageSummary} from './contracts'

function fail(message: string): never {throw new WorkspaceError(message)}
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1000000
function base64Decode(raw: unknown): ArrayBuffer {
  if (typeof raw !== 'string' || raw.length > Math.ceil(PACKAGE_LIMITS.font / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) fail('主题字体 base64 无效或超过预算')
  const binary = atob(raw)
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer
}
function base64Encode(raw: ArrayBuffer): string {
  const bytes = new Uint8Array(raw)
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return btoa(binary)
}
function assertManifest(raw: unknown): asserts raw is ThemePackageManifest {
  if (!object(raw)) fail('主题包 manifest 必须是对象')
  assertBoundedJson(raw, PACKAGE_LIMITS.manifest)
  assertPackageIdentity(raw)
  exact(raw, ['packageId', 'version', 'digest', 'kind', 'schemaVersion', 'name', 'description', 'requiredRenderers', 'contributions', 'resources'])
  if (raw.kind !== 'declarative-theme' || raw.schemaVersion !== 1) fail('主题包类型或 schema 不受支持')
  boundedText(raw.name, 40, 'name'); boundedText(raw.description, 240, 'description', true)
  if (!Array.isArray(raw.requiredRenderers) || raw.requiredRenderers.length < 1 || raw.requiredRenderers.length > PACKAGE_LIMITS.themes) fail('主题包 renderer 清单无效')
  const rendererKeys = new Set<string>()
  for (const renderer of raw.requiredRenderers) {
    if (!object(renderer)) fail('主题包 renderer 引用无效')
    exact(renderer, ['skin', 'shell', 'skinVersion', 'shellVersion'])
    boundedText(renderer.skin, 80, 'skin'); boundedText(renderer.shell, 80, 'shell')
    if (!positive(renderer.skinVersion) || !positive(renderer.shellVersion)) fail('主题包 renderer 合同版本无效')
    const key = `${renderer.skin}\0${renderer.shell}`
    if (rendererKeys.has(key)) fail('主题包 renderer 清单重复')
    rendererKeys.add(key)
  }
  if (!Array.isArray(raw.resources) || raw.resources.length > PACKAGE_LIMITS.resources) fail('主题包资源数量超过预算')
  const resourceIds = new Set<string>()
  let total = 0
  for (const resource of raw.resources) {
    if (!object(resource)) fail('主题包资源清单无效')
    exact(resource, ['id', 'mime', 'bytes', 'sha256'])
    if (typeof resource.id !== 'string' || !RESOURCE_ID.test(resource.id) || resourceIds.has(resource.id) || resource.mime !== 'font/woff2' || !Number.isSafeInteger(resource.bytes) || Number(resource.bytes) < 48 || Number(resource.bytes) > PACKAGE_LIMITS.font || typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256)) fail('主题包字体资源无效、重复或超过预算')
    resourceIds.add(resource.id); total += Number(resource.bytes)
  }
  if (total > PACKAGE_LIMITS.package) fail('主题包解码资源超过 4MiB 预算')
  if (!Array.isArray(raw.contributions) || raw.contributions.length < 1 || raw.contributions.length > PACKAGE_LIMITS.themes) fail('主题包贡献数量无效')
  const themeIds = new Set<string>()
  for (const contribution of raw.contributions) {
    if (!object(contribution)) fail('主题包贡献无效')
    exact(contribution, ['id', 'kind', 'design'])
    if (typeof contribution.id !== 'string' || !RESOURCE_ID.test(contribution.id) || themeIds.has(contribution.id) || contribution.kind !== 'theme' || !object(contribution.design)) fail('主题包贡献类型或标识无效')
    themeIds.add(contribution.id)
    const design = contribution.design
    exact(design, ['name', 'description', 'skin', 'shell', 'origin', 'overrides', 'light', 'dark', 'fonts', 'mode', 'recipes', 'shellConfig', 'opaqueDesign'])
    assertBoundedJson(design)
    const renderer = raw.requiredRenderers.find(item => object(item) && item.skin === design.skin && item.shell === design.shell)
    if (!renderer) fail('主题包贡献缺少精确 renderer 合同')
    if (!Array.isArray(design.fonts) || design.fonts.length > 4) fail('主题包必须显式指定本地字体或 fonts:[]，不能使用默认网络字体')
    for (const font of design.fonts) {
      if (!object(font)) fail('主题包字体引用无效')
      exact(font, ['family', 'role', 'resourceId'])
      if (typeof font.resourceId !== 'string' || !resourceIds.has(font.resourceId)) fail('主题包贡献引用不存在的字体资源')
    }
    // hydrate 后使用工作空间同一严格 unknown 入口；未知 renderer 仅保留有界数据。
    assertThemeEntry(hydrateThemePackage(raw as unknown as ThemePackageManifest, contribution.id, `package-${contribution.id}`))
  }
}
export function hydrateThemePackage(manifest: ThemePackageManifest, themeId: string, instanceId: string): ThemeEntry {
  const item = manifest.contributions.find(entry => entry.id === themeId)
  if (!item) fail('主题包没有该主题贡献')
  const renderer = manifest.requiredRenderers.find(entry => entry.skin === item.design.skin && entry.shell === item.design.shell)
  if (!renderer) fail('主题贡献没有 renderer 合同')
  const {fonts, ...design} = structuredClone(item.design)
  return {...design, id: instanceId, packageRef: {packageId: manifest.packageId, version: manifest.version, digest: manifest.digest, themeId},
    rendererContract: {schemaVersion: 1, skinVersion: renderer.skinVersion, shellVersion: renderer.shellVersion},
    fonts: fonts.map(font => {
      const resource = manifest.resources.find(entry => entry.id === font.resourceId)
      if (!resource) fail('主题字体资源不存在')
      return {family: font.family, ...(font.role ? {role: font.role} : {}), resource: {packageId: manifest.packageId, version: manifest.version, digest: manifest.digest, resourceId: font.resourceId, sha256: resource.sha256}}
    })}
}
export async function themePackageDigest(manifest: Omit<ThemePackageManifest, 'digest'> | ThemePackageManifest): Promise<string> {
  const {digest: _digest, ...unsigned} = manifest as ThemePackageManifest
  return sha256Bytes(new TextEncoder().encode(canonicalJson(unsigned)).buffer)
}
function unsupportedImport(raw: Record<string, unknown>): ThemePackageImport {
  assertBoundedJson(raw, PACKAGE_LIMITS.manifest)
  if (!object(raw.manifest) || !Array.isArray(raw.resources) || raw.resources.length !== 0) fail('未知主题包仅可保存不含资源的 metadata envelope')
  assertPackageIdentity(raw.manifest)
  boundedText(raw.manifest.kind, 80, 'kind')
  if (!positive(raw.manifest.schemaVersion)) fail('未知主题包 schemaVersion 无效')
  boundedText(raw.manifest.name, 40, 'name'); boundedText(raw.manifest.description ?? '', 240, 'description', true)
  if (Array.isArray(raw.manifest.resources) && raw.manifest.resources.length) fail('不支持的包资源无法安全保存，未安装')
  return {manifest: {packageId: raw.manifest.packageId, version: raw.manifest.version, digest: raw.manifest.digest,
    kind: 'declarative-theme', schemaVersion: 1, name: raw.manifest.name, description: String(raw.manifest.description ?? ''), requiredRenderers: [], contributions: [], resources: []}, resources: [], unsupportedEnvelope: structuredClone(raw)}
}
function decodePackage(raw: unknown): ThemePackageImport {
  if (!object(raw)) fail('这不是主题包 JSON')
  exact(raw, ['manifest', 'resources'])
  if (!object(raw.manifest)) fail('主题包缺少 manifest')
  if (raw.manifest.kind !== 'declarative-theme' || raw.manifest.schemaVersion !== 1) return unsupportedImport(raw)
  assertManifest(raw.manifest)
  const manifest = raw.manifest
  if (!Array.isArray(raw.resources) || raw.resources.length !== raw.manifest.resources.length) fail('主题包资源内容与清单不一致')
  const resources = raw.resources.map(resource => {
    if (!object(resource)) fail('主题包资源内容无效')
    exact(resource, ['id', 'base64'])
    if (typeof resource.id !== 'string') fail('主题包资源标识无效')
    const descriptor = manifest.resources.find(item => item.id === resource.id)
    if (!descriptor) fail('主题包资源未声明')
    const bytes = validateWoff2Bytes(base64Decode(resource.base64), descriptor.bytes)
    return {id: resource.id, bytes}
  })
  if (new Set(resources.map(item => item.id)).size !== resources.length) fail('主题包资源内容重复')
  return {manifest: structuredClone(raw.manifest), resources}
}
async function checkHashes(input: ThemePackageImport): Promise<void> {
  if (input.unsupportedEnvelope) {
    const manifest = input.unsupportedEnvelope.manifest as Record<string, unknown>
    const {digest: _digest, ...unsigned} = manifest
    if (await sha256Bytes(new TextEncoder().encode(canonicalJson(unsigned)).buffer) !== manifest.digest) fail('未知主题包 metadata 摘要不匹配')
    return
  }
  if (await themePackageDigest(input.manifest) !== input.manifest.digest) fail('主题包 manifest 摘要不匹配')
  for (const resource of input.resources) {
    const descriptor = input.manifest.resources.find(item => item.id === resource.id)!
    validateWoff2Bytes(resource.bytes, descriptor.bytes)
    if (await sha256Bytes(resource.bytes) !== descriptor.sha256) fail('主题包字体内容摘要不匹配')
  }
}
export async function parseThemePackage(text: string): Promise<ThemePackageImport> {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > PACKAGE_LIMITS.file) fail('主题包 JSON 超过 6MiB 读取预算')
  let raw: unknown
  try {raw = JSON.parse(text)} catch {fail('主题包不是有效 JSON')}
  const parsed = decodePackage(raw)
  await checkHashes(parsed)
  return parsed
}
export function serializeStoredThemePackage(row: StoredThemePackage): Record<string, unknown> {
  const file = row.unsupportedEnvelope ?? {manifest: structuredClone(row.manifest), resources: row.resources.map(item => ({id: item.id, base64: base64Encode(item.bytes)}))}
  return {k: row.k, file: structuredClone(file), enabled: false, generation: row.generation, installedAt: row.installedAt, state: row.state}
}
export function deserializeStoredThemePackage(raw: unknown): StoredThemePackage {
  if (!object(raw)) fail('备份主题包记录无效')
  exact(raw, ['k', 'file', 'enabled', 'generation', 'installedAt', 'state'])
  const input = decodePackage(raw.file)
  if (raw.k !== packageKey(input.manifest) || typeof raw.enabled !== 'boolean' || !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 1 || typeof raw.installedAt !== 'number' || !Number.isFinite(raw.installedAt) || raw.installedAt < 0 || raw.state !== (input.unsupportedEnvelope ? 'unsupported' : 'installed')) fail('备份主题包本机元信息无效')
  return {...input, k: raw.k, enabled: false, generation: Number(raw.generation), installedAt: raw.installedAt, state: input.unsupportedEnvelope ? 'unsupported' : 'installed'}
}
/** 在structuredClone前拒绝非JSON对象、getter或被悄悄丢弃的额外属性。 */
export function cloneThemePackageImport(raw: unknown): ThemePackageImport {
  if (!object(raw)) fail('主题包安装参数必须为对象')
  assertPlainContainer(raw)
  exact(raw, ['manifest', 'resources', 'unsupportedEnvelope'])
  assertBoundedJson(raw.manifest, PACKAGE_LIMITS.manifest)
  if (raw.unsupportedEnvelope !== undefined) assertBoundedJson(raw.unsupportedEnvelope, PACKAGE_LIMITS.manifest)
  if (!Array.isArray(raw.resources) || raw.resources.length > PACKAGE_LIMITS.resources) fail('主题包资源数量无效')
  assertPlainContainer(raw.resources)
  for (const resource of raw.resources) {
    if (!object(resource)) fail('主题包资源内容无效')
    assertPlainContainer(resource)
    exact(resource, ['id', 'bytes'])
    if (typeof resource.id !== 'string') fail('主题包资源标识无效')
    validateWoff2Bytes(resource.bytes)
  }
  return structuredClone(raw) as unknown as ThemePackageImport
}
export async function validateStoredThemePackage(raw: unknown): Promise<StoredThemePackage> {
  if (!object(raw)) fail('本机主题包记录无效')
  assertPlainContainer(raw)
  exact(raw, ['k', 'manifest', 'resources', 'unsupportedEnvelope', 'enabled', 'generation', 'installedAt', 'state'])
  cloneThemePackageImport({manifest: raw.manifest, resources: raw.resources, ...(raw.unsupportedEnvelope === undefined ? {} : {unsupportedEnvelope: raw.unsupportedEnvelope})})
  // 序列化/反序列化共用结构校验，但运行时验证不能把enabled偷偷清掉。
  if (!Array.isArray(raw.resources) || raw.resources.length > PACKAGE_LIMITS.resources) fail('本机主题包资源无效')
  const candidate = structuredClone(raw) as unknown as StoredThemePackage
  let input: ThemePackageImport
  if (candidate.unsupportedEnvelope) input = decodePackage(candidate.unsupportedEnvelope)
  else {
    assertManifest(candidate.manifest)
    if (candidate.resources.some(resource => !object(resource) || Object.keys(resource).some(key => key !== 'id' && key !== 'bytes') || typeof resource.id !== 'string' || !(resource.bytes instanceof ArrayBuffer))) fail('本机主题包资源内容无效')
    const descriptors = candidate.manifest.resources
    if (candidate.resources.length !== descriptors.length || new Set(candidate.resources.map(resource => resource.id)).size !== descriptors.length) fail('本机主题包资源清单不一致')
    for (const resource of candidate.resources) {const descriptor = descriptors.find(item => item.id === resource.id); if (!descriptor) fail('本机主题包有未声明资源'); validateWoff2Bytes(resource.bytes, descriptor.bytes)}
    input = {manifest: candidate.manifest, resources: candidate.resources}
  }
  if (candidate.k !== packageKey(input.manifest) || typeof candidate.enabled !== 'boolean' || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1 || !Number.isFinite(candidate.installedAt) || candidate.installedAt < 0 || candidate.state !== (input.unsupportedEnvelope ? 'unsupported' : 'installed') || candidate.state === 'unsupported' && candidate.enabled) fail('本机主题包状态无效')
  await checkHashes(input)
  return {...input, k: candidate.k, enabled: candidate.enabled, generation: candidate.generation, installedAt: candidate.installedAt, state: candidate.state}
}
export function assertThemePackageRepositoryBudget(rows: readonly StoredThemePackage[]): void {
  if (rows.length > PACKAGE_LIMITS.versions || new Set(rows.map(row => row.k)).size !== rows.length) fail('主题包仓版本数量超限或身份重复')
  if (rows.reduce((sum, row) => sum + row.resources.reduce((size, resource) => size + resource.bytes.byteLength, 0), 0) > PACKAGE_LIMITS.repository) fail('主题包仓资源超过 16MiB 预算')
}
export function summarizeThemePackage(row: StoredThemePackage): ThemePackageSummary {
  return {packageId: row.manifest.packageId, version: row.manifest.version, digest: row.manifest.digest, name: row.manifest.name, description: row.manifest.description,
    enabled: row.enabled, generation: row.generation, state: row.state, bytes: row.resources.reduce((sum, item) => sum + item.bytes.byteLength, 0),
    themes: row.state === 'unsupported' ? [] : row.manifest.contributions.map(item => ({id: item.id, name: item.design.name, skin: item.design.skin, shell: item.design.shell}))}
}
export function themePackageCompatible(row: StoredThemePackage): boolean {
  return row.state === 'installed' && row.manifest.requiredRenderers.every(renderer => renderer.skinVersion === 1 && renderer.shellVersion === 1 && isThemeRenderer(renderer.skin, renderer.shell))
}
/** 仅供导出已校验包和构造测试fixture；无存储或启用副作用。 */
export function serializeThemePackage(input: ThemePackageImport): string {
  const raw = input.unsupportedEnvelope ?? {manifest: input.manifest, resources: input.resources.map(item => ({id: item.id, base64: base64Encode(item.bytes)}))}
  const text = JSON.stringify(raw, null, 2)
  if (new TextEncoder().encode(text).byteLength > PACKAGE_LIMITS.file) fail('主题包 JSON 超过导出预算')
  return text
}
