/** 聊天逻辑轮次与本地工具正文的纯数据边界；不依赖 React 或数据库。 */
export type ToolStep = {name: string; title: string; ok: boolean; text: string}
export type PendingApproval = {request: {tool: string; summary: string; remember?: string}}
export type Turn = {
  id: string; prompt: string; answer: string; reasoning: string; tools: ToolStep[]; error: string
  startedAt: number; endedAt?: number; aborted?: boolean; pending?: PendingApproval
  article?: {title: string; link: string; context: string}; convId?: string
}
export type Conv = {id: string; title: string; createdAt: number; updatedAt: number}
export type StoredTool = Omit<ToolStep, 'text'> & {detailId: string}
export type StoredTurn = Omit<Turn, 'tools' | 'convId'> & {convId: string; tools: StoredTool[]}
export type ToolDetail = {id: string; turnId: string; convId: string; index: number; text: string; bytes: number}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function invalid(message = '聊天记录格式损坏，未修改原始数据。'): never {throw new Error(message)}
function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key))) invalid()
}
export function toolDetailId(turnId: string, index: number): string {return JSON.stringify([turnId, index])}

export function validateConv(value: unknown): Conv {
  fields(value, ['id', 'title', 'createdAt', 'updatedAt'])
  if (!id(value.id) || typeof value.title !== 'string' || !time(value.createdAt) || !time(value.updatedAt)) invalid()
  return {id: value.id, title: value.title, createdAt: value.createdAt, updatedAt: value.updatedAt}
}

function baseTurn(value: unknown): Omit<StoredTurn, 'tools'> {
  fields(value, ['id','convId','prompt','answer','reasoning','tools','error','startedAt','endedAt','aborted','pending','article'])
  if (!id(value.id) || !id(value.convId) || !time(value.startedAt) || !Array.isArray(value.tools)) invalid()
  if (['prompt','answer','reasoning','error'].some(key => typeof value[key] !== 'string')) invalid()
  const result: Omit<StoredTurn, 'tools'> = {
    id: value.id, convId: value.convId, prompt: value.prompt as string, answer: value.answer as string,
    reasoning: value.reasoning as string, error: value.error as string, startedAt: value.startedAt,
  }
  if (value.endedAt !== undefined) {if (!time(value.endedAt)) invalid(); result.endedAt = value.endedAt}
  if (value.aborted !== undefined) {if (typeof value.aborted !== 'boolean') invalid(); result.aborted = value.aborted}
  if (value.article !== undefined) {
    const article = value.article
    fields(article, ['title','link','context'])
    if (typeof article.title !== 'string' || typeof article.link !== 'string' || typeof article.context !== 'string') invalid()
    result.article = {title: article.title, link: article.link, context: article.context}
  }
  if (value.pending !== undefined) {
    fields(value.pending, ['request'])
    const request = value.pending.request
    fields(request, ['tool','summary','remember'])
    if (typeof request.tool !== 'string' || typeof request.summary !== 'string' || (request.remember !== undefined && typeof request.remember !== 'string')) invalid()
    result.pending = {request: {tool: request.tool, summary: request.summary, ...(request.remember !== undefined ? {remember: request.remember} : {})}}
  }
  return result
}
function toolBase(value: Record<string, unknown>): Omit<ToolStep, 'text'> {
  if (typeof value.name !== 'string' || typeof value.title !== 'string' || typeof value.ok !== 'boolean') invalid()
  return {name: value.name, title: value.title, ok: value.ok}
}
export function validateTurn(value: unknown): Turn & {convId: string} {
  const base = baseTurn(value)
  const tools = (value as {tools: unknown[]}).tools.map(raw => {
    fields(raw, ['name','title','ok','text'])
    if (typeof raw.text !== 'string') invalid()
    return {...toolBase(raw), text: raw.text}
  })
  return {...base, tools}
}
export function validateStoredTurn(value: unknown): StoredTurn {
  const base = baseTurn(value)
  const tools = (value as {tools: unknown[]}).tools.map((raw, index) => {
    fields(raw, ['name','title','ok','detailId'])
    if (raw.detailId !== toolDetailId(base.id, index)) invalid('聊天工具引用的身份或顺序无效。')
    return {...toolBase(raw), detailId: raw.detailId as string}
  })
  return {...base, tools}
}
export function validateToolDetail(value: unknown): ToolDetail {
  fields(value, ['id','turnId','convId','index','text','bytes'])
  if (!id(value.turnId) || !id(value.convId) || !Number.isSafeInteger(value.index) || (value.index as number) < 0 || typeof value.text !== 'string') invalid()
  if (value.id !== toolDetailId(value.turnId, value.index as number) || value.bytes !== new TextEncoder().encode(value.text).byteLength) invalid('聊天工具正文的身份或字节数无效。')
  return {id: value.id as string, turnId: value.turnId, convId: value.convId, index: value.index as number, text: value.text, bytes: value.bytes as number}
}
export function splitTurn(value: Turn & {convId: string}): {turn: StoredTurn; details: ToolDetail[]} {
  const full = validateTurn(value)
  const details = full.tools.map((tool, index) => ({id: toolDetailId(full.id, index), turnId: full.id, convId: full.convId, index, text: tool.text, bytes: new TextEncoder().encode(tool.text).byteLength}))
  const tools = full.tools.map(({name, title, ok}, index) => ({name, title, ok, detailId: details[index].id}))
  return {turn: {...full, tools}, details}
}
export function hydrateTurn(value: StoredTurn, details: ReadonlyMap<string, ToolDetail>): Turn & {convId: string} {
  const turn = validateStoredTurn(value)
  const tools = turn.tools.map(({name, title, ok, detailId}, index) => {
    const raw = details.get(detailId)
    if (!raw) invalid('聊天工具正文缺失，已停止读取或同步，请保留原数据。')
    const detail = validateToolDetail(raw)
    if (detail.turnId !== turn.id || detail.convId !== turn.convId || detail.index !== index) invalid('聊天工具正文与轮次归属不一致。')
    return {name, title, ok, text: detail.text}
  })
  return {...turn, tools}
}
export function validateStoredChat(convs: unknown[], turns: unknown[], details: unknown[]): void {
  const convIds = new Set<string>(), turnIds = new Set<string>(), bodies = new Map<string, ToolDetail>(), referenced = new Set<string>()
  for (const raw of convs) {const conv = validateConv(raw); if (convIds.has(conv.id)) invalid('聊天会话标识重复。'); convIds.add(conv.id)}
  for (const raw of details) {const detail = validateToolDetail(raw); if (bodies.has(detail.id)) invalid('聊天工具正文标识重复。'); bodies.set(detail.id, detail)}
  for (const raw of turns) {
    const turn = validateStoredTurn(raw)
    if (turnIds.has(turn.id) || !convIds.has(turn.convId)) invalid('聊天轮次重复或缺少所属会话。')
    turnIds.add(turn.id)
    hydrateTurn(turn, bodies)
    for (const tool of turn.tools) referenced.add(tool.detailId)
  }
  if (referenced.size !== bodies.size) invalid('聊天工具正文没有对应的轮次引用。')
}
