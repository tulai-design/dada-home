import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ActionIcon, Button, Drawer, Empty, Flexbox, Markdown, Modal, Text} from '@lobehub/ui'
import {ArrowDown, History, Maximize2, MessageSquare, Minimize2, Plus, Settings, Square, Trash2, X} from 'lucide-react'
import type {AiConfig} from '../lib/types'
import {useIsMobile} from '../lib/useMedia'
import {Mascot} from './About'
import {elapsed, isActive, type Conv, type Turn} from '../lib/chat'
import {ThinkingPanel} from './ThinkingPanel'
import {ToolRow} from './ToolRow'
import {Composer} from './Composer'
import {ApprovalCard} from './ApprovalCard'

type Props = {
  open: boolean
  mode: 'drawer' | 'full'
  onMode: (mode: 'drawer' | 'full') => void
  ai: AiConfig
  turns: Turn[]
  /** 对话记录是否已从 IndexedDB 读完 */
  ready: boolean
  convs: Conv[]
  convId: string
  onNewConv: () => void
  onOpenConv: (id: string) => void
  onDeleteConv: (id: string) => void
  busy: boolean
  seed: {text: string; key: number}
  onSend: (text: string) => void
  onStop: () => void
  onClose: () => void
  onOpenSettings: () => void
  /** 用户对确认卡片的选择 */
  onApprovalAnswer: (approved: boolean | 'always') => void
}

/** 距底部多少像素内算「贴底」，超过就认为用户在看历史，不再自动跟随。 */
const FOLLOW_THRESHOLD = 120
/** 一次渲染多少轮。 */
const PAGE = 40

export function Assistant({open, mode, onMode, ai, turns, ready, convs, convId, onNewConv, onOpenConv, onDeleteConv, busy, seed, onSend, onStop, onClose, onOpenSettings, onApprovalAnswer}: Props) {
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const mobile = useIsMobile()
  const [paused, setPaused] = useState(false)
  // 对话可以无限长：只渲染最近一段，更早的点一下再展开，免得几千轮把界面拖慢
  const [shown, setShown] = useState(PAGE)
  const [listOpen, setListOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  useEffect(() => setShown(PAGE), [convId])
  const visible = turns.length > shown ? turns.slice(-shown) : turns
  const hiddenCount = turns.length - visible.length
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
      <ActionIcon icon={Plus} title={busy ? '回答完再新开对话' : '新对话'} disabled={busy || !turns.length} onClick={onNewConv} />
      {(mode !== 'full' || mobile) && <ActionIcon icon={History} title="历史对话" onClick={() => setListOpen(true)} />}
      {turns.length > 0 && <ActionIcon icon={Trash2} title="删除这个对话" disabled={busy} onClick={() => setPendingDelete(convId)} />}
      <ActionIcon icon={Settings} title="设置" onClick={onOpenSettings} />
      <ActionIcon icon={mode === 'full' ? Minimize2 : Maximize2} title={mode === 'full' ? '退出全屏' : '全屏'} onClick={() => onMode(mode === 'full' ? 'drawer' : 'full')} />
    </Flexbox>
  )

  const chat = (
      <Flexbox direction="vertical" style={{height: '100%', position: 'relative'}}>
        {!ready ? (
          <div className="chat-empty">
            <Text type="secondary">正在读取对话记录…</Text>
          </div>
        ) : turns.length === 0 ? (
          <div className="chat-empty">
          <Empty
            image={<Mascot size={120} className="mascot chat-mascot" />}
            imageSize={120}
            title={configured ? '想让搭搭做点什么？' : '模型未接入'}
            description={
              configured
                ? '可以聊天、查资料、总结订阅，也可以让它直接动手：「加一个便签页」「换成深色主题」「记一个待办」。改页面改错了可以撤销。'
                : '在设置里填写兼容 OpenAI 的接口地址和模型。'
            }
            action={!configured ? <Button type="primary" icon={<Settings size={14} />} onClick={onOpenSettings}>去设置</Button> : undefined}
          />
          </div>
        ) : (
          <div className="chat-log" ref={logRef} onScroll={onScroll}>
            {hiddenCount > 0 && (
              <Button className="chat-earlier" type="text" size="small" onClick={() => setShown((n) => n + PAGE)}>
                显示更早的 {Math.min(PAGE, hiddenCount)} 轮（还有 {hiddenCount} 轮）
              </Button>
            )}
            {visible.map((turn) => (
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
          placeholder={configured ? '问点什么，或者让搭搭动手做点事' : '先配置模型'}
          hint={configured ? ai.model : '未配置模型'}
          model={configured ? ai.model : undefined}
        />
      </Flexbox>
  )

  const dialogs = (
    <>
      <Modal open={listOpen} title="历史对话" footer={null} width={460} onCancel={() => setListOpen(false)}>
        <div className="conv-modal">
          <ConvList
            convs={convs}
            convId={convId}
            busy={busy}
            onOpen={(id) => {
              onOpenConv(id)
              setListOpen(false)
            }}
            onDelete={setPendingDelete}
          />
        </div>
      </Modal>
      <Modal
        open={Boolean(pendingDelete)}
        title="删除对话"
        okText="删除"
        cancelText="取消"
        onCancel={() => setPendingDelete(null)}
        onOk={() => {
          if (pendingDelete) onDeleteConv(pendingDelete)
          setPendingDelete(null)
        }}
      >
        <Text>删除「{convs.find((c) => c.id === pendingDelete)?.title ?? '这个对话'}」和里面所有的问答？删除后不能找回。</Text>
      </Modal>
    </>
  )

  // 全屏：占满整个窗口（红框之内），左边是历史标题，右边是对话
  if (mode === 'full') {
    if (!open) return null
    return (
      <div className="ai-full" role="dialog" aria-label="搭搭 AI">
        <aside className="ai-full-side">
          <div className="ai-full-brand">
            <Mascot size={28} className="ai-full-logo" /> 搭搭
          </div>
          <Button block icon={<Plus size={14} />} onClick={onNewConv} disabled={busy || !turns.length}>
            新对话
          </Button>
          <div className="ai-full-history-title">历史</div>
          <div className="ai-full-history">
            <ConvList convs={convs} convId={convId} busy={busy} onOpen={onOpenConv} onDelete={setPendingDelete} />
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
        {dialogs}
      </div>
    )
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} title="搭搭" width={mobile ? '100%' : 720} extra={actions}>
        {chat}
      </Drawer>
      {dialogs}
    </>
  )
}

/** 一轮对话：用户提问 → 思考 → 工具 → 回答 → 失败/耗时。 */
function TurnView({turn, busy, onApprovalAnswer}: {turn: Turn; busy: boolean; onApprovalAnswer: (approved: boolean | 'always') => void}) {
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

/** 历史对话列表：只有标题，当前的高亮，每行可删。 */
function ConvList({convs, convId, busy, onOpen, onDelete}: {convs: Conv[]; convId: string; busy: boolean; onOpen: (id: string) => void; onDelete: (id: string) => void}) {
  if (!convs.length) {
    return (
      <Text type="secondary" fontSize={12}>
        还没有对话
      </Text>
    )
  }
  return (
    <>
      {convs.map((conv) => (
        <div key={conv.id} className="conv-row" data-on={conv.id === convId} data-disabled={busy && conv.id !== convId}>
          <Button
            block
            type="text"
            className="ai-history-item"
            icon={<MessageSquare size={13} />}
            title={conv.title}
            disabled={busy && conv.id !== convId}
            onClick={() => onOpen(conv.id)}
          >
            <span>{conv.title}</span>
          </Button>
          <ActionIcon className="conv-del" icon={Trash2} size="small" title="删除" disabled={busy} onClick={() => onDelete(conv.id)} />
        </div>
      ))}
    </>
  )
}
