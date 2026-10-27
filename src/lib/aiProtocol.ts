import type {AiConfig} from './types'

/** 自动选择仅针对明确支持 Messages 的地址，其他兼容网关继续用 Chat Completions。 */
export function resolveAiProtocol(config: Pick<AiConfig, 'protocol' | 'baseUrl' | 'model'>): 'openai' | 'anthropic' {
    if (config.protocol === 'openai' || config.protocol === 'anthropic') return config.protocol
    try {
        const url = new URL(config.baseUrl.trim())
        if (url.hostname === 'api.anthropic.com' || /\/messages\/?$/.test(url.pathname)) return 'anthropic'
        if (url.hostname === 'aihubmix.com' && /^(?:anthropic\/)?claude-/i.test(config.model.trim())) return 'anthropic'
    } catch {
        // 地址错误由 transport 返回；这里保持其他服务商的默认行为。
    }
    return 'openai'
}
