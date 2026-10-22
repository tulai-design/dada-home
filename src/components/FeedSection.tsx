import { useMemo, useState } from 'react'
import type { Article, BookmarkGroup } from '../lib/types'
import { relativeTime } from '../lib/date'

type Props = {
  articles: Article[]
  loading: boolean
  errors: string[]
  readIds: string[]
  groups: BookmarkGroup[]
  onOpen: (article: Article) => void
  onRefresh: () => void
  onManage: () => void
}

export function FeedSection({ articles, loading, errors, readIds, groups, onOpen, onRefresh, onManage }: Props) {
  const sources = useMemo(() => {
    const set = new Map<string, number>()
    articles.forEach((a) => set.set(a.source, (set.get(a.source) ?? 0) + 1))
    return Array.from(set.entries())
  }, [articles])

  const [filter, setFilter] = useState<string>('__all')
  const shown = useMemo(() => {
    const list = filter === '__all' ? articles : articles.filter((a) => a.source === filter)
    return list.slice(0, 40)
  }, [articles, filter])

  const unread = shown.filter((a) => !readIds.includes(a.id)).length

  return (
    <section className="section" id="feeds">
      <div className="section-head">
        <div className="title">
          <span className="num">02</span>
          <span>订阅</span>
          <span className="count">{unread} 未读</span>
        </div>
        <div className="aside">
          <button className="text-btn" onClick={onRefresh}>
            {loading ? '收取中…' : '刷新'}
          </button>
          <button className="text-btn" onClick={onManage}>
            订阅源
          </button>
        </div>
      </div>

      <div className="feed-toolbar">
        <div className="feed-tabs" role="tablist">
          <button className="feed-tab" role="tab" aria-selected={filter === '__all'} onClick={() => setFilter('__all')}>
            全部
          </button>
          {sources.map(([source, count]) => (
            <button
              key={source}
              className="feed-tab"
              role="tab"
              aria-selected={filter === source}
              onClick={() => setFilter(source)}
            >
              {source} <span style={{ color: 'var(--ink-ghost)', fontSize: 10 }}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <p className="empty-note" style={{ color: 'var(--accent)', fontStyle: 'normal', fontSize: 12 }}>
          {errors.slice(0, 2).join('；')}
          {errors.length > 2 && ` 等 ${errors.length} 个源失败`}
        </p>
      )}

      {shown.length ? (
        <ul className="article-list">
          {shown.map((article) => (
            <li
              key={article.id}
              className={`article${readIds.includes(article.id) ? ' read' : ''}`}
              onClick={() => onOpen(article)}
            >
              <div className="article-title">
                {filter === '__all' && <span className="source-tag">{article.source}</span>}
                {article.title}
              </div>
              <div className="article-meta">{relativeTime(article.date)}</div>
              {article.excerpt && <div className="article-excerpt">{article.excerpt}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">
          {loading ? '正在从各处收取…' : groups.length ? '暂时没有新文章，稍后再刷。' : '还没有订阅源。'}
        </p>
      )}
    </section>
  )
}
