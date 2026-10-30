import type {ThemeEntry} from '../workspace'
import {packageKey, type PackageIdentity, type StoredThemePackage, type ThemePackageDependent} from './contracts'

let rows: readonly StoredThemePackage[] = []
let generation = 0
const dependencyGenerations = new Map<string, number>()
const changing = new Set<string>()
const listeners = new Set<() => void>()
export const getThemePackageRecords = (): readonly StoredThemePackage[] => rows
export const getThemePackageGeneration = (): number => generation
export const isThemePackageChanging = (identity: PackageIdentity): boolean => changing.has(packageKey(identity))
export function getThemeDependencyGeneration(theme: ThemeEntry): number {
  const keys = new Set<string>()
  if (theme.packageRef) keys.add(packageKey(theme.packageRef))
  for (const font of theme.fonts ?? []) if (font.resource) keys.add(packageKey(font.resource))
  return [...keys].reduce((sum, key) => sum + (dependencyGenerations.get(key) ?? 0), 0)
}
export function subscribeThemePackages(listener: () => void): () => void {
  listeners.add(listener)
  return () => {listeners.delete(listener)}
}
function emit() {generation += 1; for (const listener of listeners) listener()}
export function markThemePackageChanging(identity: PackageIdentity, active: boolean): void {
  const key = packageKey(identity)
  if (changing.has(key) === active) return
  if (active) changing.add(key)
  else changing.delete(key)
  dependencyGenerations.set(key, (dependencyGenerations.get(key) ?? 0) + 1)
  emit()
}
/** 缺失的依赖保留generation墓碑，disable→enable以及卸载重装均不能复用旧检查。 */
export function publishThemePackages(next: readonly StoredThemePackage[]): void {
  const before = new Map(rows.map(row => [row.k, row]))
  const after = new Map(next.map(row => [row.k, row]))
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key), b = after.get(key)
    if (a?.generation !== b?.generation || a?.manifest.digest !== b?.manifest.digest || a?.enabled !== b?.enabled || a?.state !== b?.state) dependencyGenerations.set(key, (dependencyGenerations.get(key) ?? 0) + 1)
  }
  rows = next
  emit()
}

const dependentProviders = new Set<(identity: PackageIdentity) => ThemePackageDependent[]>()
export function registerThemePackageDependents(provider: (identity: PackageIdentity) => ThemePackageDependent[]): () => void {
  dependentProviders.add(provider)
  return () => {dependentProviders.delete(provider)}
}
export function getTransientThemePackageDependents(identity: PackageIdentity): ThemePackageDependent[] {
  return [...dependentProviders].flatMap(provider => provider(identity))
}
