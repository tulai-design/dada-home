import {useSyncExternalStore} from 'react'
import {WorkspaceError} from '../errors'
import {resolveTheme} from '../themes'
import {activeTheme, type ThemeEntry, type Workspace} from '../workspace'
import {commit, getWorkspace, subscribeWorkspace} from '../workspaceStore'
import {THEME_CATALOG_VERSION, listThemeFields, type ThemeField} from './catalog'
import {assertDraftInput, buildDraftCommit, createDraft, draftConflict, patchDraft, requireDraftVersion, type CreateThemeDraftInput, type ThemeDraft, type UpdateThemeDraftInput, type VersionedThemeDraftInput} from './draft'

export type ThemePreparation = {ready: boolean; reason?: string; release?: () => void}
export type ThemePreviewReadiness = {draftId: string; revision: number; status: 'pending' | 'ready' | 'error' | 'unavailable'; reason?: string}
export type ThemeAuthoringPort = {
  prepare: (request: {draftId: string; revision: number; theme: ThemeEntry; signal?: AbortSignal}) => Promise<ThemePreparation>
  getReadiness?: (request: {draftId: string; revision: number}) => ThemePreviewReadiness
}
let current: ThemeDraft | null = null
let selectionGeneration = 0
let selectedId: string | undefined
let tracking = false
let port: ThemeAuthoringPort | null = null
const listeners = new Set<() => void>()
const preparations = new Set<AbortController>()
function emit() {listeners.forEach(listener => listener())}
function cancelPreparations() {
  for (const controller of preparations) controller.abort()
}
function trackSelection() {
  if (tracking) return
  tracking = true
  selectedId = getWorkspace().theme.active
  subscribeWorkspace(() => {
    const next = getWorkspace().theme.active
    if (next !== selectedId) {selectionGeneration += 1; selectedId = next; emit()}
  })
}
export function getThemeDraft(): ThemeDraft | null {return current}
export function subscribeThemeDraft(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}}
export function useThemeDraft() {return useSyncExternalStore(subscribeThemeDraft, getThemeDraft, getThemeDraft)}
export function registerThemeAuthoringPort(next: ThemeAuthoringPort): () => void {
  port = next
  return () => {if (port === next) port = null}
}
export function createThemeDraft(input: CreateThemeDraftInput): ThemeDraft {
  if (current) throw new WorkspaceError('已有主题草稿，请先读取、修改或取消')
  trackSelection()
  current = createDraft(getWorkspace(), input, selectionGeneration)
  emit()
  return current
}
export function updateThemeDraft(input: UpdateThemeDraftInput): ThemeDraft {
  assertDraftInput(input, ['draftId', 'expectedRevision', 'operations', 'name', 'description'])
  const draft = requireDraftVersion(current, input)
  current = patchDraft(draft, input)
  cancelPreparations()
  emit()
  return current
}
export function discardThemeDraft(input: VersionedThemeDraftInput): void {
  assertDraftInput(input, ['draftId', 'expectedRevision'])
  requireDraftVersion(current, input)
  current = null
  cancelPreparations()
  emit()
}
export function describeThemeSchema(workspace: Workspace, ref?: string, group?: ThemeField['group']) {
  if (group !== undefined && !['tokens', 'recipes', 'shell', 'resources'].includes(group)) throw new WorkspaceError('未知主题目录分组')
  const theme = ref === undefined ? activeTheme(workspace) : workspace.themes.find(item => item.id === ref || item.name === ref)
  if (!theme) throw new WorkspaceError('主题不存在')
  return {catalogVersion: THEME_CATALOG_VERSION, theme: {id: theme.id, skin: theme.skin, shell: theme.shell}, fields: listThemeFields(theme, group),
    light: resolveTheme(theme, 'light'), dark: resolveTheme(theme, 'dark'),
    limits: ['草稿为独立静态典型界面，不运行用户应用、存储、同步或AI', '资源及有限几何就绪不代表颜色可读性或审美验收']}
}
export function describeThemeDraft() {
  if (!current) return null
  const draft = current
  const source = getWorkspace().themes.find(theme => theme.id === draft.sourceId)
  const measured = port?.getReadiness?.({draftId: draft.id, revision: draft.revision})
  const readiness: ThemePreviewReadiness = measured?.draftId === draft.id && measured.revision === draft.revision
    ? measured
    : {draftId: draft.id, revision: draft.revision, status: port ? 'pending' : 'unavailable'}
  return {...structuredClone(draft), conflict: draftConflict(getWorkspace(), draft, selectionGeneration),
    before: source ? {light: resolveTheme(source, 'light'), dark: resolveTheme(source, 'dark')} : null,
    after: {light: resolveTheme(draft.theme, 'light'), dark: resolveTheme(draft.theme, 'dark')},
    preview: {kind: 'static-theme-fixture', available: !!port, readiness, limitations: ['readiness仅指当前预览；正式文档字体仍须在应用前准备', '不运行真实应用/业务数据；不验证所有内部界面、对比度和审美', '草稿只保存在当前会话内存，刷新丢弃']}}
}
function aborted(signal?: AbortSignal) {if (signal?.aborted) throw new DOMException('主题应用已停止；没有提交正式主题', 'AbortError')}
function releaseAfterHostCommit(release?: () => void) {
  if (!release) return
  // 正式store通知触发宿主layout字体lease接管后再释放作者预备lease。
  let done = false
  let first = 0, second = 0
  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timeout)
    if (typeof cancelAnimationFrame === 'function') {cancelAnimationFrame(first); cancelAnimationFrame(second)}
    release()
  }
  const timeout = setTimeout(finish, 500)
  if (typeof requestAnimationFrame === 'function') first = requestAnimationFrame(() => {second = requestAnimationFrame(finish)})
  else queueMicrotask(finish)
}
export async function applyThemeDraft(input: VersionedThemeDraftInput, options: {signal?: AbortSignal} = {}): Promise<Workspace> {
  assertDraftInput(input, ['draftId', 'expectedRevision'])
  const draft = requireDraftVersion(current, input)
  buildDraftCommit(getWorkspace(), draft, selectionGeneration)
  aborted(options.signal)
  const preparationPort = port
  if (!preparationPort) throw new WorkspaceError('主题预览宿主尚未就绪；请打开外观设置等待预览')
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, {once: true})
  preparations.add(controller)
  let prepared: ThemePreparation | undefined
  let committed = false
  try {
    prepared = await preparationPort.prepare({draftId: draft.id, revision: draft.revision, theme: structuredClone(draft.theme), signal: controller.signal})
    aborted(controller.signal)
    if (!prepared.ready) throw new WorkspaceError(prepared.reason || '主题预览或字体资源未准备成功')
    if (port !== preparationPort) throw new WorkspaceError('主题预览宿主已变化；草稿保留')
    const latest = requireDraftVersion(current, input)
    const next = buildDraftCommit(getWorkspace(), latest, selectionGeneration)
    commit(next)
    committed = true
    current = null
    emit()
    return next
  } finally {
    preparations.delete(controller)
    options.signal?.removeEventListener('abort', abort)
    if (committed) releaseAfterHostCommit(prepared?.release)
    else prepared?.release?.()
  }
}
