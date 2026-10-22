import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Article, BookmarkGroup, Feed, Settings as SettingsShape, Todo, Weather as WeatherShape } from './lib/types'
import { useStored } from './lib/store'
import { SEARCH_ENGINES, defaultBookmarks, defaultFeeds, defaultSettings } from './lib/defaults'
import { fetchAllFeeds } from './lib/rss'
import { fetchWeather } from './lib/weather'
import { fetchBoards, hotOrigin, type HotBoard } from './lib/hot'
import { probe, type MonitorState, type RangeId } from './lib/monitor'
import { A, ActionIcon, Button, toast } from '@lobehub/ui'
import { RefreshCw } from 'lucide-react'
import { runAgent } from './lib/ai'
import { useInterval, useNow, useVisible } from './hooks'
import { clockText, greeting, monthDayCn, weekdayCn } from './lib/date'
import { isPageId, PAGES, type PageId } from './lib/pages'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import {
  BookmarksBlock,
  FeedBlock,
  HotBlock,
  NoteBlock,
  TaskBlock,
  WeatherBlock,
} from './components/Cards'
import { HeroSearch, type SearchMode } from './components/HeroSearch'
import { Reader } from './components/Reader'
import { Assistant } from './components/Assistant'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MonitorDrawer } from './components/Monitor'
import type { ChatTurn } from './lib/chat'
import { wallpaperUrl, type WallpaperMode } from './lib/wallpaper'

export default function App() {
  // 旧版本或手工改过的设置可能缺字段，读出来先和默认值合并，避免整页崩掉
  const [storedSettings, setSettings] = useStored<SettingsShape>('settings', defaultSettings())
  const settings: SettingsShape = useMemo(() => {
    const base = defaultSettings()
    const boards = Array.isArray(storedSettings.hotBoards) ? storedSettings.hotBoards.filter((id) => typeof id === 'string' && id.trim()) : []
    return {
      ...base,
      ...storedSettings,
      ai: { ...base.ai, ...(storedSettings.ai ?? {}) },
      monitor: Array.isArray(storedSettings.monitor) ? storedSettings.monitor : [],
      hotSource: hotOrigin(storedSettings.hotSource),
      hotBoards: boards.length ? boards : base.hotBoards,
      wallpaper: (['unsplash', 'custom', 'off'] as const).includes(storedSettings.wallpaper as WallpaperMode)
        ? (storedSettings.wallpaper as WallpaperMode)
        : 'unsplash',
      wallpaperIndex: Number.isFinite(storedSettings.wallpaperIndex) ? storedSettings.wallpaperIndex : 0,
      wallpaperUrl: typeof storedSettings.wallpaperUrl === 'string' ? storedSettings.wallpaperUrl : '',
    }
  }, [storedSettings])
  const [groups, setGroups] = useStored<BookmarkGroup[]>('bookmarks', defaultBookmarks())
  const [feeds, setFeeds] = useStored<Feed[]>('feeds', defaultFeeds())
  const [todos, setTodos] = useStored<Todo[]>('todos', [])
  const [note, setNote] = useStored<string>('note', '')
  const [readIds, setReadIds] = useStored<string[]>('read', [])

  const [articles, setArticles] = useState<Article[]>([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedErrors, setFeedErrors] = useState<string[]>([])

  const [weather, setWeather] = useState<WeatherShape | null>(null)

  const [hot, setHot] = useState<HotBoard[]>([])
  const [hotLoading, setHotLoading] = useState(false)
  const [hotError, setHotError] = useState('')

  const [monitorStates, setMonitorStates] = useState<Record<string, MonitorState>>({})
  const [range, setRange] = useStored<RangeId>('range', '24h')

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const [searchMode, setSearchMode] = useStored<SearchMode>('searchMode', 'ai')
  const [page, setPage] = useStored<PageId>('page', 'home')
  const currentPage: PageId = isPageId(page) ? page : 'home'
  const searchRef = useRef<HTMLInputElement>(null)

  const [reader, setReader] = useState<Article | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [seed, setSeed] = useState({ text: '', key: 0 })

  const now = useNow(settings.showSeconds ? 1000 : 20000)

  // 旧版本存下的主题值（paper/ink）需要迁移到新的 light/dark
  const stored: string = settings.theme as string
  const theme: 'dark' | 'light' = stored === 'dark' || stored === 'ink' ? 'dark' : 'light'
  useEffect(() => {
    if (settings.theme !== theme) setSettings((prev) => ({ ...prev, theme }))
  }, [settings.theme, theme, setSettings])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.primaryColor = 'red'
    document.title = `${settings.name === '朋友' ? '' : `${settings.name} · `}第一页`
  }, [theme, settings.name])

  const loadFeeds = useCallback(async () => {
    if (!feeds.some((f) => f.enabled !== false && f.url)) return
    setFeedLoading(true)
    try {
      const { articles: list, errors } = await fetchAllFeeds(feeds, settings.proxy)
      setArticles(list)
      setFeedErrors(errors)
    } finally {
      setFeedLoading(false)
    }
  }, [feeds, settings.proxy])

  const loadWeather = useCallback(async () => {
    try {
      setWeather(await fetchWeather(settings.lat, settings.lon, settings.city))
    } catch {
      /* 天气失败不影响其他模块 */
    }
  }, [settings.lat, settings.lon, settings.city])

  const loadHot = useCallback(async () => {
    if (!settings.hotBoards.length) {
      setHot([])
      return
    }
    setHotLoading(true)
    setHotError('')
    try {
      setHot(await fetchBoards(settings.hotSource, settings.hotBoards, settings.proxy, 16))
    } catch (err) {
      setHotError(err instanceof Error ? err.message : '热榜读取失败')
    } finally {
      setHotLoading(false)
    }
  }, [settings.hotSource, settings.hotBoards, settings.proxy])

  const loadMonitors = useCallback(
    async (nextRange: RangeId = range) => {
      if (!settings.monitor.length) {
        setMonitorStates({})
        return
      }
      setMonitorStates((prev) => {
        const next = { ...prev }
        for (const m of settings.monitor) next[m.id] = { status: 'loading' }
        return next
      })
      const results = await Promise.all(
        settings.monitor.map(async (config) => [config.id, await probe(config, settings.proxy, nextRange)] as const),
      )
      setMonitorStates(Object.fromEntries(results))
    },
    [settings.monitor, settings.proxy, range],
  )

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void loadFeeds()
    void loadWeather()
    void loadHot()
    void loadMonitors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const configKey = `${settings.proxy}|${settings.hotSource}|${settings.hotBoards.join(',')}|${settings.lat}|${settings.lon}|${feeds.length}`
  const lastKey = useRef(configKey)
  useEffect(() => {
    if (lastKey.current === configKey) return
    lastKey.current = configKey
    void loadFeeds()
    void loadWeather()
    void loadHot()
  }, [configKey, loadFeeds, loadWeather, loadHot])

  useInterval(() => void loadFeeds(), 1000 * 60 * 30)
  useInterval(() => void loadMonitors(), 1000 * 60 * 3)
  useVisible(() => void loadWeather())

  const digest = useMemo(() => {
    const tops = articles.slice(0, 10).map((a) => `- [${a.source}] ${a.title}`)
    const openTodos = todos.filter((t) => !t.done).map((t) => `- ${t.text}`)
    const parts: string[] = []
    if (tops.length) parts.push(`今日订阅：\n${tops.join('\n')}`)
    if (openTodos.length) parts.push(`未清待办：\n${openTodos.join('\n')}`)
    if (note.trim()) parts.push(`便签：\n${note.trim().slice(0, 500)}`)
    return parts.join('\n\n').slice(0, 3000)
  }, [articles, todos, note])

  const ask = useCallback(
    async (text: string) => {
      const ai = settings.ai
      if (!ai.baseUrl.trim() || !ai.model.trim()) {
        setTurns((prev) => [...prev, { kind: 'user', text }, { kind: 'error', text: '先到设置里填接口地址与模型。' }])
        return
      }
      const history = turns
        .filter((t): t is Extract<ChatTurn, { kind: 'user' | 'assistant' }> => t.kind === 'user' || t.kind === 'assistant')
        .map((t) => ({ role: t.kind === 'user' ? ('user' as const) : ('assistant' as const), content: t.text }))

      const messages = digest
        ? [
            { role: 'system' as const, content: `以下是用户今日首页的摘要，回答时可以引用：\n${digest}` },
            ...history,
            { role: 'user' as const, content: text },
          ]
        : [...history, { role: 'user' as const, content: text }]

      setTurns((prev) => [...prev, { kind: 'user', text }, { kind: 'assistant', text: '' }])
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        let acc = ''
        await runAgent({
          config: ai,
          messages,
          host: { openPage: setPage },
          onDelta: (chunk) => {
            acc += chunk
            setTurns((prev) => {
              const next = [...prev]
              next[next.length - 1] = { kind: 'assistant', text: acc }
              return next
            })
          },
          onTool: (info) => {
            toast[info.ok ? 'success' : 'error'](info.text)
            setTurns((prev) => {
              const next = [...prev]
              const last = next.pop()
              next.push({ kind: 'tool', ...info })
              if (last) next.push(last)
              return next
            })
          },
          signal: controller.signal,
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const message = err instanceof Error ? err.message : String(err)
          setTurns((prev) => [...prev, { kind: 'error', text: `请求失败：${message}` }])
          toast.error(message)
        }
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [settings.ai, turns, digest, setPage],
  )

  const doSearch = (query: string, engine: string) => {
    if (engine === 'direct') {
      window.open(/^https?:\/\//.test(query) ? query : `https://${query}`, '_blank', 'noopener')
      return
    }
    if (engine === 'monitor') {
      setMonitorOpen(true)
      return
    }
    const target = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]
    window.open(target.url + encodeURIComponent(query), '_blank', 'noopener')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (meta && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAssistantOpen((v) => !v)
      } else if (meta && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (e.key === '/' && !meta && !e.altKey && !typing) {
        e.preventDefault()
        setPage('home')
        searchRef.current?.focus()
      } else if (!meta && !e.altKey && !typing && e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        const next = PAGES[Number(e.key) - 1]
        if (next) setPage(next.id)
      } else if (e.key === 'Escape') {
        setReader(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteActions = useMemo(
    () => [
      { id: 'cmd-search', label: '聚焦搜索', hint: '/', group: '动作', glyph: '⌕', run: () => { setPage('home'); searchRef.current?.focus() } },
      ...PAGES.map((item, index) => ({
        id: `page-${item.id}`,
        label: `打开${item.label}`,
        hint: String(index + 1),
        group: '分页',
        glyph: '▣',
        run: () => setPage(item.id),
      })),
      { id: 'cmd-feeds', label: '刷新全部订阅', group: '动作', glyph: '↻', run: () => void loadFeeds() },
      { id: 'cmd-ai', label: '打开对话', hint: '⌘J', group: '动作', glyph: '✳', run: () => setAssistantOpen(true) },
      { id: 'cmd-monitor', label: '打开服务监控', group: '动作', glyph: '◫', run: () => setMonitorOpen(true) },
      { id: 'cmd-settings', label: '打开设置', hint: '⌘,', group: '动作', glyph: '⚙', run: () => setSettingsOpen(true) },
      {
        id: 'cmd-theme',
        label: theme === 'dark' ? '切换到浅色' : '切换到深色',
        group: '动作',
        glyph: '◐',
        run: () => setSettings((prev) => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' })),
      },
      ...feeds
        .filter((f) => f.enabled !== false)
        .map((f) => ({
          id: `feed-${f.id}`,
          label: f.title,
          group: '订阅源',
          glyph: '§',
          run: () => window.open(f.url, '_blank', 'noopener'),
        })),
    ],
    [feeds, theme, setSettings, loadFeeds, setPage],
  )

  const openArticle = (article: Article) => {
    setReader(article)
    if (!readIds.includes(article.id)) setReadIds((prev) => [...prev, article.id].slice(-500))
  }

  const unread = articles.filter((a) => !readIds.includes(a.id)).length
  const openTodos = todos.filter((t) => !t.done).length
  const monitorConfigs = settings.monitor
  const onlineCount = monitorConfigs.filter((c) => monitorStates[c.id]?.status === 'ok').length
  const tone: 'ok' | 'err' | 'loading' | '' = !monitorConfigs.length
    ? ''
    : onlineCount === monitorConfigs.length
      ? 'ok'
      : onlineCount === 0
        ? 'err'
        : 'loading'

  return (
    <ErrorBoundary>
      <div className="app">
        <Rail
          page={currentPage}
          onPage={setPage}
          onMonitor={() => setMonitorOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onTheme={() => setSettings((prev) => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' }))}
          theme={theme}
          unread={unread}
          openTodos={openTodos}
        />

        <div className="canvas">
          <TopBar
            clock={clockText(now, settings.showSeconds)}
            city={settings.city}
            pageLabel={PAGES.find((p) => p.id === currentPage)?.label ?? '首页'}
            onPalette={() => setPaletteOpen((v) => !v)}
            onSettings={() => setSettingsOpen(true)}
            onMonitor={() => setMonitorOpen(true)}
            monitorTone={tone}
            monitorLabel={monitorConfigs.length ? `${onlineCount}/${monitorConfigs.length}` : '未接入'}
          />

          <div className="page">
            {currentPage === 'home' && (
              <section
                className="home-stage"
                data-paper={settings.wallpaper === 'off' ? 'off' : 'on'}
                style={{ ['--paper' as string]: `url("${wallpaperUrl(settings.wallpaper, settings.wallpaperIndex, settings.wallpaperUrl)}")` }}
              >
                <div className="home-hero">
                  <div className="home-hero-card">
                  <div className="home-clock">
                    <span>{clockText(now, false)}</span>
                    {settings.showSeconds && <span className="home-clock-sec">{String(now.getSeconds()).padStart(2, '0')}</span>}
                  </div>
                  <p className="home-dateline">
                    {greeting(now)}，<em>{settings.name}</em>
                    <span>
                      {monthDayCn(now)} {weekdayCn(now)} · {unread} 篇未读
                    </span>
                  </p>
                  <HeroSearch
                    mode={searchMode}
                    onMode={setSearchMode}
                    model={settings.ai.model}
                    configured={Boolean(settings.ai.baseUrl.trim() && settings.ai.model.trim())}
                    busy={busy}
                    turns={turns}
                    inputRef={searchRef}
                    onSearch={doSearch}
                    onAsk={(text) => void ask(text)}
                    onStop={() => abortRef.current?.abort()}
                    onExpand={() => setAssistantOpen(true)}
                    onSettings={() => setSettingsOpen(true)}
                  />
                  </div>
                  {settings.wallpaper !== 'off' && (
                    <div className="home-paper-bar">
                      {settings.wallpaper === 'unsplash' && (
                        <A href="https://unsplash.com" target="_blank" rel="noreferrer noopener">
                          Unsplash
                        </A>
                      )}
                      {settings.wallpaper === 'unsplash' && (
                        <ActionIcon
                          icon={RefreshCw}
                          title="换一张"
                          onClick={() => setSettings({ ...settings, wallpaperIndex: settings.wallpaperIndex + 1 })}
                        />
                      )}
                    </div>
                  )}
                </div>
                <footer className="home-band">
                  <section>
                    <h2>天气</h2>
                    <WeatherBlock weather={weather} />
                  </section>
                  <section>
                    <h2>待办</h2>
                    <Button type="text" block className="band-jump" onClick={() => setPage('desk')}>
                      {openTodos} 件未完成
                    </Button>
                    <ul className="home-mini">
                      {todos
                        .filter((t) => !t.done)
                        .slice(0, 3)
                        .map((todo) => (
                          <li key={todo.id}>{todo.text}</li>
                        ))}
                    </ul>
                  </section>
                  <section>
                    <h2>今日</h2>
                    <ul className="home-digest">
                      {articles.slice(0, 4).map((article) => (
                        <li key={article.id}>
                          <Button type="text" block onClick={() => openArticle(article)}>
                            <span className="dock-line">
                              <em>{article.source}</em>
                              {article.title}
                            </span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h2>{hot[0]?.name || '热榜'}</h2>
                    <ol className="home-hot">
                      {(hot[0]?.items ?? []).slice(0, 4).map((item, index) => (
                        <li key={`${item.title}-${index}`}>
                          <A href={item.url || `https://www.bing.com/search?q=${encodeURIComponent(item.title)}`} target="_blank" rel="noreferrer noopener">
                            {item.title}
                          </A>
                        </li>
                      ))}
                    </ol>
                  </section>
                </footer>
              </section>
            )}

            {currentPage === 'feeds' && (
              <FeedBlock
                articles={articles}
                loading={feedLoading}
                errors={feedErrors}
                readIds={readIds}
                onOpen={openArticle}
                onRefresh={() => void loadFeeds()}
                onManage={() => setSettingsOpen(true)}
              />
            )}

            {currentPage === 'desk' && (
              <div className="desk-grid">
                <TaskBlock todos={todos} onTodos={setTodos} />
                <NoteBlock value={note} onChange={setNote} />
              </div>
            )}

            {currentPage === 'marks' && (
              <BookmarksBlock
                groups={groups}
                settings={settings}
                onEdit={() => setSettingsOpen(true)}
                onDelete={(groupId, itemId) =>
                  setGroups((prev) =>
                    prev.map((g) => (g.id === groupId ? { ...g, items: g.items.filter((i) => i.id !== itemId) } : g)),
                  )
                }
              />
            )}

            {currentPage === 'hot' && (
              <HotBlock boards={hot} loading={hotLoading} error={hotError} onRefresh={() => void loadHot()} />
            )}
          </div>
        </div>

        <Reader
          article={reader}
          ai={settings.ai}
          onClose={() => setReader(null)}
          onMarkRead={(id) => setReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
          onAskAi={(prompt) => {
            setReader(null)
            setAssistantOpen(true)
            setSeed((s) => ({ text: prompt, key: s.key + 1 }))
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <Assistant
          open={assistantOpen}
          ai={settings.ai}
          turns={turns}
          busy={busy}
          seed={seed}
          onSend={(text) => void ask(text)}
          onStop={() => abortRef.current?.abort()}
          onClose={() => setAssistantOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onClear={() => setTurns([])}
        />

        {monitorOpen && (
        <MonitorDrawer
          configs={monitorConfigs}
          states={monitorStates}
          range={range}
          onRange={(r) => {
            setRange(r)
            void loadMonitors(r)
          }}
          onClose={() => setMonitorOpen(false)}
          onRefresh={() => void loadMonitors()}
          onSettings={() => {
            setMonitorOpen(false)
            setSettingsOpen(true)
          }}
        />
        )}

        <CommandPalette
          open={paletteOpen}
          groups={groups}
          extra={paletteActions}
          onClose={() => setPaletteOpen(false)}
          onSearch={doSearch}
        />

        <Settings
          open={settingsOpen}
          settings={settings}
          feeds={feeds}
          groups={groups}
          onSettings={setSettings}
          onFeeds={setFeeds}
          onGroups={setGroups}
          onClose={() => setSettingsOpen(false)}
          onReset={() => {
            setSettings(defaultSettings())
            setGroups(defaultBookmarks())
            setFeeds(defaultFeeds())
            setTodos([])
            setNote('')
            setReadIds([])
            setSettingsOpen(false)
            void loadFeeds()
          }}
        />
      </div>
    </ErrorBoundary>
  )
}
