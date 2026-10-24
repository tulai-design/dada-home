import {Button, Flexbox, Text} from '@lobehub/ui'
import {Check, ShieldQuestion, X} from 'lucide-react'
import type {ApprovalRequest} from '../lib/ai'

/**
 * 操作确认卡片。
 *
 * 出现在对话流里触发它的那一轮下方：AI 想做一个需要确认的操作时停下，
 * 等用户点。同意就继续执行，拒绝就把「用户拒绝了」回灌给模型。
 *
 * 不用弹窗：弹窗会盖住对话上下文，而用户判断要不要删，正需要看到刚才发生了什么。
 */
export function ApprovalCard({
  request,
  onAnswer,
}: {
  request: ApprovalRequest
  onAnswer: (approved: boolean | 'always') => void
}) {
  return (
    <Flexbox className="approval-card" gap={8}>
      <Flexbox direction="horizontal" align="center" gap={6}>
        <ShieldQuestion size={15} className="approval-icon" />
        <Text strong>{request.tool}</Text>
        <Text type="secondary" fontSize={12}>
          需要你确认
        </Text>
      </Flexbox>
      <Text className="approval-summary">{request.summary}</Text>
      <Flexbox direction="horizontal" gap={8}>
        <Button type="primary" size="small" icon={<Check size={14} />} onClick={() => onAnswer(true)}>
          允许
        </Button>
        {request.remember && (
          <Button size="small" onClick={() => onAnswer('always')} title={`以后「${request.remember}」不再询问，可以在设置里随时关掉`}>
            总是允许
          </Button>
        )}
        <Button size="small" icon={<X size={14} />} onClick={() => onAnswer(false)}>
          拒绝
        </Button>
      </Flexbox>
    </Flexbox>
  )
}
