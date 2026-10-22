import {useRef} from 'react'
import {Button, Tag, Text, TextArea} from '@lobehub/ui'
import {CornerDownLeft, Square} from 'lucide-react'

/**
 * 对话输入框。
 *
 * 不用组件库的 ChatInputArea —— 它自带固定高度和大量留白，
 * 在抽屉里会把对话区挤掉一半。这里用可自适应的 textarea，
 * 高度跟着内容长，最多到 10 行。
 *
 * 交互约定（对齐 Momoki）：
 *   - 回车发送，Shift+回车换行
 *   - 中文输入法组合期间回车不发送
 *   - 生成中显示「停止」，点击可中断
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  hint,
}: {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  placeholder: string
  /** 右侧的小字提示，例如当前模型名 */
  hint?: string
}) {
  const composing = useRef(false)
  const canSend = value.trim().length > 0 && !busy

  const submit = () => {
    if (!canSend) return
    onSend()
  }

  return (
    <div className="composer">
      <TextArea
        className="composer-input"
        value={value}
        placeholder={placeholder}
        autoSize={{minRows: 1, maxRows: 10}}
        aria-label="消息内容"
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onChange={(event: {target: {value: string}}) => onChange(event.target.value)}
        onPressEnter={(event: {nativeEvent: {isComposing: boolean}; shiftKey: boolean; altKey: boolean; preventDefault: () => void}) => {
          // 输入法组合中、或按了 Shift/Alt 时回车是换行，不发送
          if (composing.current || event.nativeEvent.isComposing || event.shiftKey || event.altKey) return
          event.preventDefault()
          submit()
        }}
      />
      <div className="composer-bar">
        <div className="composer-bar-left">{hint ? <Tag variant="borderless">{hint}</Tag> : null}</div>
        <div className="composer-bar-right">
          <Text className="composer-hint" type="secondary">
            <CornerDownLeft size={11} /> 发送 · Shift+回车换行
          </Text>
          {busy ? (
            <Button size="small" icon={<Square size={11} />} onClick={onStop}>
              停止
            </Button>
          ) : (
            <Button type="primary" size="small" disabled={!canSend} onClick={submit}>
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
