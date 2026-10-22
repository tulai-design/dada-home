import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A, ActionIcon, toast } from '@lobehub/ui'
import { RefreshCw } from 'lucide-react'
import { useStored } from './lib/store'
import { SEARCH_ENGINES, defaultBookmarks, defaultFeeds, defaultSettings } from './lib/defaults'
import { hotOrigin } from './lib/hot'
import { probe, type MonitorState, type RangeId } from './lib/monitor'
import { runAgent, type ApprovalRequest, type ChatMessage } from './lib/ai'
import { useInterval, useVisible } from './hooks'
import { clockText } from './lib/date'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import { PageView } from './components/PageView'
import { Reader } from './components/Reader'
import { Assistant } from './components/Assistant'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MonitorDrawer } from './components/Monitor'
import { beginTurn, useTurns, type Turn } from './lib/chat'
import type { Article, BookmarkGroup, Feed, Settings as SettingsShape } from './lib/types'
import type { ComponentHost } from './lib/registry'
import { useWorkspace } from './lib/workspaceStore'
import { grantHost, removeComponent, updateComponent } from './lib/ops'
import { removeData, useComponentData, SHARED } from './lib/componentData'
import { wallpaperUrl } from './lib/wallpaper'
import './widgets'

/**
 * 应用外壳。
 *
 * 它只做三件事：
 *   1. 维护全局设置与共享数据（用户、订阅源、书签、监控、AI 配置）
 *   2. 把应用能力打包成 ComponentHost 交给组件
 *   3. 渲染 Rail / TopBar / PageView / 各抽屉
 *
 * 页面内容不在这里 —— 在 PageView 里，由工作空间数据决定。
 */
export default function App() {
  const [storedSettings, setSettings] = useStored<SettingsShape>('settings', defaultSettings())
  const settings: SettingsShape = useMemo(() => {
    const base = defaultSettings()
    return {
      ...base,
      ...storedSettings,
      ai: { ...base.ai, ...(storedSettings.ai ?? {}) },
      monitor: Array.isArray(storedSettings.monitor) ? storedSettings.monitor : [],
      hotSource: hotOrigin(storedSettings.hotSource),
    }
  }, [storedSettings])

  // 订阅源和书签是跨组件共享的数据，存在固定命名空间下（见 componentData.SHARED）
  const [groups, setGroups] = useComponentData<BookmarkGroup[]>(SHARED.bookmarks, defaultBookmarks())
  const [feeds, setFeeds] = useComponentData<Feed[]>(SHARED.feeds, defaultFeeds())

  const [monitorStates, setMonitorStates] = useState<Record<string, MonitorState>>({})
  const [range, setRange] = useStored<RangeId>('range', '24h')

  const [turns, setTurns] = useTurns()
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 待答复的确认请求：由 ask 写入，由确认卡片按钮调用。 */
  const settleRef = useRef<((approved: boolean) => void) | null>(null)

  const [pageId, setPageId] = useStored<string>('page', 'home')
  const [pendingPage, setPendingPage] = useState<string | null>(null)

  const [reader, setReader] = useState<Article | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { workspace, edit } = useWorkspace()

  // 页面可能被删除或改名：存下来的 id 失效时回落到第一页
  const currentPage = workspace.pages.find((page) => page.id === pageId) ?? workspace.pages[0]
  useEffect(() => {
    if (currentPage && currentPage.id !== pageId) setPageId(currentPage.id)
  }, [currentPage, pageId, setPageId])

  // AI 工具调用 open_page 时先记下目标，等下一帧再切，避免在渲染期间改状态
  useEffect(() => {
    if (!pendingPage) return
    if (workspace.pages.some((page) => page.id === pendingPage)) setPageId(pendingPage)
    setPendingPage(null)
  }, [pendingPage, workspace.pages, setPageId])

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme.mode
    document.documentElement.dataset.primaryColor = 'red'
    for (const [name, value] of Object.entries(workspace.theme.overrides)) {
      document.documentElement.style.setProperty(`--${name}`, value)
    }
    document.title = `${settings.name === '朋友' ? '' : `${settings.name} · `}搭搭`
  }, [workspace.theme, settings.name])

  // 已读记录是共享数据，订阅组件读写它；外壳只需要把当前值传给宿主
  const [readIds, setReadIds] = useStored<string[]>('read', [])

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
    void loadMonitors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useInterval(() => void loadMonitors(), 1000 * 60 * 3)
  useVisible(() => void loadMonitors())

  const aiConfigured = Boolean(settings.ai.baseUrl.trim() && settings.ai.model.trim())

  const ask = useCallback(
    async (text: string) => {
      const turn = beginTurn(text)
      if (!aiConfigured) {
        setTurns((prev) => [...prev, {...turn, error: '先到设置里填接口地址与模型。', endedAt: Date.now()}])
        return
      }

      // 历史按轮展开成消息：只带问答正文，思考过程和工具细节不进上下文
      const history: ChatMessage[] = turns.flatMap((t) => {
        const items: ChatMessage[] = [{ role: 'user', content: t.prompt }]
        if (t.answer) items.push({ role: 'assistant', content: t.answer })
        return items
      })

      setTurns((prev) => [...prev, turn])
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller

      /** 只改这一轮，不碰其它轮。 */
      const patch = (part: Partial<Turn>) =>
        setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, ...part } : t)))

      /**
       * 把确认请求交给界面，等用户点。
       * 答复函数存进 ref，让界面上的按钮能触发；只 resolve 一次，之后清空。
       */
      const onApproval = (request: ApprovalRequest) =>
        new Promise<boolean>((resolve) => {
          settleRef.current = (approved) => {
            settleRef.current = null
            patch({ pending: undefined })
            resolve(approved)
          }
          patch({ pending: { request } })
        })

      let answer = ''
      let reasoning = ''
      try {
        await runAgent({
          config: settings.ai,
          messages: [...history, { role: 'user', content: text }],
          host: { openPage: (next: string) => setPendingPage(next) },
          onApproval,
          onReasoning: (chunk) => {
            reasoning += chunk
            patch({ reasoning })
          },
          onDelta: (chunk) => {
            answer += chunk
            patch({ answer })
          },
          onTool: (info) => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turn.id
                  ? { ...t, tools: [...t.tools, { name: info.name, title: info.title, ok: info.ok, text: info.text }] }
                  : t,
              ),
            )
            // 成功不打扰；失败才提示，细节已在对话里
            if (!info.ok) toast.error(info.text)
          },
          signal: controller.signal,
        })
        patch({ endedAt: Date.now() })
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          patch({ endedAt: Date.now(), aborted: true })
        } else {
          const message = err instanceof Error ? err.message : String(err)
          patch({ endedAt: Date.now(), error: `请求失败：${message}` })
          toast.error(message)
        }
      } finally {
        setBusy(false)
        abortRef.current = null
        // 中止或出错时若有未答复的确认，一并清掉，否则卡片会一直挂着
        settleRef.current?.(false)
        patch({ pending: undefined })
      }
    },
    [settings.ai, turns, aiConfigured, setTurns],
  )

  /** 用户点了确认卡片上的允许/拒绝。 */
  const answerApproval = useCallback(
    (approved: boolean) => {
      const current = settleRef.current
      settleRef.current = null
      if (current) current(approved)
    },
    [],
  )

  const doSearch = useCallback((query: string, engine: string) => {
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
  }, [])

  const openArticle = useCallback(
    (article: Article) => {
      setReader(article)
    },
    [],
  )

  /** 交给组件的应用能力。组件不直接碰 store，也不直接改工作空间。 */
  const host: ComponentHost = useMemo(
    () => ({
      openPage: (id) => setPendingPage(id),
      openSettings: () => setSettingsOpen(true),
      openMonitor: () => setMonitorOpen(true),
      openAssistant: () => setAssistantOpen(true),
      openArticle,
      readIds,
      markRead: (id: string) => setReadIds((prev: string[]) => (prev.includes(id) ? prev : [...prev, id].slice(-500))),
      proxy: settings.proxy,
      hotSource: settings.hotSource,
      ask: (text) => void ask(text),
      aiConfigured,
      aiModel: settings.ai.model,
      aiBusy: busy,
      search: doSearch,
      networkGrants: workspace.network.map((grant) => grant.host),
      // 用户点「允许访问」是明确的主动行为，直接授权，不再二次确认
      requestNetworkGrant: (host: string) => edit((ws) => grantHost(ws, host)),
      profile: {
        name: settings.name,
        city: settings.city,
        lat: settings.lat,
        lon: settings.lon,
        showSeconds: settings.showSeconds,
        showFavicons: settings.showFavicons,
      },
    }),
    [settings, readIds, setReadIds, ask, aiConfigured, busy, doSearch, openArticle, edit, workspace.network],
  )

  const onUpdateConfig = useCallback(
    (instanceId: string, patch: Record<string, unknown>) => {
      edit((ws) => updateComponent(ws, instanceId, { config: patch }).workspace)
    },
    [edit],
  )

  const onRemoveComponent = useCallback(
    (instanceId: string) => {
      edit((ws) => removeComponent(ws, instanceId).workspace)
      removeData(instanceId)
    },
    [edit],
  )

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
      } else if (!meta && !e.altKey && !typing && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const next = workspace.pages[Number(e.key) - 1]
        if (next) setPageId(next.id)
      } else if (e.key === 'Escape') {
        setReader(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspace.pages, setPageId])

  const paletteActions = useMemo(
    () => [
      ...workspace.pages.map((page, index) => ({
        id: `page-${page.id}`,
        label: `打开${page.label}`,
        hint: String(index + 1),
        group: '分页',
        glyph: '▣',
        run: () => setPageId(page.id),
      })),
      { id: 'cmd-ai', label: '打开对话', hint: '⌘J', group: '动作', glyph: '✳', run: () => setAssistantOpen(true) },
      { id: 'cmd-monitor', label: '打开服务监控', group: '动作', glyph: '◫', run: () => setMonitorOpen(true) },
      { id: 'cmd-settings', label: '打开设置', hint: '⌘,', group: '动作', glyph: '⚙', run: () => setSettingsOpen(true) },
      {
        id: 'cmd-theme',
        label: workspace.theme.mode === 'dark' ? '切换到浅色' : '切换到深色',
        group: '动作',
        glyph: '◐',
        run: () => edit((ws) => ({ ...ws, theme: { ...ws.theme, mode: ws.theme.mode === 'dark' ? 'light' : 'dark' } })),
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
    [workspace.pages, workspace.theme.mode, feeds, edit, setPageId],
  )

  const monitorConfigs = settings.monitor
  const onlineCount = monitorConfigs.filter((c) => monitorStates[c.id]?.status === 'ok').length
  const tone: 'ok' | 'err' | 'loading' | '' = !monitorConfigs.length
    ? ''
    : onlineCount === monitorConfigs.length
      ? 'ok'
      : onlineCount === 0
        ? 'err'
        : 'loading'

  const paper = currentPage?.wallpaper
  const paperUrl = paper ? wallpaperUrl(paper.mode as never, paper.mode === 'unsplash' ? paper.index : 0, paper.mode === 'custom' ? paper.url : '') : ''

  return (
    <ErrorBoundary>
      <div className="app">
        <Rail
          pages={workspace.pages}
          page={currentPage?.id ?? ''}
          onPage={(id) => setPageId(id)}
          onMonitor={() => setMonitorOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onTheme={() =>
            edit((ws) => ({ ...ws, theme: { ...ws.theme, mode: ws.theme.mode === 'dark' ? 'light' : 'dark' } }))
          }
          theme={workspace.theme.mode}
        />

        <div className="canvas">
          <TopBar
            clock={clockText(new Date(), settings.showSeconds)}
            city={settings.city}
            pageLabel={currentPage?.label ?? ''}
            onPalette={() => setPaletteOpen((v) => !v)}
            onSettings={() => setSettingsOpen(true)}
            onMonitor={() => setMonitorOpen(true)}
            monitorTone={tone}
            monitorLabel={monitorConfigs.length ? `${onlineCount}/${monitorConfigs.length}` : '未接入'}
          />

          <div
            className="page"
            data-paper={paperUrl ? 'on' : 'off'}
            style={paperUrl ? { ['--paper' as string]: `url("${paperUrl}")` } : undefined}
          >
            {currentPage && (
              <PageView
                page={currentPage}
                workspace={workspace}
                host={host}
                onUpdateConfig={onUpdateConfig}
                onRemove={onRemoveComponent}
              />
            )}
            {paper?.mode === 'unsplash' && (
              <div className="home-paper-bar">
                <A href="https://unsplash.com" target="_blank" rel="noreferrer noopener">
                  Unsplash
                </A>
                <ActionIcon
                  icon={RefreshCw}
                  title="换一张"
                  onClick={() =>
                    edit((ws) => ({
                      ...ws,
                      pages: ws.pages.map((page) =>
                        page.id === currentPage.id && page.wallpaper?.mode === 'unsplash'
                          ? { ...page, wallpaper: { mode: 'unsplash', index: page.wallpaper.index + 1 } }
                          : page,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        </div>

        <Reader
          article={reader}
          ai={settings.ai}
          onClose={() => setReader(null)}
          onMarkRead={() => undefined}
          onAskAi={(prompt) => {
            setReader(null)
            setAssistantOpen(true)
            void ask(prompt)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <Assistant
          open={assistantOpen}
          ai={settings.ai}
          turns={turns}
          busy={busy}
          seed={{ text: '', key: 0 }}
          onSend={(text) => void ask(text)}
          onStop={() => abortRef.current?.abort()}
          onClose={() => setAssistantOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onClear={() => setTurns([])}
          onApprovalAnswer={answerApproval}
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
          onSettings={(next) => setSettings(next)}
          onFeeds={(next) => setFeeds(next)}
          onGroups={(next) => setGroups(next)}
          onClose={() => setSettingsOpen(false)}
          onReset={() => {
            localStorage.clear()
            location.reload()
          }}
        />
      </div>
    </ErrorBoundary>
  )
}
