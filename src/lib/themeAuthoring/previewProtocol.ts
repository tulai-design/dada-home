import type {ThemeEntry} from '../workspace'
import {PACKAGE_LIMITS,type LocalThemeFontRef,type ThemePackageAvailability} from '../themePackages/contracts'
import {cleanLocalThemeFontRef} from '../fontResource'
import {assertThemeEntry} from '../themes'

export const THEME_PREVIEW_PROTOCOL = 'dada-theme-preview-v1'
export const THEME_PREVIEW_MAX_BYTES = 64 * 1024
export const THEME_PREVIEW_WIDTHS = [1440, 390, 320, 480] as const
export type ThemePreviewWidth = typeof THEME_PREVIEW_WIDTHS[number]
type Identity = {protocol: typeof THEME_PREVIEW_PROTOCOL; channel: string; draftId: string; revision: number; requestId: string; packageGeneration: number}
export type ThemePreviewRequest = Identity & {type: 'render'; theme: ThemeEntry; mode: 'light'|'dark'; width: ThemePreviewWidth; reducedMotion: boolean; availability: ThemePackageAvailability}
export type ThemePreviewReport = {
  draftId: string; revision: number; requestId: string; mode: 'light'|'dark'; width: ThemePreviewWidth
  ready: boolean; reason?: string
  resources: {family: string; status: 'ready'|'error'; reason?: string}[]
  geometry: {viewport: number; contentWidth: number; overflow: boolean; sampleCount: number}
  limits: readonly string[]
}
export type ThemePreviewResponse = Identity & {type: 'report'; report: ThemePreviewReport}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).every(key => fields.includes(key))
const text = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const finite = (value: unknown, max = 100000): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
export function themePreviewFitsBudget(value: unknown): boolean {
  try {return new TextEncoder().encode(JSON.stringify(value)).byteLength <= THEME_PREVIEW_MAX_BYTES} catch {return false}
}
function identity(value: Record<string, unknown>): boolean {
  return value.protocol === THEME_PREVIEW_PROTOCOL && text(value.channel, 80) && text(value.draftId, 120) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1 && text(value.requestId, 80) && Number.isSafeInteger(value.packageGeneration) && Number(value.packageGeneration) >= 0
}
export function isThemePreviewRequest(raw: unknown): raw is ThemePreviewRequest {
  if (!object(raw) || !themePreviewFitsBudget(raw) || !identity(raw) || !exact(raw, ['protocol','channel','draftId','revision','requestId','packageGeneration','type','theme','mode','width','reducedMotion','availability']) || raw.type !== 'render' || typeof raw.mode !== 'string' || !['light','dark'].includes(raw.mode) || !THEME_PREVIEW_WIDTHS.includes(raw.width as ThemePreviewWidth) || typeof raw.reducedMotion !== 'boolean') return false
  if(!object(raw.availability)||!exact(raw.availability,['status','reason','generation'])||typeof raw.availability.status!=='string'||!['available','missing','disabled','incompatible','unsupported','resource-error'].includes(raw.availability.status)||raw.availability.generation!==raw.packageGeneration||raw.availability.reason!==undefined&&!text(raw.availability.reason,500))return false
  try {assertThemeEntry(raw.theme); return true} catch {return false}
}
export function isThemePreviewResponse(raw: unknown): raw is ThemePreviewResponse {
  if (!object(raw) || !themePreviewFitsBudget(raw) || !identity(raw) || !exact(raw, ['protocol','channel','draftId','revision','requestId','packageGeneration','type','report']) || raw.type !== 'report' || !object(raw.report)) return false
  const report = raw.report
  if (!exact(report, ['draftId','revision','requestId','mode','width','ready','reason','resources','geometry','limits']) || report.draftId !== raw.draftId || report.revision !== raw.revision || report.requestId !== raw.requestId || typeof report.mode !== 'string' || !['light','dark'].includes(report.mode) || !THEME_PREVIEW_WIDTHS.includes(report.width as ThemePreviewWidth) || typeof report.ready !== 'boolean' || report.reason !== undefined && !text(report.reason, 500)) return false
  if (!Array.isArray(report.resources) || report.resources.length > 4 || !report.resources.every(item => object(item) && exact(item, ['family','status','reason']) && text(item.family,40) && typeof item.status === 'string' && ['ready','error'].includes(item.status) && (item.reason === undefined || text(item.reason,500)))) return false
  if (!object(report.geometry) || !exact(report.geometry, ['viewport','contentWidth','overflow','sampleCount']) || !finite(report.geometry.viewport,1440) || !finite(report.geometry.contentWidth) || typeof report.geometry.overflow !== 'boolean' || !finite(report.geometry.sampleCount,100)) return false
  return Array.isArray(report.limits) && report.limits.length <= 8 && report.limits.every(item=>text(item,160))
}

export const THEME_PREVIEW_RESOURCE_MAX_BYTES = PACKAGE_LIMITS.font
export const THEME_PREVIEW_RESOURCE_TOTAL_BYTES = PACKAGE_LIMITS.package
export type ThemePreviewResourceRequest = Identity & {type:'resource-request';resourceRequestId:string;ref:LocalThemeFontRef}
export type ThemePreviewResourceResponse = Identity & {type:'resource-response';resourceRequestId:string;ref:LocalThemeFontRef} & ({bytes:ArrayBuffer;error?:never}|{error:string;bytes?:never})
function resourceRef(raw:unknown):raw is LocalThemeFontRef {
  try{cleanLocalThemeFontRef(raw);return true}catch{return false}
}
/** 接收消息还必须属于原始请求；不能将旧 requestId 拼接到新草稿版本。 */
export function sameThemePreviewSession(a:Identity,b:Identity):boolean {
  return a.protocol===b.protocol && a.channel===b.channel && a.draftId===b.draftId && a.revision===b.revision && a.requestId===b.requestId && a.packageGeneration===b.packageGeneration
}
export function sameThemeFontResource(a:LocalThemeFontRef,b:LocalThemeFontRef):boolean {
  return a.packageId===b.packageId && a.version===b.version && a.digest===b.digest && a.resourceId===b.resourceId && a.sha256===b.sha256
}
export function isThemePreviewResourceRequest(raw:unknown):raw is ThemePreviewResourceRequest {
  return object(raw) && themePreviewFitsBudget(raw) && identity(raw) && exact(raw,['protocol','channel','draftId','revision','requestId','packageGeneration','type','resourceRequestId','ref']) && raw.type==='resource-request' && text(raw.resourceRequestId,80) && resourceRef(raw.ref)
}
export function isThemePreviewResourceResponse(raw:unknown):raw is ThemePreviewResourceResponse {
  if(!object(raw)||!identity(raw)||!exact(raw,['protocol','channel','draftId','revision','requestId','packageGeneration','type','resourceRequestId','ref','bytes','error'])||raw.type!=='resource-response'||!text(raw.resourceRequestId,80)||!resourceRef(raw.ref))return false
  if(raw.error!==undefined)return raw.bytes===undefined && text(raw.error,500)
  return raw.bytes instanceof ArrayBuffer && raw.bytes.byteLength>0 && raw.bytes.byteLength<=THEME_PREVIEW_RESOURCE_MAX_BYTES
}
