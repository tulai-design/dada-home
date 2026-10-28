import {hydrateTurn, splitTurn, validateStoredChat, validateStoredTurn, validateToolDetail, validateTurn} from './chatStorageSchema'
import {validateApplicationData, validateApplicationDataRecord} from './applicationDataSchema'
import {db, openDb, type DbOperation} from './db'
import {canonical, digest, exactKeys, object, type SyncRecord} from './syncProtocol'
import type {SyncScope} from './syncTypes'
import {WORKSPACE_VERSION} from './workspace'

const configNames = ['workspace', 'settings', 'search', 'persona', 'focusSettings', 'searchMode', 'sidebarAi', 'assistantPanelMode', 'range']
const settingsFields = ['name', 'city', 'lat', 'lon', 'theme', 'showFavicons', 'showSeconds', 'wallpaper', 'wallpaperIndex', 'wallpaperUrl', 'hotSource', 'hotBoards', 'ai']
const aiFields = ['model', 'protocol', 'temperature', 'topP', 'maxTokens', 'presencePenalty', 'frequencyPenalty', 'reasoningEffort', 'contextTurns', 'maxRounds', 'apiKey']
const secretFields = new Set(['apiKey', 'token', 'password', 'secret', 'keys'])
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
function fail(): never {throw new Error('同步记录的类型、目标或配置范围无效，没有应用任何数据。')}
const pick = (value: unknown, fields: string[]) => Object.fromEntries(object(value) ? Object.entries(value).filter(([key]) => fields.includes(key)) : [])

/** 已知凭据按字段投影；应用自由文本不声称能自动识别所有秘密。 */
function stripSecrets(value: unknown, fields = secretFields): unknown {
  if (Array.isArray(value)) return value.map(item => stripSecrets(item, fields))
  if (!object(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)).map(([key, item]) => [key, stripSecrets(item, fields)]))
}
function restoreSecrets(remote: unknown, local: unknown, withSecrets: boolean, fields = secretFields): unknown {
  if (Array.isArray(remote)) {
    const byId = new Map((Array.isArray(local) ? local : []).filter(item => object(item) && nonempty(item.id)).map(item => [(item as Record<string, unknown>).id, item]))
    // 数组只有明确身份才能恢复本机凭据，绝不能把上一项的密钥按位置交给另一项。
    return remote.map(item => restoreSecrets(item, object(item) && nonempty(item.id) ? byId.get(item.id) : undefined, withSecrets, fields))
  }
  if (!object(remote)) return remote
  const mine = object(local) ? local : {}, out: Record<string, unknown> = Object.create(null)
  for (const [key, item] of Object.entries(remote)) out[key] = restoreSecrets(item, mine[key], withSecrets, fields)
  for (const key of fields) if ((!withSecrets || !own(out, key)) && own(mine, key)) out[key] = mine[key]
  return out
}
export function project(id: string, full: unknown, scope: SyncScope, secrets: boolean): unknown {
  let value = full
  if (id === 'config:workspace') {
    if (!object(full)) fail()
    value = Object.fromEntries(Object.entries(full).filter(([key]) => key !== 'network'))
  } else if (id === 'config:settings') {
    value = pick(full, settingsFields)
    if (object(full) && own(full, 'ai')) (value as Record<string, unknown>).ai = pick(full.ai, aiFields)
  } else if (id === 'config:search') value = pick(full, ['provider', 'keys'])
  else if (id === 'config:persona' && scope === 'configuration') {
    if (!object(full)) fail()
    value = {soul: pick(full.soul, ['name', 'text', 'aiCanEdit']), memory: pick(full.memory, ['enabled'])}
  }
  return secrets ? value : stripSecrets(value, id === 'component:@shared.icsSubs' ? new Set(['url', ...secretFields]) : secretFields)
}

function target(id: string, scope: SyncScope): {kind: string; name: string; key?: string} {
  const colon = id.indexOf(':'); if (colon < 1) return fail()
  const kind = id.slice(0, colon), name = id.slice(colon + 1)
  if (!nonempty(name) || name.length > 1000) return fail()
  if (kind === 'config' && (configNames.includes(name) || (scope === 'full' && name === 'read'))) return {kind, name, key: `fp.${name}`}
  if (scope === 'full' && ['component', 'conversation', 'turn'].includes(kind)) return {kind, name}
  if (scope === 'full' && kind === 'app') {
    validateApplicationDataRecord({k: name, v: {}})
    return {kind, name}
  }
  return fail()
}
function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || !exactKeys(value, names)) fail()
}
const oneOf = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value)
function strings(value: unknown): boolean {return Array.isArray(value) && value.every(item => typeof item === 'string')}
function uniqueRows(value: unknown, validate: (row: Record<string, unknown>) => void): void {
  if (!Array.isArray(value)) fail()
  const seen = new Set<string>()
  for (const row of value) {
    if (!object(row) || !nonempty(row.id) || seen.has(row.id)) fail()
    seen.add(row.id)
    validate(row)
  }
}
function component(value: unknown): void {
  if (!object(value) || !nonempty(value.id) || !nonempty(value.type) || !object(value.config)) fail()
  if (value.title !== undefined && typeof value.title !== 'string') fail()
  if (value.span !== undefined && !oneOf(value.span, ['full', 'half', 'third', 'two-thirds'])) fail()
  if (value.look !== undefined && !object(value.look)) fail()
}
function layout(value: unknown): void {
  fields(value, ['columns', 'maxWidth'])
  if (!Number.isSafeInteger(value.columns) || (value.columns as number) < 1 || !finite(value.maxWidth) || value.maxWidth === 0) fail()
}
function pages(value: unknown): void {
  uniqueRows(value, page => {
    if (typeof page.name !== 'string' || typeof page.label !== 'string') fail()
    uniqueRows(page.components, component)
    if (page.css !== undefined && typeof page.css !== 'string') fail()
    if (page.dock !== undefined && typeof page.dock !== 'boolean') fail()
    if (page.align !== undefined && !oneOf(page.align, ['start', 'center'])) fail()
    if (page.icon !== undefined && typeof page.icon !== 'string') fail()
    if (page.wallpaper !== undefined) {
      const wall = page.wallpaper
      if (!object(wall) || !oneOf(wall.mode, ['off', 'unsplash', 'custom']) || (wall.mode === 'unsplash' && !finite(wall.index)) || (wall.mode === 'custom' && typeof wall.url !== 'string')) fail()
    }
    if (page.layers !== undefined && (!Array.isArray(page.layers) || page.layers.some(layer => !object(layer) || !nonempty(layer.effect) || !object(layer.params)))) fail()
    if (page.sections !== undefined) uniqueRows(page.sections, section => {
      if (section.title !== undefined && typeof section.title !== 'string') fail()
      const ids = new Set((page.components as Record<string, unknown>[]).map(item => item.id))
      const refs = section.kind === 'split' ? [...(Array.isArray(section.primary) ? section.primary : []), ...(Array.isArray(section.secondary) ? section.secondary : [])] : section.items
      if (!oneOf(section.kind, ['hero', 'section', 'split']) || !strings(refs) || (refs as string[]).some(id => !ids.has(id)) || new Set(refs as string[]).size !== (refs as string[]).length) fail()
      if (section.kind === 'split' && (!strings(section.primary) || !strings(section.secondary))) fail()
    })
  })
}
function applications(value: unknown): void {
  uniqueRows(value, app => {
    component(app.instance)
    if ((app.instance as Record<string, unknown>).id !== app.id || !oneOf((app.instance as Record<string, unknown>).type, ['app', 'applet']) || ['description', 'group'].some(key => typeof app[key] !== 'string') || !oneOf(app.openMode, ['modal', 'drawer', 'page']) || typeof app.dock !== 'boolean' || typeof app.status !== 'boolean') fail()
    if (app.settings !== undefined && (!object(app.settings) || Object.values(app.settings).some(item => !['string', 'boolean', 'number'].includes(typeof item)))) fail()
    if (app.settingsSchema !== undefined && !object(app.settingsSchema)) fail()
  })
}
export function validateRecord(id: string, value: unknown, deleted: boolean, scope: SyncScope): void {
  const {kind, name} = target(id, scope)
  if (deleted) return
  canonical(value)
  if (kind === 'component') return
  if (kind === 'app') {validateApplicationData(value); return}
  if (kind === 'conversation') {
    fields(value, ['id', 'title', 'createdAt', 'updatedAt'])
    if (value.id !== name || typeof value.title !== 'string' || !finite(value.createdAt) || !finite(value.updatedAt)) fail()
  } else if (kind === 'turn') {
    fields(value, ['id', 'convId', 'prompt', 'answer', 'reasoning', 'tools', 'error', 'startedAt', 'endedAt', 'aborted', 'article', 'pending'])
    if (value.id !== name || !nonempty(value.convId) || ['prompt', 'answer', 'reasoning', 'error'].some(key => typeof value[key] !== 'string') || !finite(value.startedAt) || !finite(value.endedAt) || !Array.isArray(value.tools) || (value.aborted !== undefined && typeof value.aborted !== 'boolean')) fail()
    for (const tool of value.tools as unknown[]) {
      fields(tool, ['name', 'title', 'text', 'ok'])
      if (['name', 'title', 'text'].some(key => typeof tool[key] !== 'string') || typeof tool.ok !== 'boolean') fail()
    }
    if (value.article !== undefined) {fields(value.article, ['title', 'link', 'context']); if (Object.values(value.article).length !== 3 || Object.values(value.article).some(item => typeof item !== 'string')) fail()}
    if (value.pending !== undefined) {fields(value.pending, ['request']); fields(value.pending.request, ['tool', 'summary']); if (typeof value.pending.request.tool !== 'string' || typeof value.pending.request.summary !== 'string') fail()}
  } else if (name === 'workspace') {
    fields(value, ['version', 'pages', 'theme', 'themes', 'layout', 'widgets', 'applications', 'statusbar', 'dock', 'addons', 'templates', 'template'])
    if (value.version !== WORKSPACE_VERSION || !Array.isArray(value.pages) || !value.pages.length || !object(value.theme)) fail()
    for (const key of ['themes', 'widgets', 'statusbar', 'addons', 'templates']) if (!Array.isArray(value[key])) fail()
    pages(value.pages)
    layout(value.layout)
    if (!nonempty(value.theme.active) || !oneOf(value.theme.mode, ['light', 'dark']) || !oneOf(value.theme.base, ['light', 'dark']) || !strings(value.addons)) fail()
    uniqueRows(value.themes, theme => {
      if (typeof theme.name !== 'string' || typeof theme.description !== 'string') fail()
      for (const key of ['overrides', 'light', 'dark']) if ((key === 'overrides' || theme[key] !== undefined) && (!object(theme[key]) || Object.values(theme[key]).some(item => typeof item !== 'string'))) fail()
    })
    uniqueRows(value.widgets, widget => {if (typeof widget.name !== 'string' || typeof widget.description !== 'string' || !oneOf(widget.layout, ['list', 'cards', 'stats', 'text', 'links', 'art']) || !object(widget.source)) fail()})
    uniqueRows(value.statusbar, component)
    uniqueRows(value.templates, template => {
      if (typeof template.name !== 'string' || typeof template.description !== 'string' || !finite(template.createdAt) || !finite(template.updatedAt) || !object(template.snapshot)) fail()
      pages(template.snapshot.pages); layout(template.snapshot.layout)
      if (!strings(template.snapshot.addons) || !Array.isArray(template.snapshot.widgets) || !Array.isArray(template.snapshot.statusbar)) fail()
      if (template.snapshot.applications !== undefined) applications(template.snapshot.applications)
    })
    if (value.applications !== undefined) applications(value.applications)
    if (value.template !== undefined && typeof value.template !== 'string') fail()
    if (value.dock !== undefined && !object(value.dock)) fail()
  } else if (name === 'settings') {
    fields(value, settingsFields)
    for (const key of ['name', 'city', 'wallpaperUrl', 'hotSource']) if (value[key] !== undefined && typeof value[key] !== 'string') fail()
    for (const key of ['lat', 'lon', 'wallpaperIndex']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) fail()
    for (const key of ['showFavicons', 'showSeconds']) if (value[key] !== undefined && typeof value[key] !== 'boolean') fail()
    if (value.theme !== undefined && !oneOf(value.theme, ['light', 'dark'])) fail()
    if (value.wallpaper !== undefined && !oneOf(value.wallpaper, ['unsplash', 'custom', 'off'])) fail()
    if (value.hotBoards !== undefined && !strings(value.hotBoards)) fail()
    if (value.ai !== undefined) {
      fields(value.ai, aiFields)
      for (const [key, item] of Object.entries(value.ai)) {
        if (['model', 'apiKey'].includes(key) ? typeof item !== 'string' : key === 'protocol' ? !oneOf(item, ['auto', 'openai', 'anthropic']) : key === 'reasoningEffort' ? !oneOf(item, ['low', 'medium', 'high']) : typeof item !== 'number' || !Number.isFinite(item)) fail()
      }
    }
  } else if (name === 'search') {
    fields(value, ['provider', 'keys'])
    if (!oneOf(value.provider, ['off', 'tavily', 'firecrawl', 'searxng', 'exa', 'brave'])) fail()
    if (value.keys !== undefined && (!object(value.keys) || Object.entries(value.keys).some(([key, item]) => !['off', 'tavily', 'firecrawl', 'searxng', 'exa', 'brave'].includes(key) || typeof item !== 'string'))) fail()
  } else if (name === 'persona') {
    fields(value, scope === 'full' ? ['soul', 'memory', 'profile'] : ['soul', 'memory'])
    fields(value.soul, scope === 'full' ? ['name', 'text', 'aiCanEdit', 'history'] : ['name', 'text', 'aiCanEdit'])
    fields(value.memory, scope === 'full' ? ['enabled', 'items'] : ['enabled'])
    // 配置范围删除性格后，画像/历史/记忆仍属于完整业务记录，不补回已删除的可携配置。
    const privateOnly = scope === 'full' && !own(value.soul, 'name') && !own(value.soul, 'text') && !own(value.soul, 'aiCanEdit') && !own(value.memory, 'enabled')
    if (!privateOnly && (typeof value.soul.name !== 'string' || typeof value.soul.text !== 'string' || typeof value.soul.aiCanEdit !== 'boolean' || typeof value.memory.enabled !== 'boolean')) fail()
    if (scope === 'full') {
      fields(value.profile, ['role', 'interests', 'preferences', 'notes'])
      if (['role', 'interests', 'preferences', 'notes'].some(key => typeof (value.profile as Record<string, unknown>)[key] !== 'string') || !Array.isArray(value.soul.history)) fail()
      for (const row of value.soul.history) {
        fields(row, ['at', 'by', 'text', 'reason'])
        if (!finite(row.at) || !oneOf(row.by, ['user', 'ai']) || typeof row.text !== 'string' || (row.reason !== undefined && typeof row.reason !== 'string')) fail()
      }
      uniqueRows(value.memory.items, row => {
        fields(row, ['id', 'text', 'kind', 'by', 'at'])
        if (typeof row.text !== 'string' || !oneOf(row.kind, ['fact', 'preference', 'lesson']) || !oneOf(row.by, ['user', 'ai']) || !finite(row.at)) fail()
      })
    }
  } else if (name === 'focusSettings') {
    fields(value, ['focusMin', 'shortMin', 'longMin', 'longEvery', 'autoBreak', 'alert'])
    if (['focusMin', 'shortMin', 'longMin', 'longEvery'].some(key => !finite(value[key])) || ['autoBreak', 'alert'].some(key => typeof value[key] !== 'boolean')) fail()
  } else if (name === 'searchMode') {if (typeof value !== 'string' || !value || value.length > 100) fail()}
  else if (name === 'sidebarAi') {if (!oneOf(value, ['full', 'drawer', 'split'])) fail()}
  else if (name === 'assistantPanelMode') {if (!oneOf(value, ['drawer', 'split'])) fail()}
  else if (name === 'range') {if (!oneOf(value, ['1h', '12h', '24h', '1w'])) fail()}
  else if (name === 'read') {if (!strings(value)) fail()}
}
export function validateAssociations(records: Record<string, SyncRecord>): void {
  for (const [id, rec] of Object.entries(records)) if (id.startsWith('turn:') && !rec.deleted) {
    const convId = (rec.value as Record<string, unknown>).convId
    if (!records[`conversation:${String(convId)}`] || records[`conversation:${String(convId)}`].deleted) throw new Error('同步聊天轮次缺少对应会话，没有应用任何数据。')
  }
}
export type LocalData = {values: Map<string, unknown>; full: Map<string, unknown>; deferred: Set<string>; fingerprint: string}
/** 删除配置后，保留的本机字段不是一个新的可携记录，不能复活墓碑。 */
function onlyLocalConfig(id: string, value: unknown, full: unknown): boolean {
  if (!object(value) || !object(full)) return false
  if (id === 'config:workspace') return own(full, 'network') && exactKeys(full, ['network']) && Array.isArray(full.network)
  if (id === 'config:persona') return (own(full, 'profile') || object(full.soul) && own(full.soul, 'history') || object(full.memory) && own(full.memory, 'items')) && Object.keys(value).every(key => ['soul', 'memory'].includes(key)) && Object.values(value).every(item => object(item) && !Object.keys(item).length)
  if (id === 'config:settings') return Object.keys(full).length > 0 && Object.keys(value).every(key => key === 'ai') && (!own(value, 'ai') || object(value.ai) && Object.keys(value.ai).every(key => key === 'apiKey'))
  if (id === 'config:search') return Object.keys(full).length > 0 && Object.keys(value).every(key => key === 'keys')
  return false
}
export async function collect(scope: SyncScope, secrets: boolean): Promise<LocalData> {
  const values = new Map<string, unknown>(), full = new Map<string, unknown>(), deferred = new Set<string>(), raw: Record<string, string> = Object.create(null)
  const put = (id: string, value: unknown) => {const projected = project(id, value, scope, secrets); full.set(id, value); if (onlyLocalConfig(id, projected, value)) return; validateRecord(id, projected, false, scope); values.set(id, projected)}
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key) continue
    let id: string | undefined
    if (key.startsWith('fp.') && configNames.includes(key.slice(3))) id = `config:${key.slice(3)}`
    if (scope === 'full' && key === 'fp.read') id = 'config:read'
    if (!id) continue
    const text = localStorage.getItem(key); if (text === null) continue
    raw[key] = text
    let value: unknown
    try {value = JSON.parse(text)} catch {throw new Error(`本机配置「${key}」不是完整 JSON，同步已停止。`)}
    put(id, value)
  }
  let database: unknown = null
  if (scope === 'full') {
    if (!await openDb()) throw new Error('此浏览器无法读取本地数据库，同步已停止。')
    const data = await db.snapshot(); database = data
    validateStoredChat(data.convs, data.turns, data.toolDetails)
    const details = new Map(data.toolDetails.map(value => {const row = validateToolDetail(value); return [row.id, row]}))
    for (const row of data.apps) {const app = validateApplicationDataRecord(row); put(`app:${app.k}`, app.v)}
    for (const row of data.kv) put(`component:${row.k}`, row.v)
    for (const row of data.convs) {if (!object(row) || !nonempty(row.id)) fail(); put(`conversation:${row.id}`, row)}
    for (const stored of data.turns) {
      const row = hydrateTurn(validateStoredTurn(stored), details)
      full.set(`turn:${row.id}`, row)
      if (row.endedAt === undefined) {deferred.add(`turn:${row.id}`); if (nonempty(row.convId)) deferred.add(`conversation:${row.convId}`); continue}
      put(`turn:${row.id}`, row)
    }
  }
  return {values, full, deferred, fingerprint: await digest({raw, database})}
}
function applyConfig(name: string, incoming: unknown, local: unknown, scope: SyncScope, secrets: boolean): unknown {
  const mine = object(local) ? local : {}
  const value = object(incoming) ? incoming : {}
  if (name === 'workspace') return incoming === undefined ? (mine.network === undefined ? undefined : {network: mine.network}) : {...value, network: mine.network ?? []}
  if (name === 'settings') {
    const retained = Object.fromEntries(Object.entries(mine).filter(([key]) => !settingsFields.includes(key)))
    const ai = object(mine.ai) ? mine.ai : {}, remoteAi = object(value.ai) ? value.ai : {}
    const mergedAi = {...Object.fromEntries(Object.entries(ai).filter(([key]) => !aiFields.includes(key))), ...remoteAi}
    if ((!secrets || !own(remoteAi, 'apiKey')) && own(ai, 'apiKey')) mergedAi.apiKey = ai.apiKey
    const result = {...retained, ...value, ...(Object.keys(mergedAi).length ? {ai: mergedAi} : {})}
    return incoming === undefined && !Object.keys(result).length ? undefined : result
  }
  if (name === 'search') {
    const result = {...(own(mine, 'urls') ? {urls: mine.urls} : {}), ...value, ...((!secrets || !own(value, 'keys')) && own(mine, 'keys') ? {keys: mine.keys} : {})}
    return incoming === undefined && !Object.keys(result).length ? undefined : result
  }
  if (name === 'persona' && scope === 'configuration') {
    const soul = object(mine.soul) ? mine.soul : {}, memory = object(mine.memory) ? mine.memory : {}
    if (incoming === undefined && !own(mine, 'profile') && !own(soul, 'history') && !own(memory, 'items')) return undefined
    return {...(own(mine, 'profile') ? {profile: mine.profile} : {}), soul: {...(own(soul, 'history') ? {history: soul.history} : {}), ...value.soul as object}, memory: {...(own(memory, 'items') ? {items: memory.items} : {}), ...value.memory as object}}
  }
  return incoming
}
export function changes(records: [string, SyncRecord][], local: LocalData, scope: SyncScope, secrets: boolean): {local: Record<string, string | null>; operations: DbOperation[]} {
  const patch: Record<string, string | null> = Object.create(null), operations: DbOperation[] = []
  const replacedTurns = new Set(records.filter(([id]) => id.startsWith('turn:')).map(([id]) => id))
  for (const [id, rec] of records) {
    const {kind, name, key} = target(id, scope)
    const old = local.full.get(id)
    if (key) {
      const next = applyConfig(name, rec.deleted ? undefined : rec.value, old, scope, secrets)
      patch[key] = next === undefined ? null : JSON.stringify(next)
    } else if (kind === 'turn') {
      // wire 以完整轮次合并，物理头与正文在同一提交边界替换，避免混合不同版本。
      if (old !== undefined) {
        const previous = splitTurn(validateTurn(old))
        operations.push(...previous.details.map(detail => ({store: 'toolDetails' as const, type: 'delete' as const, key: detail.id})))
      }
      if (rec.deleted) operations.push({store: 'turns', type: 'delete', key: name})
      else {
        const next = splitTurn(validateTurn(restoreSecrets(rec.value, old, secrets)))
        operations.push({store: 'turns', type: 'put', value: next.turn}, ...next.details.map(value => ({store: 'toolDetails' as const, type: 'put' as const, value})))
      }
    } else {
      if (kind === 'conversation' && rec.deleted) {
        // 关联校验保证远端不会保留此会话的轮次；同步删除时也清理其私有正文。
        for (const [turnId, value] of local.full) if (turnId.startsWith('turn:') && !replacedTurns.has(turnId) && object(value) && value.convId === name) {
          const previous = splitTurn(validateTurn(value))
          operations.push({store: 'turns', type: 'delete', key: previous.turn.id}, ...previous.details.map(detail => ({store: 'toolDetails' as const, type: 'delete' as const, key: detail.id})))
        }
      }
      const store = kind === 'app' ? 'apps' : kind === 'component' ? 'kv' : 'convs'
      if (rec.deleted) operations.push({store, type: 'delete', key: name})
      else {
        const next = restoreSecrets(rec.value, old, secrets, id === 'component:@shared.icsSubs' ? new Set(['url', ...secretFields]) : secretFields)
        operations.push({store, type: 'put', value: store === 'apps' ? validateApplicationDataRecord({k: name, v: next}) : store === 'kv' ? {k: name, v: next} : next})
      }
    }
  }
  return {local: patch, operations}
}
