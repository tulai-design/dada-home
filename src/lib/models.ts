/**
 * AI 服务商预设 + 模型列表拉取。
 *
 * 搭搭只认「兼容 OpenAI 的接口」：GET {baseUrl}/models 拿模型，POST {baseUrl}/chat/completions 对话。
 * 预设只是帮用户少敲几个字，选了「自定义」仍然可以填任意地址。
 */

export type Provider = {
  id: string
  name: string
  baseUrl: string
  /** 切到这个服务商时默认选的模型，留空表示让用户自己选 */
  model: string
  /** @lobehub/icons 的 provider 名 */
  icon: string
  /** 不需要密钥（本地模型） */
  keyless?: boolean
}

export const PROVIDERS: Provider[] = [
  {id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', icon: 'openai'},
  {id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', icon: 'deepseek'},
  {id: 'moonshot', name: 'Moonshot（Kimi）', baseUrl: 'https://api.moonshot.cn/v1', model: '', icon: 'moonshot'},
  {id: 'zhipu', name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', icon: 'zhipu'},
  {id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', icon: 'qwen'},
  {id: 'siliconcloud', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: '', icon: 'siliconcloud'},
  {id: 'volcengine', name: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', icon: 'volcengine'},
  {id: 'google', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', icon: 'google'},
  {id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', model: '', icon: 'xai'},
  {id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: '', icon: 'mistral'},
  {id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', icon: 'groq'},
  {id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', icon: 'openrouter'},
  {id: 'ollama', name: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: '', icon: 'ollama', keyless: true},
]

export const CUSTOM_PROVIDER = 'custom'

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '')

/** 按接口地址认出是哪个服务商，认不出就是自定义。 */
export function detectProvider(baseUrl: string): Provider | undefined {
  const url = trimUrl(baseUrl).toLowerCase()
  if (!url) return undefined
  return PROVIDERS.find((p) => trimUrl(p.baseUrl).toLowerCase() === url)
}

/* ---------- 模型列表 ---------- */

const CACHE_PREFIX = 'fp.models.'

export function cachedModels(baseUrl: string): string[] {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + trimUrl(baseUrl))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveModels(baseUrl: string, list: string[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + trimUrl(baseUrl), JSON.stringify(list))
  } catch {
    /* 存不下就算了，下次再拉 */
  }
}

/** 各家返回格式不一：{data:[{id}]}、{models:[{name}]}、[...]。统一成名字数组。 */
export function parseModelList(json: unknown): string[] {
  const root = json as {data?: unknown; models?: unknown} | unknown[] | null
  const list = Array.isArray(root) ? root : Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : []
  const names = list
    .map((item) => {
      if (typeof item === 'string') return item
      const o = item as {id?: unknown; name?: unknown; model?: unknown}
      const v = o?.id ?? o?.model ?? o?.name
      return typeof v === 'string' ? v : ''
    })
    // Gemini 会返回 models/gemini-xxx
    .map((name) => name.replace(/^models\//, '').trim())
    .filter(Boolean)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {headers, signal})
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 120)
    throw new HttpError(res.status, detail)
  }
  return res.json()
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(status === 401 || status === 403 ? '密钥不对或没有权限' : status === 404 ? '这个地址没有模型列表接口' : `接口返回 ${status}${detail ? `：${detail}` : ''}`)
  }
}

/**
 * 拉取模型列表。浏览器直连被 CORS 拦住时，如果配置了同源的开发代理就走代理。
 * 只会走同源代理——密钥绝不交给第三方转发站。
 */
export async function fetchModels(baseUrl: string, apiKey: string, proxyTemplate: string, signal?: AbortSignal): Promise<string[]> {
  const base = trimUrl(baseUrl)
  if (!/^https?:\/\//i.test(base)) throw new Error('接口地址要以 http:// 或 https:// 开头')
  const url = `${base}/models`
  const headers: Record<string, string> = {accept: 'application/json'}
  if (apiKey.trim()) headers.authorization = `Bearer ${apiKey.trim()}`

  let json: unknown
  try {
    json = await getJson(url, headers, signal)
  } catch (err) {
    if (err instanceof HttpError || signal?.aborted) throw err
    // 网络层失败，多半是 CORS：试同源代理
    if (proxyTemplate.startsWith('/') && proxyTemplate.includes('{url}')) {
      json = await getJson(proxyTemplate.replace('{url}', encodeURIComponent(url)), headers, signal)
    } else {
      throw new Error('连不上：可能是地址不对，或这个服务不允许网页直接访问。可以手动输入模型名')
    }
  }
  const list = parseModelList(json)
  if (!list.length) throw new Error('没有拉到模型，可以手动输入模型名')
  saveModels(base, list)
  return list
}
