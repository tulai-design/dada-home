import type {ThemeEntry} from '../workspace'

export const THEME_PACKAGE_SCHEMA = 1
export const THEME_RENDERER_CONTRACT = 1
export const PACKAGE_LIMITS = {
  file: 6 * 1024 * 1024, manifest: 64 * 1024, design: 32 * 1024,
  font: 2 * 1024 * 1024, package: 4 * 1024 * 1024, repository: 16 * 1024 * 1024,
  resources: 4, themes: 8, versions: 16, depth: 12,
} as const
export type PackageIdentity = {packageId: string; version: string; digest: string}
export type ThemePackageRef = PackageIdentity & {themeId: string}
export type LocalThemeFontRef = PackageIdentity & {resourceId: string; sha256: string}
export type ThemeRendererContract = {schemaVersion: number; skinVersion: number; shellVersion: number}
export type OpaqueThemeDesign = {schemaVersion: number; payload: Record<string, unknown>}
export type ThemePackageResource = {id: string; mime: 'font/woff2'; bytes: number; sha256: string}
export type PackageFont = {family: string; role?: 'sans' | 'serif' | 'mono'; resourceId: string}
export type ThemePackageDefinition = Omit<ThemeEntry, 'id' | 'builtin' | 'packageRef' | 'rendererContract' | 'fonts'> & {fonts: PackageFont[]}
export type ThemePackageManifest = PackageIdentity & {
  kind: 'declarative-theme'; schemaVersion: 1; name: string; description: string
  requiredRenderers: {skin: string; shell: string; skinVersion: number; shellVersion: number}[]
  contributions: {id: string; kind: 'theme'; design: ThemePackageDefinition}[]
  resources: ThemePackageResource[]
}
export type ThemePackageImport = {
  manifest: ThemePackageManifest
  resources: {id: string; bytes: ArrayBuffer}[]
  unsupportedEnvelope?: Record<string, unknown>
}
export type StoredThemePackage = ThemePackageImport & {
  k: string; enabled: boolean; generation: number; installedAt: number
  state: 'installed' | 'unsupported'
}
export type ThemePackageSummary = PackageIdentity & {
  name: string; description: string; enabled: boolean; generation: number
  state: 'installed' | 'unsupported'; bytes: number; themes: {id: string; name: string; skin: string; shell: string}[]
}
export type ThemePackageAvailability = {
  status: 'available' | 'missing' | 'disabled' | 'incompatible' | 'unsupported' | 'resource-error'
  reason?: string; generation: number
}
export type ThemePackageDependent = {kind: 'theme' | 'template' | 'draft'; id: string; name: string}
export type LocalThemeResourceReader = (ref: LocalThemeFontRef, signal?: AbortSignal) => Promise<ArrayBuffer>
export type ThemePackagePreparation = {ready: boolean; reason?: string; release?: () => void}
export type ThemePackageRuntime = {
  prepare: (theme: ThemeEntry, options: {signal?: AbortSignal; localResources: LocalThemeResourceReader}) => Promise<ThemePackagePreparation>
}
export const packageKey = (identity: Pick<PackageIdentity, 'packageId' | 'version'>): string => `${identity.packageId}@${identity.version}`
export const samePackage = (a: PackageIdentity, b: PackageIdentity): boolean => a.packageId === b.packageId && a.version === b.version && a.digest === b.digest
export function localThemeFontRefJsonSchema() {
  return {type: 'object', additionalProperties: false, required: ['packageId', 'version', 'digest', 'resourceId', 'sha256'], properties: {
    packageId: {type: 'string', maxLength: 64}, version: {type: 'string', maxLength: 20},
    digest: {type: 'string', pattern: '^[a-f0-9]{64}$'}, resourceId: {type: 'string', maxLength: 64}, sha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
  }}
}
