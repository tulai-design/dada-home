import type { AiConfig } from './types'
import { AI_TOOLS, type ToolHost, executeTool } from './tools'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const SYSTEM_PROMPT =
  '你是个人首页的编辑。先给结论，再给依据。一段一事，句子短。不寒暄，不说「当然」「好的」，不用表情符号。只依据对话和页面里已有的订阅、待办、便签作答，不编造标题或数字。需要改待办、写便签、加书签或翻页时直接调用工具，完成后用一句话说明改了什么。用户用中文就用中文回答。'

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/\/chat\/completions$/.test(trimmed)) return trimmed
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export function aiReady(config: AiConfig): boolean {
  return Boolean(config.baseUrl.trim() && config.model.trim())
}

type StreamResult = {
  content: string
  toolCalls: ToolCall[]
}

async function postChat(
  config: AiConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  withTools = true,
): Promise<StreamResult> {
  const url = endpoint(config.baseUrl)
  if (!url) throw new Error('还没有填写 API 地址')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      stream: true,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      ...(withTools ? { tools: AI_TOOLS, tool_choice: 'auto' } : {}),
    }),
    signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      const json = JSON.parse(text) as { error?: { message?: string } }
      detail = json.error?.message ?? text.slice(0, 300)
    } catch {
      /* 忽略 */
    }
    const error = new Error(`${res.status} ${res.statusText}${detail ? ` · ${detail}` : ''}`)
    if (withTools && /tool|function/i.test(`${detail} ${res.status}`)) {
      ;(error as Error & { retryPlain?: boolean }).retryPlain = true
    }
    throw error
  }
  if (!res.body) throw new Error('响应没有内容')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const calls = new Map<number, ToolCall>()

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as {
          choices?: {
            delta?: {
              content?: string
              tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[]
            }
            message?: { content?: string; tool_calls?: ToolCall[] }
          }[]
        }
        const delta = json.choices?.[0]?.delta
        const message = json.choices?.[0]?.message
        const piece = delta?.content ?? message?.content ?? ''
        if (piece) {
          content += piece
          onDelta(piece)
        }
        const incoming = delta?.tool_calls ?? []
        for (const item of incoming) {
          const index = item.index ?? 0
          const current = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
          if (item.id) current.id = item.id
          if (item.function?.name) current.function.name += item.function.name
          if (item.function?.arguments) current.function.arguments += item.function.arguments
          calls.set(index, current)
        }
        if (message?.tool_calls?.length) {
          message.tool_calls.forEach((call, i) => calls.set(i, call))
        }
      } catch {
        /* 半截 JSON */
      }
    }
  }

  return {
    content,
    toolCalls: [...calls.values()].filter((call) => call.function.name),
  }
}

export async function streamChat(
  config: AiConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const result = await postChat(config, messages, onDelta, signal, false)
  return result.content
}

export async function runAgent(options: {
  config: AiConfig
  messages: ChatMessage[]
  host: ToolHost
  onDelta: (chunk: string) => void
  onTool: (info: { name: string; ok: boolean; text: string }) => void
  signal?: AbortSignal
  maxRounds?: number
}): Promise<string> {
  const { config, host, onDelta, onTool, signal } = options
  const messages = [...options.messages]
  const maxRounds = options.maxRounds ?? 4
  let useTools = true

  for (let round = 0; round < maxRounds; round += 1) {
    let result: StreamResult
    try {
      result = await postChat(config, messages, onDelta, signal, useTools)
    } catch (err) {
      if (useTools && (err as { retryPlain?: boolean }).retryPlain) {
        useTools = false
        result = await postChat(config, messages, onDelta, signal, false)
      } else {
        throw err
      }
    }

    if (!result.toolCalls.length) return result.content

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls,
    })

    for (const call of result.toolCalls) {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      let text = ''
      let ok = true
      try {
        text = executeTool(call.function.name, parsed, host)
      } catch (err) {
        ok = false
        text = err instanceof Error ? err.message : String(err)
      }
      onTool({ name: call.function.name, ok, text })
      messages.push({
        role: 'tool',
        tool_call_id: call.id || call.function.name,
        name: call.function.name,
        content: text,
      })
    }
  }

  return '工具调用次数用完了，先停在这里。'
}
