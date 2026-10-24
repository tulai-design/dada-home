import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ActionIcon, Flexbox, InputNumber, Select, Text, TextArea} from '@lobehub/ui'
import {ChevronUp, RefreshCw, RotateCcw} from 'lucide-react'
import type {AiConfig} from '../lib/types'
import {CUSTOM_PROVIDER, PROVIDERS, cachedModels, detectProvider, fetchModels} from '../lib/models'
import {Group, Row, TextRow} from './ios'
import {ModelIcon, ProviderIcon} from './ModelIcons'

type Props = {
  ai: AiConfig
  /** 取数代理模板，只用于绕开 CORS 拉模型列表 */
  proxy: string
  onChange: (next: AiConfig) => void
}

type Status = {kind: 'idle' | 'loading' | 'ok' | 'error'; text?: string}

/**
 * 搭搭 AI 的接入设置：先选服务商，填密钥，模型从接口拉回来直接选；
 * 列表里没有的模型也可以在下拉框里直接输入。
 */
export function AiSettings({ai, proxy, onChange}: Props) {
  const provider = detectProvider(ai.baseUrl)
  const [models, setModels] = useState<string[]>(() => cachedModels(ai.baseUrl))
  const [status, setStatus] = useState<Status>({kind: 'idle'})
  const [search, setSearch] = useState('')
  const seq = useRef(0)
  const canFetch = /^https?:\/\//i.test(ai.baseUrl.trim()) && (Boolean(ai.apiKey.trim()) || Boolean(provider?.keyless))

  const load = useCallback(async () => {
    const mine = ++seq.current
    setStatus({kind: 'loading'})
    try {
      const list = await fetchModels(ai.baseUrl, ai.apiKey, proxy)
      if (mine !== seq.current) return
      setModels(list)
      setStatus({kind: 'ok', text: `已拉取 ${list.length} 个模型`})
    } catch (err) {
      if (mine !== seq.current) return
      setStatus({kind: 'error', text: err instanceof Error ? err.message : String(err)})
    }
  }, [ai.baseUrl, ai.apiKey, proxy])

  // 地址或密钥变了（停手半秒后）自动重新拉；缓存里有的先顶着用
  useEffect(() => {
    setModels(cachedModels(ai.baseUrl))
    if (!canFetch) {
      seq.current++
      setStatus({kind: 'idle'})
      return
    }
    const timer = window.setTimeout(() => void load(), 600)
    return () => window.clearTimeout(timer)
  }, [ai.baseUrl, ai.apiKey, canFetch, load])

  const options = useMemo(() => {
    const ids = [...models]
    const extra = [ai.model, search.trim()].filter((id) => id && !ids.includes(id))
    return [...new Set(extra), ...ids].map((id) => ({
      value: id,
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <ModelIcon model={id} size={18} />
          <span>{id}</span>
        </Flexbox>
      ),
    }))
  }, [models, ai.model, search])

  const pickProvider = (id: string) => {
    if (id === CUSTOM_PROVIDER) {
      onChange({...ai, baseUrl: '', model: ''})
      return
    }
    const next = PROVIDERS.find((p) => p.id === id)
    if (next) onChange({...ai, baseUrl: next.baseUrl, model: next.model})
  }

  const footer =
    status.kind === 'error' ? (
      <Text type="danger">{status.text}。也可以在上面的下拉框里直接输入模型名。</Text>
    ) : status.kind === 'ok' ? (
      `${status.text}。列表里没有的，直接在下拉框里输入模型名就行。`
    ) : canFetch ? (
      '正在连接…'
    ) : (
      '填好接口地址和密钥后，会自动拉取可用的模型。'
    )

  return (
    <>
      <Group title="服务商">
        <Row label="选择">
          <Select
            className="ios-select ai-select"
            variant="borderless"
            value={provider?.id ?? CUSTOM_PROVIDER}
            popupMatchSelectWidth={false}
            options={[
              ...PROVIDERS.map((p) => ({
                value: p.id,
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    <ProviderIcon provider={p.icon} size={18} />
                    <span>{p.name}</span>
                  </Flexbox>
                ),
              })),
              {value: CUSTOM_PROVIDER, label: <span>自定义（兼容 OpenAI 的接口）</span>},
            ]}
            onChange={(v) => pickProvider(String(v))}
          />
        </Row>
        <TextRow label="接口地址" stack value={ai.baseUrl} placeholder="https://api.openai.com/v1" onChange={(v) => onChange({...ai, baseUrl: v})} />
        <TextRow label="密钥" secret value={ai.apiKey} placeholder={provider?.keyless ? '本地模型可以不填' : 'sk-…'} onChange={(v) => onChange({...ai, apiKey: v})} />
      </Group>
      <Group title="模型" footer={footer}>
        <Row label="使用的模型">
          <Flexbox horizontal align="center" gap={4} style={{minWidth: 0}}>
            <Select
              className="ios-select ai-select"
              variant="borderless"
              showSearch
              value={ai.model || undefined}
              placeholder={models.length ? '选择模型' : '输入模型名，如 gpt-4o-mini'}
              popupMatchSelectWidth={false}
              options={options}
              loading={status.kind === 'loading'}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              onSearch={setSearch}
              onOpenChange={(open) => {
                if (!open) setSearch('')
              }}
              onChange={(v) => {
                setSearch('')
                onChange({...ai, model: String(v)})
              }}
            />
            <ActionIcon icon={RefreshCw} title="重新拉取模型列表" size="small" loading={status.kind === 'loading'} disabled={!canFetch} onClick={() => void load()} />
          </Flexbox>
        </Row>
      </Group>
      <AdvancedAi ai={ai} onChange={onChange} />
    </>
  )
}

/** 一行可留空的数字：留空表示「不发给接口，用模型默认」。 */
function NumberRow({label, hint, value, min, max, step, placeholder = '默认', onChange}: {label: string; hint?: string; value: number | undefined; min?: number; max?: number; step?: number; placeholder?: string; onChange: (next: number | undefined) => void}) {
  return (
    <Row label={label} hint={hint}>
      <InputNumber
        className="ai-number"
        variant="borderless"
        controls={false}
        value={value ?? null}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(v) => onChange(typeof v === 'number' && Number.isFinite(v) ? v : undefined)}
      />
    </Row>
  )
}

const EFFORTS = [
  {value: 'auto', label: '默认'},
  {value: 'low', label: '低'},
  {value: 'medium', label: '中'},
  {value: 'high', label: '高'},
]

const ADVANCED_KEYS = ['temperature', 'topP', 'maxTokens', 'presencePenalty', 'frequencyPenalty', 'reasoningEffort', 'systemPrompt', 'contextTurns', 'maxRounds', 'extraBody'] as const

function extraBodyError(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? undefined : '需要是一个 JSON 对象，例如 {"top_k": 40}'
  } catch {
    return '不是合法的 JSON'
  }
}

/**
 * 高级参数。默认折叠；每一项留空都表示用模型自己的默认值，
 * 所以不碰这里，行为和以前完全一样。
 */
function AdvancedAi({ai, onChange}: {ai: AiConfig; onChange: (next: AiConfig) => void}) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<AiConfig>) => onChange({...ai, ...patch})
  const touched = ADVANCED_KEYS.filter((key) => ai[key] !== undefined && ai[key] !== '').length
  const jsonError = extraBodyError(ai.extraBody)

  return (
    <>
      <Group>
        <Row label="高级设置" hint={touched ? `已自定义 ${touched} 项` : '采样参数、推理强度、上下文、自定义指令'} chevron={!open} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp size={16} /> : undefined}
        </Row>
      </Group>
      {open && (
        <>
          <Group title="采样" footer="留空就是用模型默认值。推理模型（o 系列、gpt-5）只认默认采样，这几项对它们不会发送。">
            <NumberRow label="温度" hint="越低越稳，越高越发散" value={ai.temperature} min={0} max={2} step={0.1} onChange={(v) => set({temperature: v})} />
            <NumberRow label="Top P" hint="核采样，一般和温度二选一调" value={ai.topP} min={0} max={1} step={0.05} onChange={(v) => set({topP: v})} />
            <NumberRow label="存在惩罚" hint="越高越爱聊新话题" value={ai.presencePenalty} min={-2} max={2} step={0.1} onChange={(v) => set({presencePenalty: v})} />
            <NumberRow label="频率惩罚" hint="越高越少重复用词" value={ai.frequencyPenalty} min={-2} max={2} step={0.1} onChange={(v) => set({frequencyPenalty: v})} />
          </Group>
          <Group title="输出" footer="推理强度只对支持的模型有效（如 o 系列、gpt-5、部分 DeepSeek / Qwen 推理模型），其他模型选「默认」。">
            <NumberRow label="最长回答" hint="单次回答最多输出多少 token" value={ai.maxTokens} min={64} max={200000} step={256} placeholder="不限" onChange={(v) => set({maxTokens: v})} />
            <Row label="推理强度">
              <Select
                className="ios-select"
                variant="borderless"
                value={ai.reasoningEffort ?? 'auto'}
                options={EFFORTS}
                onChange={(v) => set({reasoningEffort: v === 'auto' ? undefined : (v as AiConfig['reasoningEffort'])})}
              />
            </Row>
          </Group>
          <Group title="对话" footer="历史轮数越多，模型记得越久，也越贵。工具轮数是搭搭一次回答里最多连着改几次页面。">
            <NumberRow label="带上的历史" hint="最近多少轮问答" value={ai.contextTurns} min={1} max={100} step={1} placeholder="24" onChange={(v) => set({contextTurns: v && Math.round(v)})} />
            <NumberRow label="工具轮数上限" hint="一次回答最多连续操作几轮" value={ai.maxRounds} min={1} max={40} step={1} placeholder="14" onChange={(v) => set({maxRounds: v && Math.round(v)})} />
          </Group>
          <Group title="自定义指令" footer="每次对话都会附在搭搭的系统提示后面，比如「标题都用衬线字体」「回答尽量简短」。最多 2000 字。">
            <Row stack>
              <TextArea
                className="ai-textarea"
                variant="borderless"
                autoSize={{minRows: 3, maxRows: 10}}
                maxLength={2000}
                value={ai.systemPrompt ?? ''}
                placeholder="告诉搭搭你的长期偏好…"
                onChange={(event) => set({systemPrompt: event.target.value || undefined})}
              />
            </Row>
          </Group>
          <Group
            title="额外请求参数"
            footer={jsonError ? <Text type="danger">{jsonError}</Text> : '合并进每次请求的 JSON，用来传服务商特有的参数。不会覆盖 model、messages、tools、stream。'}
          >
            <Row stack>
              <TextArea
                className="ai-textarea ai-mono"
                variant="borderless"
                autoSize={{minRows: 2, maxRows: 8}}
                value={ai.extraBody ?? ''}
                placeholder='{"top_k": 40}'
                spellCheck={false}
                onChange={(event) => set({extraBody: event.target.value || undefined})}
              />
            </Row>
          </Group>
          {touched > 0 && (
            <Group>
              <Row label="恢复高级项的默认值" icon={<RotateCcw size={16} />} danger onClick={() => onChange(Object.fromEntries(Object.entries(ai).filter(([key]) => !(ADVANCED_KEYS as readonly string[]).includes(key))) as AiConfig)} />
            </Group>
          )}
        </>
      )}
    </>
  )
}
