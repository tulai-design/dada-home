import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ActionIcon, Button, Drawer, Empty, Flexbox, Markdown, Text} from '@lobehub/ui'
import {ArrowDown, Maximize2, MessageSquare, Minimize2, Plus, Settings, Sparkles, Square, Trash2, X} from 'lucide-react'
import {useStored} from '../lib/store'
import type {AiConfig} from '../lib/types'
import {elapsed, isActive, type Turn} from '../lib/chat'
import {ThinkingPanel} from './ThinkingPanel'
import {ToolRow} from './ToolRow'
import {Composer} from './Composer'
import {ApprovalCard} from './ApprovalCard'

type Props = {
  open: boolean
  ai: AiConfig
  turns: Turn[]
  busy: boolean
  seed: {text: string; key: number}
  onSend: (text: string) => void
  onStop: () => void
  onClose: () => void
  onOpenSettings: () => void
  onClear: () => void
  /** 用户对确认卡片的选择 */
  onApprovalAnswer: (approved: boolean) => void
}

/** 距底部多少像素内算「贴底」，超过就认为用户在看历史，不再自动跟随。 */
const FOLLOW_THRESHOLD = 120

export function Assistant({open, ai, turns, busy, seed, onSend, onStop, onClose, onOpenSettings, onClear, onApprovalAnswer}: Props) {
  const [mode, setMode] = useStored<'drawer' | 'full'>('assistantMode', 'drawer')
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [paused, setPaused] = useState(false)
  const configured = Boolean(ai.baseUrl.trim() && ai.model.trim())

  useEffect(() => {
    if (!open || !seed.text) return
    setInput(seed.text)
  }, [seed.key, open, seed.text])

  useEffect(() => {
    if (!open || mode !== 'full') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mode, onClose])

  // 用户往上滚就暂停跟随；回到底部再恢复。用布局副作用，避免流式时抖动。
  const onScroll = () => {
    const el = logRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD
    followRef.current = atBottom
    setPaused(!atBottom)
  }

  useLayoutEffect(() => {
    const el = logRef.current
    if (!el || !followRef.current) return
    el.scrollTop = el.scrollHeight
  }, [turns])

  const jumpToBottom = () => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    followRef.current = true
    setPaused(false)
  }

  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    if (!configured) {
      onOpenSettings()
      return
    }
    onSend(text)
    setInput('')
    followRef.current = true
    setPaused(false)
  }

  const actions = (
    <Flexbox direction="horizontal" align="center" gap={4}>
      {turns.length > 0 && <ActionIcon icon={Trash2} title="清空对话" onClick={onClear} />}
      <ActionIcon icon={Settings} title="设置" onClick={onOpenSettings} />
      <ActionIcon icon={mode === 'full' ? Minimize2 : Maximize2} title={mode === 'full' ? '退出全屏' : '全屏'} onClick={() => setMode(mode === 'full' ? 'drawer' : 'full')} />
    </Flexbox>
  )

  const chat = (
      <Flexbox direction="vertical" style={{height: '100%', position: 'relative'}}>
        {turns.length === 0 ? (
          <div className="chat-empty">
          <Empty
            title={configured ? '说说你想怎么改' : '模型未接入'}
            description={
              configured
                ? '例如「加一个便签页」「把天气挪到右上」「换成深色主题」。搭搭会直接改页面，改错可以撤销。'
                : '在设置里填写兼容 OpenAI 的接口地址和模型。'
            }
            action={!configured ? <Button type="primary" icon={<Settings size={14} />} onClick={onOpenSettings}>去设置</Button> : undefined}
          />
          </div>
        ) : (
          <div className="chat-log" ref={logRef} onScroll={onScroll}>
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} busy={busy} onApprovalAnswer={onApprovalAnswer} />
            ))}
            <div className="chat-log-tail" />
          </div>
        )}

        {paused && turns.length > 0 && (
          <Button className="chat-jump" size="small" icon={<ArrowDown size={13} />} onClick={jumpToBottom}>
            回到最新
          </Button>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={submit}
          onStop={onStop}
          busy={busy}
          placeholder={configured ? '说一句话，让搭搭改页面' : '先配置模型'}
          hint={configured ? ai.model : '未配置模型'}
        />
      </Flexbox>
  )

  // 全屏：占满整个窗口（红框之内），左边是历史标题，右边是对话
  if (mode === 'full') {
    if (!open) return null
    return (
      <div className="ai-full" role="dialog" aria-label="搭搭 AI">
        <aside className="ai-full-side">
          <div className="ai-full-brand">
            <Sparkles size={16} /> 搭搭
          </div>
          <Button block icon={<Plus size={14} />} onClick={onClear} disabled={!turns.length}>
            新对话
          </Button>
          <div className="ai-full-history-title">历史</div>
          <div className="ai-full-history">
            {turns.length === 0 && <Text type="secondary" fontSize={12}>还没有对话</Text>}
            {[...turns].reverse().map((turn) => (
              <Button
                key={turn.id}
                block
                type="text"
                className="ai-history-item"
                icon={<MessageSquare size={13} />}
                title={turn.prompt}
                onClick={() => document.getElementById(`turn-${turn.id}`)?.scrollIntoView({behavior: 'smooth', block: 'start'})}
              >
                <span>{turn.prompt}</span>
              </Button>
            ))}
          </div>
        </aside>
        <section className="ai-full-main">
          <header className="ai-full-head">
            <Text strong>对话</Text>
            <Flexbox direction="horizontal" align="center" gap={4}>
              {actions}
              <ActionIcon icon={X} title="关闭" onClick={onClose} />
            </Flexbox>
          </header>
          <div className="ai-full-chat">{chat}</div>
        </section>
      </div>
    )
  }

  return (
    <Drawer open={open} onClose={onClose} title="搭搭" width={720} extra={actions}>
      {chat}
    </Drawer>
  )
}

/** 一轮对话：用户提问 → 思考 → 工具 → 回答 → 失败/耗时。 */
function TurnView({turn, busy, onApprovalAnswer}: {turn: Turn; busy: boolean; onApprovalAnswer: (approved: boolean) => void}) {
  const active = isActive(turn) && busy
  const thinking = active && !turn.answer && (!turn.tools.length || turn.tools.every((t) => t.ok))
  const seconds = elapsed(turn)

  return (
    <div className="turn" id={`turn-${turn.id}`}>
      <p className="turn-ask">{turn.prompt}</p>

      {turn.reasoning && (
        <ThinkingPanel
          reasoning={turn.reasoning}
          active={thinking}
          durationMs={seconds !== undefined && thinking ? undefined : seconds}
        />
      )}

      {turn.tools.length > 0 && (
        <div className="turn-tools">
          {turn.tools.map((step, i) => (
            <ToolRow key={`${step.name}-${i}`} step={step} pending={active && i === turn.tools.length - 1 && !step.text} />
          ))}
        </div>
      )}

      {turn.answer && (
        <div className="turn-answer">
          <Markdown variant="chat">{turn.answer}</Markdown>
        </div>
      )}

      {active && !turn.answer && !turn.reasoning && (
        <Text className="turn-pending" type="secondary">
          <Square size={8} className="turn-pulse" /> 正在处理
        </Text>
      )}

      {turn.pending && <ApprovalCard request={turn.pending.request} onAnswer={onApprovalAnswer} />}

      {turn.error && <p className="turn-error">{turn.error}</p>}

      {turn.aborted && <Text className="turn-note" type="secondary">已停止</Text>}
    </div>
  )
}
