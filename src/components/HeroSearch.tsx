import { useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { Block, Button, Flexbox, Markdown, SearchBar, Segmented, Tag, Text } from '@lobehub/ui'
import { SEARCH_ENGINES } from '../lib/defaults'
import type { ChatTurn } from '../lib/chat'

export type SearchMode = 'ai' | (typeof SEARCH_ENGINES)[number]['id']

const PRESETS = ['总结今天的订阅', '帮我记一件待办', '挑三条最值得读的']

function looksLikeUrl(q: string) {
  return /^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})(\/\S*)?$/i.test(q.trim())
}

export function HeroSearch({
  mode,
  onMode,
  model,
  configured,
  busy,
  turns,
  inputRef,
  onSearch,
  onAsk,
  onStop,
  onExpand,
  onSettings,
}: {
  mode: SearchMode
  onMode: (next: SearchMode) => void
  model: string
  configured: boolean
  busy: boolean
  turns: ChatTurn[]
  inputRef: RefObject<HTMLInputElement | null>
  onSearch: (q: string, engine: string) => void
  onAsk: (text: string) => void
  onStop: () => void
  onExpand: () => void
  onSettings: () => void
}) {
  const [value, setValue] = useState('')
  const active: SearchMode = mode === 'ai' || SEARCH_ENGINES.some((e) => e.id === mode) ? mode : 'ai'
  const url = looksLikeUrl(value)
  const engine = SEARCH_ENGINES.find((e) => e.id === active)
  const lastUser = useMemo(() => [...turns].reverse().find((t) => t.kind === 'user'), [turns])
  const lastAssistant = useMemo(() => [...turns].reverse().find((t) => t.kind === 'assistant'), [turns])
  const lastTool = useMemo(() => [...turns].reverse().find((t) => t.kind === 'tool'), [turns])
  const peek = Boolean(lastAssistant || lastTool || (busy && lastUser))

  const submit = (raw = value) => {
    const text = raw.trim()
    if (!text) return
    if (url) {
      onSearch(text, 'direct')
      setValue('')
      return
    }
    if (active === 'ai') {
      if (!configured) {
        onSettings()
        return
      }
      if (busy) return
      onAsk(text)
      setValue('')
      return
    }
    onSearch(text, active)
    setValue('')
  }

  const placeholder = url
    ? '回车打开这个地址'
    : active === 'ai'
      ? busy
        ? '正在回答…'
        : configured
          ? '搜索，或交代待办、便签、书签'
          : '先到设置里接上模型'
      : `在${engine?.label ?? '网页'}里搜索`

  return (
    <Flexbox className="hero-search" direction="vertical" gap={12}>
      <Segmented
        block
        size="large"
        value={active}
        onChange={(next) => onMode(next as SearchMode)}
        options={[
          { value: 'ai', label: 'AI+' },
          ...SEARCH_ENGINES.map((item) => ({ value: item.id, label: item.label })),
        ]}
      />
      <SearchBar
        ref={inputRef}
        size="large"
        shadow
        allowClear
        value={value}
        placeholder={placeholder}
        onValueChange={(next) => setValue(next)}
        onSearch={(next) => submit(next)}
        onPressEnter={() => submit()}
        disabled={active === 'ai' && busy}
        suffix={
          active === 'ai' && busy ? (
            <Button size="small" onClick={onStop}>
              停止
            </Button>
          ) : (
            <Button type="primary" size="small" disabled={!value.trim()} onClick={() => submit()}>
              {url ? '打开' : active === 'ai' ? '提问' : '搜索'}
            </Button>
          )
        }
      />

      {!peek && active === 'ai' && (
        <Flexbox direction="horizontal" align="center" justify="center" wrap="wrap" gap={8} width="100%">
          {PRESETS.map((item) => (
            <Tag
              key={item}
              variant="outlined"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (!configured) {
                  onSettings()
                  return
                }
                if (!busy) onAsk(item)
              }}
            >
              {item}
            </Tag>
          ))}
          <Text type="secondary" fontSize={12}>
            {configured ? model : '未配置模型'}
          </Text>
        </Flexbox>
      )}

      {!peek && active !== 'ai' && (
        <Text type="secondary" fontSize={12}>
          回车在{engine?.label}搜索 · 输入网址可直接打开
        </Text>
      )}

      {peek && (
        <Block className="hero-answer" clickable onClick={onExpand}>
          {lastUser && (
            <Text type="secondary" ellipsis>
              {lastUser.text}
            </Text>
          )}
          {lastTool && (
            <Text fontSize={12} type={lastTool.ok ? 'secondary' : 'danger'}>
              {lastTool.ok ? '已执行' : '未完成'} · {lastTool.text}
            </Text>
          )}
          <div className="hero-answer-body">
            {lastAssistant?.text ? <Markdown variant="chat">{lastAssistant.text}</Markdown> : <Text type="secondary">正在整理回答</Text>}
          </div>
          <Text fontSize={12} type="secondary">
            打开完整对话
          </Text>
        </Block>
      )}
    </Flexbox>
  )
}
