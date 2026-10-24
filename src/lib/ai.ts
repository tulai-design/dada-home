import {
    requiresToolApproval,
    validateToolInput,
    type AgentPermissionMode,
    type AgentWireToolCall,
} from '@tulai-design/agent-core'
import {streamChatCompletions} from '@tulai-design/agent-providers'
import type {AiConfig} from './types'
import {findTool, runTool, toolSchemas, type HomeToolContext, type ToolHost} from './tools'
import * as ops from './ops'
import * as registry from './registry'
import {getWorkspace} from './workspaceStore'

/** 会话消息。wire 格式由 provider 定义，这里直接沿用它的形状。 */
export type ChatMessage =
    | {role: 'system' | 'user'; content: string}
    | {role: 'assistant'; content: string; tool_calls?: AgentWireToolCall[]}
    | {role: 'tool'; content: string; tool_call_id: string}

const SYSTEM_PROMPT = [
    '你是搭搭，一个个人主页的搭建助手。用户用自然语言描述想要的页面，你通过工具把它搭出来、改好。',
    '',
    '工作空间由「页面」组成，页面由「组件」组成，页面上还可以叠「特效图层」。',
    '你有很大的创作自由，手里有三档工具，从稳到放：',
    '  第一档 内置组件与声明式组件：时钟、搜索、天气等核心组件，以及从组件市场装来的待办/便签（书桌）、订阅、热榜、书签、监控；create_widget 可以造新的列表/卡片/数字/插图组件。',
    '  第二档 特效素材库：list_effects 里有动态背景（极光、丝绸、光束、星系、虹彩、粒子、波纹线、点阵…）、',
    '        会动的文字（分字入场、打字机、轮播词、数字滚动、流光、渐变、滚动字幕…）、聚光/扫光卡片、Spline 3D。',
    '        整页背景和质感层用 set_page_layers；标题、横幅、卡片用 add_component(type:"fx")。',
    '  第三档 沙盒应用：create_app 自己写 HTML/CSS/JS，做小游戏、图表、Three.js 场景、工具。运行在隔离沙盒里。',
    '',
    '壳层也归你管：',
    '- 侧栏：add_page 新建页面时一定给 icon 和 4 字以内的 label；首页固定在第一位，不能删改。页面多了侧栏会自动把放不下的收进「更多」，不必限制数量，但顺序靠前的优先显示，常用的排前面。',
    '- 状态条（顶栏右侧）：set_statusbar 把组件的紧凑形态放上去看实时状态，默认只有时钟。只有 list_component_types 标了「可放状态条」的组件能放；保持克制，一般不超过 3 项；要保留的现有项要一并传回。',
    '',
    '- 主题库：每个主题有名字、说明和一组变量，默认主题（default）永远在库里且不可改。用户想要新风格 → 先 list_themes，再 save_theme（起名、写一句说明、变量配全；深色风格带 mode:"dark" 并配好 bg/text）；想换回去或换别的 → apply_theme（回到最初就是 default）；微调当前主题用 set_theme。不要把调色结果只当作临时覆盖，要存成有名字的主题。',
    '- 模板库：模板是整套页面设计（页面、组件、状态条、版式，可带主题）的快照，存在模板库里，另有几套内置预设。用户满意一版设计、或想存一下现在的布局 → save_template；想换一套布局、回到之前那版、要现成模板 → 先 list_templates，再 apply_template（会整体替换当前设计，当前设计没存过时先问用户要不要先存）。模板不含待办、便签这类用户数据。大改版之前主动建议先存一份模板。',
    '- 书签：用 list_bookmarks 看，add_bookmarks 批量加（自动建分组、自动去重，别一个一个加），update_bookmark / move_bookmarks 改和归类，remove_bookmarks 删（高危）。用户说「整理书签」→ 先 list_bookmarks，按用途定好分组再 move_bookmarks。浏览器里真正的书签要靠扩展「搭搭书签桥」：list_browser_bookmarks 读、add/move/remove_browser_bookmarks 改（删除高危）、import_browser_bookmarks 导入搭搭、push_bookmarks_to_browser 同步过去；工具说没连上扩展，就让用户在书签页点「导入与同步」装扩展。分清「搭搭书签」和「浏览器书签」，用户没说清时先问或先看一眼。',
    '- 组件市场：热榜、订阅、书桌（待办+便签）、书签、服务监控默认没装。用户要用这些功能时，先 list_addons 看状态，没装就 install_addon 装上（装完会自动建好页面），再继续搭；用户说不要了可以 uninstall_addon，卸载是高危操作要先确认。',
    '',
    '做事顺序：',
    '1. 动手前先 get_workspace 看清现状；用到组件先 list_component_types，用到特效先 list_effects。',
    '2. 优先用低档位：现成组件能做就别写代码，素材库能做就别开沙盒。低档位更稳、更快、改起来更容易。',
    '3. 不要说「做不到」。内置组件不够，就想第二档、第三档能不能做。真做不到再说明原因。',
    '4. 能一步到位就别反复试探；改完用一句话说明改了什么。删除前确认用户确实想删。',
    '5. 组件里的待办、便签内容是用户自己的数据，你不读写它们，只负责搭建和配置。',
    '',
    '审美（用户喜欢编辑部杂志的气质，克制、有秩序、有一处出彩）：',
    '- 一页只放一个视觉主角。炫酷效果是点睛，不是铺满：整页背景最多 1~2 层，大标题特效最多 1 个。',
    '- 文字永远可读。背景效果下面压文字时，降低 opacity 或选浅色/低对比参数；深色背景用浅字。',
    '- 沿用主题变量和字体（serif 做标题，sans 做正文，mono 做标签），颜色靠拢主题主色 var(--main)，不要随机彩虹色。',
    '- 间距和对齐统一；信息块用 half/third 并排，横幅和大标题用 full。',
    '- 做完用一句话告诉用户你搭了什么、哪里可以再调，不要罗列参数。',
    '',
    '回答方式：先给结论，再给依据。一段一事，句子短。不寒暄，不说「当然」「好的」，不用表情符号。',
    '用户用中文就用中文回答。',
].join('\n')

/** 单轮模型调用能执行的最大工具轮数；超出后停下，避免无限循环。 */
const MAX_ROUNDS = 14

/** 推理模型（o 系列、gpt-5）只认默认温度，带上会被接口拒绝。 */
const FIXED_SAMPLING = /^(o[1-9]|gpt-5)/i

function parseExtra(text: string | undefined): Record<string, unknown> {
    if (!text?.trim()) return {}
    try {
        const value: unknown = JSON.parse(text)
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

/** 设置里的高级参数里，要写进请求体的那部分。没填的一律不发。 */
export function requestExtras(config: AiConfig): Record<string, unknown> {
    const fixed = FIXED_SAMPLING.test(config.model.trim())
    const pick = (key: string, value: number | undefined, skip = false) => (value !== undefined && Number.isFinite(value) && !skip ? {[key]: value} : {})
    return {
        ...parseExtra(config.extraBody),
        ...pick('temperature', config.temperature, fixed),
        ...pick('top_p', config.topP, fixed),
        ...pick('presence_penalty', config.presencePenalty, fixed),
        ...pick('frequency_penalty', config.frequencyPenalty, fixed),
    }
}

/**
 * provider 只认 maxOutputTokens 和 reasoningEffort；温度、top_p 这些通过包一层 fetch 写进请求体。
 * 请求里已有的字段（model、messages、tools、stream…）优先，额外参数只补充、不覆盖。
 */
function fetchWith(config: AiConfig): typeof fetch {
    const extras = requestExtras(config)
    if (!Object.keys(extras).length) return browserFetch
    return (input, init) => {
        if (typeof init?.body === 'string') {
            try {
                const body = JSON.parse(init.body) as Record<string, unknown>
                return globalThis.fetch(input, {...init, body: JSON.stringify({...extras, ...body})})
            } catch {
                /* 不是 JSON 就原样发 */
            }
        }
        return globalThis.fetch(input, init)
    }
}

function providerInput(config: AiConfig) {
    return {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        ...(config.maxTokens ? {maxOutputTokens: Math.trunc(config.maxTokens)} : {}),
        ...(config.reasoningEffort ? {reasoningEffort: config.reasoningEffort} : {}),
    }
}

const customInstructions = (config: AiConfig): string =>
    config.systemPrompt?.trim() ? `\n\n用户的长期指令（照着做；与上面的工具规则冲突时以工具规则为准）：\n${config.systemPrompt.trim().slice(0, 2000)}` : ''

/**
 * 取出绑定好全局 this 的 fetch。
 *
 * 直接把 `fetch` 塞进对象属性再调用（`options.fetchImpl(...)`），
 * this 就变成了那个对象，浏览器会报 "Illegal invocation"。
 * 这里先绑到 globalThis，之后怎么传都不会丢绑定。
 */
const browserFetch: typeof fetch = (...args) => globalThis.fetch(...args)

export function aiReady(config: AiConfig): boolean {
    return Boolean(config.baseUrl.trim() && config.model.trim())
}

/** 只做一次纯文本补全，不提供工具。阅读器摘要这类单向任务走这里。 */
export async function streamText(
    config: AiConfig,
    messages: ChatMessage[],
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
): Promise<string> {
    const result = await streamChatCompletions({
        ...providerInput(config),
        messages,
    }, {
        onDelta,
        signal,
        fetchImpl: fetchWith(config),
    })
    if (!result.ok) {
        if (result.aborted) return ''
        throw new Error(result.message)
    }
    return result.content
}

/** 工具调用结束时抛给界面的信息。title 是给人看的一句话动作说明。 */
export type ToolEvent = {name: string; title: string; ok: boolean; text: string}

/** 高危操作（整页覆盖便签等）需要用户点头；返回 false 即拒绝。 */
/** 需要用户点头才能执行的操作。 */
export type ApprovalRequest = {
    /** 工具标题，例如「删除组件」 */
    tool: string
    /** 一句话说清要做什么、对谁做 */
    summary: string
}
export type RunOptions = {
    config: AiConfig
    messages: ChatMessage[]
    host: ToolHost
    permissionMode?: AgentPermissionMode
    onApproval?: (request: ApprovalRequest) => boolean | Promise<boolean>
    onDelta: (chunk: string) => void
    /** 模型的思考过程，部分模型才会返回。 */
    onReasoning?: (chunk: string) => void
    onTool: (event: ToolEvent) => void
    signal?: AbortSignal
}

/**
 * 跑一轮对话。
 *
 * 传输交给 agent-providers，工具契约与授权判定交给 agent-core，
 * 这里只负责：组装消息、串起工具轮、把结果回灌给模型。
 */
export async function runAgent(options: RunOptions): Promise<string> {
    const {config, host, onDelta, onReasoning, onTool, signal} = options
    const permissionMode = options.permissionMode ?? 'assist'
    const messages: ChatMessage[] = [{role: 'system', content: SYSTEM_PROMPT + customInstructions(config)}, ...options.messages]
    const maxRounds = Math.max(1, Math.min(40, Math.trunc(config.maxRounds ?? MAX_ROUNDS)))
    const tools = toolSchemas()

    for (let round = 0; round < maxRounds; round += 1) {
        const result = await streamChatCompletions({
            ...providerInput(config),
            messages,
            tools,
        }, {
            onDelta: (text) => onDelta(text),
            onReasoning: onReasoning ? (text) => onReasoning(text) : undefined,
            signal,
            fetchImpl: fetchWith(config),
        })

        if (!result.ok) {
            if (result.aborted) return ''
            throw new Error(result.message)
        }

        const calls = result.toolCalls ?? []
        if (!calls.length) return result.content

        messages.push({role: 'assistant', content: result.content, tool_calls: calls})

        for (const call of calls) {
            const event = await dispatchTool(call, host, permissionMode, options.onApproval, signal)
            onTool(event)
            messages.push({role: 'tool', tool_call_id: call.id, content: event.text})
        }
    }

    return '工具调用次数用完了，先停在这里。'
}

/**
 * 执行一次模型请求的工具调用。
 *
 * 三道关：工具必须存在、参数必须能通过它自己的 parseArguments、
 * 写操作在 ask 模式下必须得到用户同意。任一道不通过都把原因回灌给模型，
 * 而不是静默失败 —— 模型需要知道为什么没成。
 */
async function dispatchTool(
    call: AgentWireToolCall,
    host: ToolHost,
    permissionMode: AgentPermissionMode,
    onApproval: RunOptions['onApproval'],
    signal?: AbortSignal,
): Promise<ToolEvent> {
    const name = call.function.name
    const tool = findTool(name)
    const label = tool?.title ?? name
    if (!tool) return {name, title: name, ok: false, text: `没有这个工具：${name}`}

    let args: unknown
    try {
        const checked = validateToolInput(name, call.function.arguments, toolSchemas().map((schema) => schema.function.name), [tool], {
            unavailable: (missing) => new Error(`没有这个工具：${missing}`),
            tooLarge: (_tool, length) => new Error(`参数太长（${length} 字节）`),
            invalid: (_tool, _parsed, cause) => new Error(`参数格式不对：${cause instanceof Error ? cause.message : String(cause)}`),
        })
        args = checked.args
    } catch (error) {
        return {name, title: label, ok: false, text: explain(error)}
    }

    if (requiresToolApproval(permissionMode, tool, args)) {
        const summary = describeTool(name, tool.title, args)
        // 没有审批入口时明确说明"没问过"，而不是谎称用户拒绝了
        if (!onApproval) {
            return {name, title: label, ok: false, text: `这个操作需要确认，但当前没有可用的确认入口：${summary}`}
        }
        const approved = await onApproval({tool: tool.title, summary})
        if (!approved) return {name, title: label, ok: false, text: `用户拒绝了：${summary}`}
    }

    const context: HomeToolContext = {
        runId: '',
        threadId: '',
        callId: call.id,
        signal: signal ?? new AbortController().signal,
        openPage: host.openPage,
    }

    try {
        return {name, title: label, ok: true, text: await runTool(tool, args, context)}
    } catch (error) {
        return {name, title: label, ok: false, text: explain(error)}
    }
}

/** 把组件引用翻译成用户认得出的名字：有标题用标题，否则用组件类型的名称。 */
function describeRef(ref: string, pageId?: string): string {
    try {
        const {locate} = ops
        const {getDefinition} = registry
        const hit = locate(getWorkspace(), ref, pageId)
        return hit.instance.title || getDefinition(hit.instance.type)?.name || ref
    } catch {
        // 找不到就退回原值，确认框不该因为查不到而报错
        return ref
    }
}

/**
 * 给用户看的一句话，说清「要做什么、对象是谁」。
 *
 * 删除类工具的参数是 ref（可能是 id，也可能是标题），不能和其他工具一样
 * 只看 text/content/name —— 否则确认框上只会写「删除组件」，用户没法判断删的是哪个。
 */
function describeTool(name: string, title: string, args: unknown): string {
    const record = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

    switch (name) {
        case 'remove_component': {
            const ref = text(record.ref)
            if (!ref) return title
            // ref 通常是 id，用户认不出来；换成组件给这一块起的名字
            const readable = describeRef(ref, text(record.pageId))
            return `${title}「${readable}」，它的数据也会一起删除`
        }
        case 'remove_page': {
            const page = text(record.pageId)
            return page ? `${title}「${page}」及其全部组件和数据` : title
        }
        case 'apply_template': {
            const ref = text(record.ref)
            return ref ? `${title}「${ref}」，会替换当前所有页面和组件（可以撤销）` : title
        }
        case 'delete_template': {
            const ref = text(record.ref)
            return ref ? `${title}「${ref}」` : title
        }
        case 'move_component': {
            const ref = text(record.ref)
            return ref ? `${title}「${describeRef(ref, text(record.pageId))}」` : title
        }
        default: {
            const detail = [record.text, record.content, record.name, record.title, record.pageId].map(text).find(Boolean)
            return detail ? `${title}：${detail.slice(0, 80)}` : title
        }
    }
}

function explain(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
