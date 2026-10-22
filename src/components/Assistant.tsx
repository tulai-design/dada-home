import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Button, Drawer, Empty, Flexbox, Tag, Text } from '@lobehub/ui'
import { ChatItem } from '@lobehub/ui/chat'
import { ChatInputActionBar, ChatInputArea, ChatSendButton } from '@lobehub/ui/chat'
import type { AiConfig } from '../lib/types'
import type { ChatTurn } from '../lib/chat'
import { Trash2 } from 'lucide-react'

type Props = {
  open: boolean
  ai: AiConfig
  turns: ChatTurn[]
  busy: boolean
  seed: { text: string; key: number }
  onSend: (text: string) => void
  onStop: () => void
  onClose: () => void
  onOpenSettings: () => void
  onClear: () => void
}

export function Assistant({ open, ai, turns, busy, seed, onSend, onStop, onClose, onOpenSettings, onClear }: Props) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const configured = Boolean(ai.baseUrl.trim() && ai.model.trim())

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  useEffect(() => {
    if (!open || !seed.text) return
    setInput(seed.text)
    inputRef.current?.focus()
  }, [seed.key, open, seed.text])

  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    if (!configured) {
      onOpenSettings()
      return
    }
    onSend(text)
    setInput('')
  }

  return (
    <Drawer open={open} onClose={onClose} title="对话" width={680} extra={
      <Flexbox direction="horizontal" align="center" gap={6}>
        {turns.length > 0 && (
          <ActionIcon icon={Trash2} title="清空" onClick={onClear} />
        )}
        <Button size="small" type="text" onClick={onOpenSettings}>
          设置
        </Button>
      </Flexbox>
    }>
      <Flexbox direction="vertical" gap={12} style={{ height: '100%' }}>
        {turns.length === 0 ? (
          <Empty
            title={configured ? '还没有对话' : '模型未接入'}
            description={configured ? '提问，或交代待办、便签和书签。订阅、待办和便签会作为上下文。' : '在设置里填写兼容 OpenAI 的接口地址和模型。'}
            action={
              !configured ? (
                <Button type="primary" onClick={onOpenSettings}>
                  去设置
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Flexbox direction="vertical" gap={4} className="page-list assistant-log">
            {turns.map((turn, i) =>
              turn.kind === 'tool' ? (
                <Text key={`${turn.name}-${i}`} fontSize={12} type={turn.ok ? 'secondary' : 'danger'} className="tool-line">
                  {turn.ok ? '已执行' : '未完成'} · {turn.text}
                </Text>
              ) : (
                <ChatItem
                  key={`${turn.kind}-${i}`}
                  avatar={{ avatar: turn.kind === 'user' ? '你' : '页', title: turn.kind === 'user' ? '你' : '第一页' }}
                  placement="left"
                  variant="docs"
                  showTitle
                  fontSize={14}
                  loading={busy && turn.kind === 'assistant' && i === turns.length - 1 && !turn.text}
                  error={turn.kind === 'error' ? { message: turn.text, type: 'error' } : undefined}
                  message={turn.kind === 'error' ? undefined : turn.text}
                  markdownProps={turn.kind === 'assistant' ? { variant: 'chat' } : undefined}
                />
              ),
            )}
          </Flexbox>
        )}
        <ChatInputArea
          ref={inputRef}
          value={input}
          loading={busy}
          placeholder={configured ? '写下问题，或交代一件要办的事' : '先配置模型'}
          onInput={setInput}
          onSend={submit}
          expand={false}
          bottomAddons={
            <ChatInputActionBar
              leftAddons={
                <Tag variant="borderless">{configured ? ai.model : '未配置模型'}</Tag>
              }
              rightAddons={<ChatSendButton loading={busy} onSend={submit} onStop={onStop} texts={{ send: '发送', stop: '停止', warp: '换行' }} />}
            />
          }
        />
      </Flexbox>
    </Drawer>
  )
}
