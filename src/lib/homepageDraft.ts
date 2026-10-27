import {useSyncExternalStore} from 'react'
import {WorkspaceError} from './errors'
import {setPageSections} from './ops'
import {buildHomepageRecipe, type HomepageRecipeId} from './homepageRecipes'
import {snapshotOf} from './templates'
import {commit, getWorkspace} from './workspaceStore'
import {instanceId, FROZEN_PAGE_ID, type Page, type Workspace} from './workspace'

export type HomepageDraft = {id: string; recipeId: HomepageRecipeId; revision: number; basePage: Page; page: Page}
let current: HomepageDraft | null = null
const listeners = new Set<() => void>()

function record(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceError('草稿参数必须是对象')
  if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new WorkspaceError('草稿参数包含不支持的字段')
  return raw as Record<string, unknown>
}
let projected: {workspace: Workspace; draft: HomepageDraft; value: Workspace} | undefined

function emit() {projected = undefined; listeners.forEach((listener) => listener())}
export function getHomepageDraft(): HomepageDraft | null {return current}
export function subscribeHomepageDraft(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}}
export function useHomepageDraft() {return useSyncExternalStore(subscribeHomepageDraft, getHomepageDraft, getHomepageDraft)}

export function createHomepageDraft(raw: unknown): HomepageDraft {
  const input = record(raw, ['recipeId', 'focusId'])
  if (current) throw new WorkspaceError('已有首页草稿；先调整现有草稿，或取消后重新生成')
  const workspace = getWorkspace()
  const basePage = snapshotOf(workspace, false).pages.find((page) => page.id === FROZEN_PAGE_ID)
  if (!basePage) throw new WorkspaceError('找不到首页，无法生成草稿')
  const page = buildHomepageRecipe({...workspace, pages: workspace.pages.map((item) => item.id === FROZEN_PAGE_ID ? basePage : item)}, {recipeId: input.recipeId, focusId: input.focusId})
  current = {id: instanceId('homepage-draft'), recipeId: input.recipeId as HomepageRecipeId, revision: 1, basePage, page}
  emit()
  return current
}

export function discardHomepageDraft(raw: unknown): void {
  const input = record(raw, ['draftId'])
  if (!current || typeof input.draftId !== 'string' || input.draftId !== current.id) throw new WorkspaceError('draftId 与当前首页草稿不匹配')
  current = null
  emit()
}

function requireDraft(input: Record<string, unknown>, versioned = false): HomepageDraft {
  if (!current || typeof input.draftId !== 'string' || input.draftId !== current.id) throw new WorkspaceError('draftId 与当前首页草稿不匹配')
  if (versioned && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.revision)) throw new WorkspaceError('expectedRevision 已过期或无效；先读取最新草稿版本')
  return current
}

export function getHomepageDraftWorkspace(): Workspace | null {
  if (!current) return null
  const workspace = getWorkspace()
  if (projected?.workspace === workspace && projected.draft === current) return projected.value
  const value = {...workspace, pages: workspace.pages.map((page) => page.id === FROZEN_PAGE_ID ? current!.page : page)}
  projected = {workspace, draft: current, value}
  return value
}

export function updateHomepageDraft(raw: unknown): HomepageDraft {
  const input = record(raw, ['draftId', 'expectedRevision', 'sections', 'recipeId', 'focusId'])
  const draft = requireDraft(input, true)
  const workspace = getHomepageDraftWorkspace()!
  const hasSections = Object.prototype.hasOwnProperty.call(input, 'sections')
  const hasRecipe = Object.prototype.hasOwnProperty.call(input, 'recipeId')
  if (hasSections === hasRecipe || !hasRecipe && input.focusId !== undefined) throw new WorkspaceError('提供 sections 或 recipeId 其中一种；focusId 只能与 recipeId 一起提供')
  // Changing directions starts from the original content order, not the previous recipe's layout.
  const recipeWorkspace = {...workspace, pages: workspace.pages.map((page) => page.id === FROZEN_PAGE_ID ? draft.basePage : page)}
  const page = hasRecipe ? buildHomepageRecipe(recipeWorkspace, {recipeId: input.recipeId, focusId: input.focusId}) : setPageSections(workspace, FROZEN_PAGE_ID, input.sections).pages.find((item) => item.id === FROZEN_PAGE_ID)!
  current = {...draft, recipeId: hasRecipe ? input.recipeId as HomepageRecipeId : draft.recipeId, revision: draft.revision + 1, page}
  emit()
  return current
}

function pageFingerprint(page: Page | undefined): string {
  // Object property order is not a semantic design change; component/section array order is.
  return JSON.stringify(page ?? null, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)
}

export function describeHomepageDraft() {
  if (!current) return null
  const draft = current
  return {
    id: draft.id, recipeId: draft.recipeId, revision: draft.revision, pageId: FROZEN_PAGE_ID,
    sections: JSON.parse(JSON.stringify(draft.page.sections ?? [])) as NonNullable<Page['sections']>,
    effectiveOrder: draft.page.components.map((item) => item.id),
    components: draft.page.components.map((item) => ({id: item.id, type: item.type, ...(item.title ? {title: item.title} : {})})),
    conflict: pageFingerprint(getWorkspace().pages.find((page) => page.id === FROZEN_PAGE_ID)) !== pageFingerprint(draft.basePage),
    preview: {mode: 'layout-only' as const, limitations: ['只测量当前草稿的静态布局；组件业务数据和应用逻辑不运行。', '壁纸、动态特效、组件内部行为、对比度和审美未验证。', '草稿仅保留在当前会话内存，刷新后丢弃。']},
  }
}

/** 唯一正式写入入口：只合并首页结构，并沿用正式 store 的一次撤销。 */
export function applyHomepageDraft(raw: unknown): Workspace {
  const input = record(raw, ['draftId', 'expectedRevision'])
  const draft = requireDraft(input, true)
  const workspace = getWorkspace()
  const home = workspace.pages.find((page) => page.id === FROZEN_PAGE_ID)
  if (!home || pageFingerprint(home) !== pageFingerprint(draft.basePage)) throw new WorkspaceError('正式首页已变化，草稿未应用；取消草稿后基于最新首页重新生成')
  const components = new Map(home.components.map((item) => [item.id, item]))
  const ordered = {...home, components: draft.page.components.map((item) => components.get(item.id)!)}
  const next = setPageSections({...workspace, pages: workspace.pages.map((page) => page.id === FROZEN_PAGE_ID ? ordered : page)}, FROZEN_PAGE_ID, draft.page.sections ?? null)
  commit(next)
  current = null
  emit()
  return next
}
