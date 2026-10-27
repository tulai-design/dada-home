import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ActionIcon, Button, Drawer, Empty, Flexbox, Markdown, Modal, Text} from '@lobehub/ui'
import {ArrowDown, ClockCounterClockwise as History, ArrowsOut as Maximize2, Chat as MessageSquare, Columns, SidebarSimple, Plus, Gear as Settings, Square, Trash as Trash2, X} from '@phosphor-icons/react'
import type {AiConfig} from '../lib/types'
import type {AssistantMode} from '../lib/assistantLayout'
import {useIsMobile} from '../lib/useMedia'
import {Mascot} from './About'
import {elapsed, isActive, type Conv, type Turn} from '../lib/chat'
import {ThinkingPanel} from './ThinkingPanel'
import {ToolRow} from './ToolRow'
import {Composer} from './Composer'
import {ApprovalCard} from './ApprovalCard'
import '../assistant.css'

type Props = {
  open: boolean
  mode: AssistantMode
  onMode: (mode: AssistantMode) => void
  /** 宿主判断是否有足够宽度同时显示页面和助手。 */
  canSplit?: boolean
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
  articleTitle?: string
  onRemoveArticle: () => void
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
const MODES = [
  {value: 'drawer', label: '抽屉', icon: SidebarSimple},
  {value: 'split', label: '分栏', icon: Columns},
  {value: 'full', label: '全屏', icon: Maximize2},
] as const

export function Assistant({open, mode, onMode, canSplit = true, ai, turns, ready, convs, convId, onNewConv, onOpenConv, onDeleteConv, busy, seed, articleTitle, onRemoveArticle, onSend, onStop, onClose, onOpenSettings, onApprovalAnswer}: Props) {
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const mobile = useIsMobile()
  // 保留桌面的分栏偏好，手机仅改变本次呈现，不回写用户设置。
  const splitAvailable = !mobile && canSplit
  const displayMode = mode === 'split' && !splitAvailable ? 'drawer' : mode
  const [paused, setPaused] = useState(false)
  // 对话可以无限长：只渲染最近一段，更早的点一下再展开，免得几千轮把界面拖慢
  const [shown, setShown] = useState(PAGE)
  const [listOpen, setListOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  useEffect(() => setShown(PAGE), [convId])
  const visible = turns.length > shown ? turns.slice(-shown) : turns
  const hiddenCount = turns.length - visible.length
  const configured = Boolean(ai.baseUrl.trim() && ai.model.trim())
  const consumedSeed = useRef(seed.key)

  useEffect(() => {
    if (!open || consumedSeed.current === seed.key) return
    consumedSeed.current = seed.key
    setInput(seed.text)
  }, [seed.key, open, seed.text])

  useEffect(() => {
    if (!open || displayMode !== 'full') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, displayMode, onClose])

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

  // 打开面板、切换对话时：落在最新一条上。面板有进场动画、内容可能晚一拍才挂上，所以多补几次。
  useEffect(() => {
    if (!open) return
    followRef.current = true
    setPaused(false)
    const snap = () => {
      const el = logRef.current
      if (el && followRef.current) el.scrollTop = el.scrollHeight
    }
    snap()
    const timers = [60, 200, 450].map((ms) => window.setTimeout(snap, ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [open, displayMode, convId, ready])

  // 打开面板时把光标放进输入框（抽屉默认会抢到第一个按钮上）。触屏上不弹键盘。
  useEffect(() => {
    if (!open || !ready || window.matchMedia('(pointer: coarse)').matches) return
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('.chat-root .composer-input textarea, .chat-root textarea.composer-input')?.focus({preventScroll: true})
    }, 260)
    return () => window.clearTimeout(timer)
  }, [open, displayMode, ready])

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
    <Flexbox className="assistant-actions" direction="horizontal" align="center" gap={2}>
      <ActionIcon size="small" icon={Plus} title={busy ? '回答完再新开对话' : '新对话'} disabled={busy || !turns.length} onClick={onNewConv} />
      {(displayMode !== 'full' || mobile) && <ActionIcon size="small" icon={History} aria-label="历史对话" title="历史对话" onClick={() => setListOpen(true)} />}
      {turns.length > 0 && <ActionIcon size="small" icon={Trash2} title="删除这个对话" disabled={busy} onClick={() => setPendingDelete(convId)} />}
      <ActionIcon size="small" icon={Settings} aria-label="助手设置" title="设置" onClick={onOpenSettings} />
      <div className="assistant-mode-switch" role="group" aria-label="对话布局">
        {MODES.filter((item) => item.value !== 'split' || splitAvailable).map((item) => (
          <ActionIcon
            key={item.value}
            className="assistant-mode-button"
            size="small"
            icon={item.icon}
            title={item.label}
            aria-label={`${item.label}模式`}
            aria-pressed={displayMode === item.value}
            data-selected={displayMode === item.value}
            onClick={() => onMode(item.value)}
          />
        ))}
      </div>
    </Flexbox>
  )

  const chat = (
      <Flexbox className="chat-root" direction="vertical" style={{height: '100%', position: 'relative'}}>
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

        {articleTitle && (
          <div className="chat-article" role="status">
            <div><Text type="secondary" fontSize={12}>随问题发送的文章</Text><div>{articleTitle}</div></div>
            <ActionIcon icon={X} title="移除文章" onClick={onRemoveArticle} />
          </div>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSend={submit}
          onStop={onStop}
          busy={busy}
          placeholder={configured ? (articleTitle ? '输入你想问这篇文章的问题' : '问点什么，或者让搭搭动手做点事') : '先配置模型'}
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
  if (displayMode === 'full') {
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
          <header className="ai-full-head assistant-panel-head">
            <Text strong>对话</Text>
            <Flexbox direction="horizontal" align="center" gap={4}>
              {actions}
              <ActionIcon size="small" icon={X} aria-label="关闭助手" title="关闭" onClick={onClose} />
            </Flexbox>
          </header>
          <div className="ai-full-chat">{chat}</div>
        </section>
        {dialogs}
      </div>
    )
  }

  // 分栏参与页面布局；没有遮罩、Portal 或焦点限制，左侧页面可以继续操作。
  if (displayMode === 'split') {
    if (!open) return null
    return (
      <section className="assistant-split" role="complementary" aria-label="搭搭 AI">
        <header className="assistant-panel-head">
          <Text strong>搭搭</Text>
          <Flexbox direction="horizontal" align="center" gap={2}>
            {actions}
            <ActionIcon size="small" icon={X} aria-label="关闭助手" title="关闭" onClick={onClose} />
          </Flexbox>
        </header>
        <div className="assistant-split-chat">{chat}</div>
        {dialogs}
      </section>
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
      {turn.article && <div className="turn-article">参考文章：{turn.article.title}</div>}
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
