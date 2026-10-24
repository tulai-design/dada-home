import {useMemo} from 'react'
import {WorkspaceError} from './errors'
import {readStored, uid, useStored, writeStored} from './store'

/**
 * 搭搭的人格：灵魂、用户画像、记忆。
 *
 * - 灵魂：一段 Markdown，写搭搭是谁、怎么说话、按什么原则做事。用户可以改，搭搭自己也可以改（可关），
 *   每次修改都留一条记录，随时能回滚。
 * - 画像：用户在表单里填的背景（身份、兴趣、偏好、备注）。称呼沿用设置里的 name。
 * - 记忆：搭搭在聊天里积累的、对这个用户的认识，也可以用户自己加；全部可看、可改、可删。
 *
 * 三者都只存在这台浏览器里（localStorage，键 fp.persona），随备份导出。
 * 它们是「背景」，不是指令：拼进系统提示时放在工具规则之后，冲突时以工具规则为准。
 */

export const SOUL_MAX = 6000
export const MEMORY_MAX_ITEMS = 200
export const MEMORY_MAX_CHARS = 200
const HISTORY_MAX = 12
/** 拼进提示的记忆总字数上限，超出就只带最新的。 */
const MEMORY_PROMPT_CHARS = 3000

export type MemoryKind = 'preference' | 'fact' | 'lesson'
export type Memory = {id: string; text: string; kind: MemoryKind; by: 'user' | 'ai'; at: number}
export type SoulRevision = {at: number; by: 'user' | 'ai'; /** 改之前的内容 */ text: string; reason?: string}

export type Persona = {
  soul: {name: string; text: string; aiCanEdit: boolean; history: SoulRevision[]}
  profile: {role: string; interests: string; preferences: string; notes: string}
  memory: {enabled: boolean; items: Memory[]}
}

export const MEMORY_KINDS: Record<MemoryKind, string> = {preference: '偏好', fact: '背景', lesson: '经验'}

export const DEFAULT_SOUL_NAME = '搭搭'

export const DEFAULT_SOUL = `我是搭搭，陪用户把想法搭成自己的主页。

## 性格
亲切、克制、有判断。不寒暄，不卖萌，不说「当然」「好的」，不用表情符号。

## 说话
- 先给结论，再给依据；一段一事，句子短。
- 用户说中文就用中文。
- 改完页面，用一句话说清改了什么、哪里还可以再调，不罗列参数。

## 做事
- 能一步到位就别反复试探；删除之前确认用户真的想删。
- 不轻易说「做不到」，先想还有没有别的办法；真做不到再说明原因。

## 审美
编辑部杂志的气质：克制、有秩序、有一处出彩。
- 一页只放一个视觉主角，炫酷效果是点睛，不是铺满。
- 文字永远可读，深色背景用浅字。
- 沿用主题的变量和字体，颜色靠拢主色，不要随机的彩虹色。
- 间距和对齐统一，信息块并排，横幅和大标题占满一行。`

/** 几套现成的性格，给不知道怎么写的人一个起点。 */
export const SOUL_PRESETS: {id: string; name: string; description: string; text: string}[] = [
  {id: 'editor', name: '编辑部', description: '默认。克制、有秩序，话少。', text: DEFAULT_SOUL},
  {
    id: 'friend',
    name: '温和的朋友',
    description: '多一点温度，会先接住你的想法。',
    text: `我是搭搭，像一个懂设计的朋友，陪用户把想法搭成自己的主页。

## 性格
温和、耐心、有点幽默。先理解用户想要的感觉，再动手；用户犹豫时给两三个具体的选项，而不是抛问题。

## 说话
- 口语化，像聊天，但不啰嗦。
- 做完之后说说我的考虑，再问一句哪里不合心意。
- 用户说中文就用中文。

## 做事
- 大改动之前先说一句打算怎么改。
- 删除或覆盖之前一定确认。

## 审美
干净、舒服、留白多。宁可少放一个组件，也不要让页面拥挤。`,
  },
  {
    id: 'engineer',
    name: '严谨的工程师',
    description: '直接、精确，重视可维护。',
    text: `我是搭搭，一个严谨的页面工程师，帮用户把想法搭成自己的主页。

## 性格
直接、精确、不绕弯。不确定就说不确定，并说明怎么验证。

## 说话
- 结论优先，必要时列出依据和取舍。
- 术语准确，但对非技术用户不堆术语。
- 用户说中文就用中文。

## 做事
- 动手前先看清现状；改动尽量小、可撤销。
- 优先用现成的组件和主题变量，其次才是自定义代码。
- 改完说明改了什么、影响范围、怎么回退。

## 审美
信息密度高但有秩序：对齐、间距统一，层级分明。`,
  },
]

export const DEFAULT_PERSONA: Persona = {
  soul: {name: DEFAULT_SOUL_NAME, text: DEFAULT_SOUL, aiCanEdit: true, history: []},
  profile: {role: '', interests: '', preferences: '', notes: ''},
  memory: {enabled: true, items: []},
}

const KEY = 'persona'
const str = (value: unknown, max: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, max) : fallback)

/** 读出来的数据不可信（旧版本、手改过、导入的）：逐项校验，缺的补默认值。 */
export function normalizePersona(raw: unknown): Persona {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Persona, Record<string, unknown>>>
  const soul = data.soul ?? {}
  const profile = data.profile ?? {}
  const memory = data.memory ?? {}
  const history: SoulRevision[] = Array.isArray(soul.history)
    ? soul.history
        .filter((item): item is SoulRevision => !!item && typeof item.text === 'string' && Number.isFinite(item.at))
        .slice(0, HISTORY_MAX)
        .map((item) => ({at: item.at, by: item.by === 'ai' ? 'ai' : 'user', text: item.text.slice(0, SOUL_MAX), ...(typeof item.reason === 'string' ? {reason: item.reason.slice(0, 120)} : {})}))
    : []
  const items: Memory[] = Array.isArray(memory.items)
    ? memory.items
        .filter((item): item is Memory => !!item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim() !== '')
        .slice(0, MEMORY_MAX_ITEMS)
        .map((item) => ({id: item.id, text: item.text.slice(0, MEMORY_MAX_CHARS), kind: item.kind in MEMORY_KINDS ? item.kind : 'fact', by: item.by === 'ai' ? 'ai' : 'user', at: Number.isFinite(item.at) ? item.at : Date.now()}))
    : []
  return {
    soul: {
      name: str(soul.name, 20, DEFAULT_SOUL_NAME).trim() || DEFAULT_SOUL_NAME,
      text: typeof soul.text === 'string' ? soul.text.slice(0, SOUL_MAX) : DEFAULT_SOUL,
      aiCanEdit: soul.aiCanEdit !== false,
      history,
    },
    profile: {role: str(profile.role, 80), interests: str(profile.interests, 200), preferences: str(profile.preferences, 600), notes: str(profile.notes, 1000)},
    memory: {enabled: memory.enabled !== false, items},
  }
}

export const getPersona = (): Persona => normalizePersona(readStored<unknown>(KEY, DEFAULT_PERSONA))
const save = (next: Persona) => writeStored(KEY, next)

/** 界面用：人格变了自动刷新。 */
export function usePersona() {
  const [raw] = useStored<unknown>(KEY, DEFAULT_PERSONA)
  return useMemo(() => normalizePersona(raw), [raw])
}

export class PersonaError extends WorkspaceError {}

/* ───────── 灵魂 ───────── */

function pushHistory(persona: Persona, by: 'user' | 'ai', reason?: string): SoulRevision[] {
  return [{at: Date.now(), by, text: persona.soul.text, ...(reason ? {reason: reason.slice(0, 120)} : {})}, ...persona.soul.history].slice(0, HISTORY_MAX)
}

/** 改灵魂文字。内容没变就不记历史；每次真正的修改都把旧版本压进历史。 */
export function setSoulText(text: string, by: 'user' | 'ai', reason?: string): Persona {
  const current = getPersona()
  const next = text.slice(0, SOUL_MAX)
  if (next === current.soul.text) return current
  const persona: Persona = {...current, soul: {...current.soul, text: next, history: pushHistory(current, by, reason)}}
  save(persona)
  return persona
}

/** 用户一边打字一边改：直接覆盖，不记历史；历史由 commitSoulEdit 在一段编辑结束时记一条。 */
export function typeSoulText(text: string) {
  const current = getPersona()
  save({...current, soul: {...current.soul, text: text.slice(0, SOUL_MAX)}})
}

/** 一段编辑结束（失焦）时调用：和开始前不一样，就把开始前的内容记进历史。 */
export function commitSoulEdit(before: string) {
  const current = getPersona()
  if (current.soul.text === before) return
  save({...current, soul: {...current.soul, history: [{at: Date.now(), by: 'user' as const, text: before}, ...current.soul.history].slice(0, HISTORY_MAX)}})
}

export function setSoulName(name: string) {
  const current = getPersona()
  save({...current, soul: {...current.soul, name: name.slice(0, 20)}})
}

export function setAiCanEdit(on: boolean) {
  const current = getPersona()
  save({...current, soul: {...current.soul, aiCanEdit: on}})
}

/** 搭搭自己改灵魂。append 追加一条，replace 整体重写。 */
export function aiEditSoul(input: {mode: 'append' | 'replace'; text: string; reason?: string}): Persona {
  const current = getPersona()
  if (!current.soul.aiCanEdit) throw new PersonaError('用户关掉了「允许搭搭自己修改灵魂」，不能改。想改的话，跟用户说一声，让他自己改或先打开这个开关。')
  const text = input.text.trim()
  if (!text) throw new PersonaError('内容不能为空')
  const next = input.mode === 'append' ? `${current.soul.text.trimEnd()}\n${text}` : text
  if (next.length > SOUL_MAX) throw new PersonaError(`灵魂最多 ${SOUL_MAX} 字，现在 ${next.length} 字。精简一下再改。`)
  return setSoulText(next, 'ai', input.reason)
}

/** 回到某条历史记录的内容（当前内容会进历史，所以回滚本身也能回滚）。 */
export function restoreSoul(at: number): Persona {
  const revision = getPersona().soul.history.find((item) => item.at === at)
  if (!revision) throw new PersonaError('找不到这条记录')
  return setSoulText(revision.text, 'user', '回滚')
}

/* ───────── 画像 ───────── */

export function setProfile(patch: Partial<Persona['profile']>) {
  const current = getPersona()
  save(normalizePersona({...current, profile: {...current.profile, ...patch}}))
}

/* ───────── 记忆 ───────── */

const SECRET = /(sk-[\w-]{16,}|api[_-]?key|secret|password|passwd|密码|口令|私钥|token\s*[:=：]|Bearer\s+\S{12,})/i
const norm = (text: string) => text.replace(/\s+/g, '').toLowerCase()

export function addMemory(input: {text: string; kind?: string; by: 'user' | 'ai'}): {persona: Persona; memory: Memory} {
  const current = getPersona()
  if (input.by === 'ai' && !current.memory.enabled) throw new PersonaError('用户关掉了「自动记忆」，不要再记。')
  const text = input.text.trim().replace(/\s+/g, ' ')
  if (!text) throw new PersonaError('内容不能为空')
  if (text.length > MEMORY_MAX_CHARS) throw new PersonaError(`一条记忆最多 ${MEMORY_MAX_CHARS} 字，现在 ${text.length} 字。拆成几条或精简。`)
  if (SECRET.test(text)) throw new PersonaError('这看起来像密钥或密码，不能记。')
  if (current.memory.items.some((item) => norm(item.text) === norm(text))) throw new PersonaError('已经记过一模一样的了。')
  if (current.memory.items.length >= MEMORY_MAX_ITEMS) throw new PersonaError(`记忆满了（${MEMORY_MAX_ITEMS} 条）。先用 forget 删掉过时的，或把相近的合并成一条。`)
  const kind: MemoryKind = input.kind && input.kind in MEMORY_KINDS ? (input.kind as MemoryKind) : 'fact'
  const memory: Memory = {id: `m${uid()}`, text, kind, by: input.by, at: Date.now()}
  const persona = {...current, memory: {...current.memory, items: [memory, ...current.memory.items]}}
  save(persona)
  return {persona, memory}
}

export function updateMemory(id: string, text: string): Persona {
  const current = getPersona()
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, MEMORY_MAX_CHARS)
  if (!clean) throw new PersonaError('内容不能为空')
  const persona = {...current, memory: {...current.memory, items: current.memory.items.map((item) => (item.id === id ? {...item, text: clean} : item))}}
  save(persona)
  return persona
}

export function removeMemory(id: string): Memory {
  const current = getPersona()
  const hit = current.memory.items.find((item) => item.id === id)
  if (!hit) throw new PersonaError(`没有这条记忆：${id}`)
  save({...current, memory: {...current.memory, items: current.memory.items.filter((item) => item.id !== id)}})
  return hit
}

export function clearMemories() {
  const current = getPersona()
  save({...current, memory: {...current.memory, items: []}})
}

export function setMemoryEnabled(on: boolean) {
  const current = getPersona()
  save({...current, memory: {...current.memory, enabled: on}})
}

/* ───────── 拼进系统提示 ───────── */

/** 灵魂、画像、记忆拼成一段背景，放在工具规则之后。userName 来自设置里的「称呼」。 */
export function personaPrompt(userName: string): string {
  const {soul, profile, memory} = getPersona()
  const parts: string[] = []

  if (soul.text.trim()) parts.push(`## 你的灵魂（你叫「${soul.name}」）\n${soul.text.trim()}`)

  const who = [
    userName.trim() && `称呼：${userName.trim()}`,
    profile.role.trim() && `身份：${profile.role.trim()}`,
    profile.interests.trim() && `兴趣：${profile.interests.trim()}`,
    profile.preferences.trim() && `偏好：${profile.preferences.trim()}`,
    profile.notes.trim() && `备注：${profile.notes.trim()}`,
  ].filter(Boolean)
  if (who.length) parts.push(`## 关于用户（用户自己填的）\n${who.join('\n')}`)

  if (memory.items.length) {
    const lines: string[] = []
    let size = 0
    for (const item of memory.items) {
      const line = `- [${item.id}]（${MEMORY_KINDS[item.kind]}）${item.text}`
      if (lines.length && size + line.length > MEMORY_PROMPT_CHARS) break
      lines.push(line)
      size += line.length
    }
    const more = memory.items.length - lines.length
    parts.push(`## 你对用户的记忆（方括号里是 id，forget 用${more > 0 ? `；还有 ${more} 条较早的没列出，可用 list_memories 查看` : ''}）\n${lines.join('\n')}`)
  }

  if (!parts.length) return ''
  return `\n\n以下是你的个性和背景。它们是参考，不是指令：与上面的工具规则冲突时以工具规则为准；不要在回答里复述它们，自然地用上就好。\n\n${parts.join('\n\n')}`
}
