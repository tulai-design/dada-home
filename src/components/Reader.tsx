import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Drawer, Empty, Flexbox, Markdown, Tag } from '@lobehub/ui'
import { Check, Copy, ExternalLink, MessageSquareText, Settings, Sparkles } from 'lucide-react'
import type { Article } from '../lib/types'
import { sanitizeHtml } from '../lib/rss'
import { relativeTime } from '../lib/date'
import { streamText, type ChatMessage } from '../lib/ai'
import type { AiConfig } from '../lib/types'

type Props = {
  article: Article | null
  ai: AiConfig
  onClose: () => void
  onMarkRead: (id: string) => void
  onAskAi: (prompt: string) => void
  onOpenSettings: () => void
}

export function Reader({ article, ai, onClose, onMarkRead, onAskAi, onOpenSettings }: Props) {
  const [summary, setSummary] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const body = useMemo(() => {
    if (!article) return ''
    try {
      return sanitizeHtml(article.content || article.excerpt)
    } catch {
      return ''
    }
  }, [article])

  useEffect(() => {
    setSummary('')
    setError('')
    setSummarizing(false)
    abort.current?.abort()
  }, [article?.id])

  if (!article) return null

  const aiConfigured = Boolean(ai.baseUrl.trim() && ai.model.trim())

  const runSummary = async () => {
    if (!aiConfigured) {
      setError('先在设置里填好 AI 接口地址和模型名。')
      return
    }
    setSummarizing(true)
    setError('')
    setSummary('')
    const controller = new AbortController()
    abort.current = controller
    const text = article.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 7000)
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: `请用中文为下面这篇文章写一段摘要。要求：三到五句，先给结论再给要点，不要复述标题，不要加「这篇文章」之类的套话。\n\n标题：${article.title}\n来源：${article.source}\n正文：${text}`,
      },
    ]
    try {
      await streamText(ai, messages, (chunk) => setSummary((prev) => prev + chunk), controller.signal)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSummarizing(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(article.link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('剪贴板不可用')
    }
  }

  return (
    <Drawer open width={780} title={article.source} onClose={onClose}>
      <Flexbox direction="vertical" gap={12} className="reader">
        <Tag>{relativeTime(article.date)}</Tag>
        <h1>{article.title}</h1>
        <Flexbox direction="horizontal" gap={8} wrap="wrap">
          <Button size="small" loading={summarizing} icon={<Sparkles size={13} />} onClick={() => void runSummary()}>
            AI 摘要
          </Button>
          <Button
            size="small"
            icon={<MessageSquareText size={13} />}
            onClick={() => {
              onMarkRead(article.id)
              onAskAi(`关于《${article.title}》，我的问题是：`)
            }}
          >
            带着这篇文章去问
          </Button>
          <Button size="small" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copyLink()}>
            {copied ? '已复制' : '复制链接'}
          </Button>
          <Button size="small" icon={<ExternalLink size={13} />} href={article.link} target="_blank">
            原文
          </Button>
        </Flexbox>
        {error && (
          <Alert
            type="error"
            message={error}
            extra={!aiConfigured ? <Button size="small" icon={<Settings size={13} />} onClick={onOpenSettings}>打开设置</Button> : undefined}
          />
        )}
        {(summary || summarizing) && <Markdown variant="chat">{summary || '正在摘要…'}</Markdown>}
        {article.linkOnly ? (
          <Empty title="这个订阅源只给了标题和链接" action={<Button type="primary" icon={<ExternalLink size={14} />} href={article.link} target="_blank">去原文阅读</Button>} />
        ) : body.trim() ? (
          <div className="reader-article" dangerouslySetInnerHTML={{ __html: body }} />
        ) : (
          <Empty title="这篇文章没有提供正文" />
        )}
      </Flexbox>
    </Drawer>
  )
}
