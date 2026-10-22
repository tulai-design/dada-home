import { marked } from 'marked'
import { sanitizeHtml } from './rss'

marked.setOptions({
  gfm: true,
  breaks: true,
})

/** 把模型返回的 Markdown 转成安全的 HTML，代码块与表格都保留。 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return sanitizeHtml(html)
}
