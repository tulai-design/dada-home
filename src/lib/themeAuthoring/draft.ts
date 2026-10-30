import {WorkspaceError} from '../errors'
import {assertThemeEntry} from '../themes'
import {instanceId, MAX_THEMES, activeTheme, type ThemeEntry, type Workspace} from '../workspace'
import {THEME_CATALOG_VERSION} from './catalog'
import {applyThemeOperations, type ThemePatchOperation} from './validation'

export type ThemeDraft = {
  id: string
  revision: number
  intent: 'derive' | 'edit'
  sourceId: string
  sourceFingerprint: string
  selectedIdAtCreate: string
  selectionGeneration: number
  dependenciesFingerprint: string
  theme: ThemeEntry
}
export type CreateThemeDraftInput = {from?: string; intent: 'derive' | 'edit'; name?: string}
export type UpdateThemeDraftInput = {draftId: string; expectedRevision: number; operations?: readonly ThemePatchOperation[]; name?: string; description?: string}
export type VersionedThemeDraftInput = {draftId: string; expectedRevision: number}

export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}
export function themeDependenciesFingerprint(theme: ThemeEntry): string {
  return fingerprint({catalogVersion: THEME_CATALOG_VERSION, skin: theme.skin, shell: theme.shell, rendererContractVersion: 1})
}
export function assertDraftInput(raw: unknown, keys: readonly string[]): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !keys.includes(key))) throw new WorkspaceError('主题草稿参数包含未知字段或不是对象')
}
function metadata(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || !empty && !value.trim() || value.trim().length > max) throw new WorkspaceError(`${name} 需要${empty ? '不超过' : '1–'}${max}字`)
  return value.trim()
}
export function createDraft(workspace: Workspace, input: CreateThemeDraftInput, selectionGeneration: number): ThemeDraft {
  assertDraftInput(input, ['from', 'intent', 'name'])
  if (input.intent !== 'derive' && input.intent !== 'edit') throw new WorkspaceError('intent 必须是 derive 或 edit')
  if (input.from !== undefined && (typeof input.from !== 'string' || !input.from.trim())) throw new WorkspaceError('from 必须是主题ID或名称')
  const source = input.from === undefined ? activeTheme(workspace) : workspace.themes.find(theme => theme.id === input.from || theme.name === input.from)
  if (!source) throw new WorkspaceError('来源主题不存在')
  if (input.intent === 'edit' && source.builtin) throw new WorkspaceError('内置主题不能直接编辑，请派生变体')
  assertThemeEntry(source)
  const theme = structuredClone(source)
  if (input.name !== undefined) theme.name = metadata(input.name, 'name', 20)
  else if (input.intent === 'derive') {
    const suffix = ' · 变体'
    theme.name = `${source.name.slice(0, 20 - suffix.length)}${suffix}`
  }
  delete theme.builtin
  assertThemeEntry(theme)
  return {id: instanceId('theme-draft'), revision: 1, intent: input.intent, sourceId: source.id,
    sourceFingerprint: fingerprint(source), selectedIdAtCreate: workspace.theme.active, selectionGeneration,
    dependenciesFingerprint: themeDependenciesFingerprint(source), theme}
}
export function requireDraftVersion(draft: ThemeDraft | null, input: VersionedThemeDraftInput): ThemeDraft {
  if (!draft || input.draftId !== draft.id) throw new WorkspaceError('draftId 与当前主题草稿不匹配')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== draft.revision) throw new WorkspaceError('expectedRevision 已过期；请读取最新主题草稿')
  return draft
}
export function patchDraft(draft: ThemeDraft, input: UpdateThemeDraftInput): ThemeDraft {
  assertDraftInput(input, ['draftId', 'expectedRevision', 'operations', 'name', 'description'])
  requireDraftVersion(draft, input)
  if (input.operations === undefined && input.name === undefined && input.description === undefined) throw new WorkspaceError('至少提供一项设计或名称说明修改')
  const theme = input.operations === undefined ? structuredClone(draft.theme) : applyThemeOperations(draft.theme, input.operations)
  if (input.name !== undefined) theme.name = metadata(input.name, 'name', 20)
  if (input.description !== undefined) theme.description = metadata(input.description, 'description', 120, true)
  assertThemeEntry(theme)
  return {...draft, revision: draft.revision + 1, theme}
}
export function draftConflict(workspace: Workspace, draft: ThemeDraft, selectionGeneration: number): string | null {
  const source = workspace.themes.find(theme => theme.id === draft.sourceId)
  if (!source || fingerprint(source) !== draft.sourceFingerprint) return '来源主题已删除或修改；草稿保留，请基于最新主题重新创建'
  if (workspace.theme.active !== draft.selectedIdAtCreate || selectionGeneration !== draft.selectionGeneration) return '正式主题选择已变化；草稿未应用'
  if (themeDependenciesFingerprint(source) !== draft.dependenciesFingerprint) return '主题目录或外壳能力已变化；请重新创建草稿'
  return null
}
export function buildDraftCommit(workspace: Workspace, draft: ThemeDraft, selectionGeneration: number): Workspace {
  const conflict = draftConflict(workspace, draft, selectionGeneration)
  if (conflict) throw new WorkspaceError(conflict)
  assertThemeEntry(draft.theme)
  const theme = structuredClone(draft.theme)
  if (draft.intent === 'derive') {
    if (workspace.themes.length >= MAX_THEMES) throw new WorkspaceError('主题库已满，请先删除不用的主题')
    const base = theme.name.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'theme'
    let id = base
    for (let n = 2; workspace.themes.some(item => item.id === id); n += 1) id = `${base}-${n}`
    theme.id = id
  } else theme.id = draft.sourceId
  delete theme.builtin
  const themes = draft.intent === 'derive' ? [...workspace.themes, theme] : workspace.themes.map(item => item.id === theme.id ? theme : item)
  return {...workspace, themes, theme: {...workspace.theme, active: theme.id}}
}
