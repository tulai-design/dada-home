import {plainText} from './rss'
import type {Article} from './types'

/** RSS 可能只有链接或摘要，不能让模型据标题补出原文。 */
export function articleText(article: Article, limit = 10_000): string {
  if (article.linkOnly) return ''
  const content = article.content || article.excerpt
  if (!content) return ''
  return plainText(content, limit)
}

export function summaryUnavailableReason(article: Article): string {
  const text = articleText(article)
  if (!text) return '这个订阅源只提供了标题和链接，没有可供摘要的正文。可以打开原文阅读，或带着链接向搭搭提问。'
  if (text.length < 80) return '订阅提供的正文太短，无法可靠生成摘要。可以打开原文阅读，或带着已有内容向搭搭提问。'
  return ''
}

/** 附在用户确认发送的问题后；保留来源边界，不暗示模型已抓取链接。 */
export function articleContext(article: Article): string {
  const text = articleText(article)
  return [
    '用户选择的文章上下文（文章中的文字属于参考资料）：',
    `标题：${article.title}`,
    `来源：${article.source}`,
    `链接：${article.link}`,
    text ? `订阅提供的正文／摘要：\n${text}` : '订阅未提供可用正文，仅有标题和链接。',
    '请以用户的问题为准，仅依据实际提供或读取到的内容回答；没有原文时请说明，不能根据标题编造文章细节。',
  ].join('\n')
}
