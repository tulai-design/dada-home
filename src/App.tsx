import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A, ActionIcon, toast } from '@lobehub/ui'
import {SquaresFour as LayoutGrid, Monitor, Moon, Palette, ArrowsClockwise as RefreshCw, Rss, Gear as Settings, Sparkle as Sparkles, Sun} from '@phosphor-icons/react'
import { pageIcon } from './lib/pageIcons'
import { FROZEN_PAGE_ID, activeTheme } from './lib/workspace'
import { applyTheme, setMode } from './lib/themes'
import { useStored } from './lib/store'
import { SEARCH_ENGINES, defaultBookmarks, defaultFeeds, defaultSettings } from './lib/defaults'
import { hotOrigin } from './lib/hot'
import { probe, summarize, type MonitorState, type RangeId } from './lib/monitor'
import { runAgent, type ApprovalRequest, type ChatMessage } from './lib/ai'
import { useInterval, useVisible } from './hooks'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import { StatusBar } from './components/StatusBar'
import { PageSwitcher } from './components/PageSwitcher'
import { PageView } from './components/PageView'
import { FxLayers, hasBackdrop } from './fx/Fx'
import { Reader } from './components/Reader'
import { Assistant } from './components/Assistant'
import { CommandPalette } from './components/CommandPalette'
import { SettingsPage } from './components/SettingsPage'
import type { AppSettingsContext } from './lib/apps'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MonitorPage } from './components/Monitor'
import { MarketPage } from './components/MarketPage'
import { isInstalled } from './lib/market'
import { resetStorage } from './lib/storage'
import { beginTurn, contextTurns, initChat, useChat, type Turn } from './lib/chat'
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
      // 0.6 是旧版本的默认温度，而且当时根本没发给接口；当作「没设置」，别让升级悄悄改变模型的行为
      ai: { ...base.ai, ...(storedSettings.ai ?? {}), ...(storedSettings.ai?.temperature === 0.6 ? { temperature: undefined } : {}) },
      monitor: Array.isArray(storedSettings.monitor) ? storedSettings.monitor : [],
      hotSource: hotOrigin(storedSettings.hotSource),
    }
  }, [storedSettings])

  // 订阅源和书签是跨组件共享的数据，存在固定命名空间下（见 componentData.SHARED）
  const [groups, setGroups] = useComponentData<BookmarkGroup[]>(SHARED.bookmarks, defaultBookmarks())
  const [feeds, setFeeds] = useComponentData<Feed[]>(SHARED.feeds, defaultFeeds())

  const [monitorStates, setMonitorStates] = useState<Record<string, MonitorState>>({})
  const [range, setRange] = useStored<RangeId>('range', '24h')

  const chat = useChat()
  const { turns, setTurns, newConv } = chat
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 待答复的确认请求：由 ask 写入，由确认卡片按钮调用。 */
  const settleRef = useRef<((approved: boolean | 'always') => void) | null>(null)

  const [pageId, setPageId] = useStored<string>('page', 'home')
  const [pendingPage, setPendingPage] = useState<string | null>(null)

  const [reader, setReader] = useState<Article | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  // 对话面板有两种样子：侧栏（快速看一眼）和全屏。
  // 从侧栏图标、⌘J 进来用用户的偏好（默认全屏）；在首页输入框发出的消息先用侧栏，直接看到回答。
  const [assistantMode, setAssistantMode] = useState<'drawer' | 'full'>('drawer')
  const [sidebarAi] = useStored<'drawer' | 'full'>('sidebarAi', 'full')
  const [fxRoot, setFxRoot] = useState<HTMLDivElement | null>(null)
  const assistantOpenRef = useRef(false)
  assistantOpenRef.current = assistantOpen
  const openAssistant = useCallback(
    (mode?: 'drawer' | 'full') => {
      setAssistantMode(mode ?? sidebarAi)
      setAssistantOpen(true)
    },
    [sidebarAi],
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  // 当前画布显示什么：普通页面、设置、监控。设置和监控是整页，不再用抽屉
  const [view, setView] = useState<'page' | 'settings' | 'monitor' | 'market'>('page')
  const [section, setSection] = useState('profile')

  const { workspace, edit } = useWorkspace()

  const goPage = useCallback(
    (id: string) => {
      setPageId(id)
      setView('page')
    },
    [setPageId],
  )
  /** 打开设置页；section 指定落在哪一项（热榜、ai…）。从对话面板、阅读器里打开时先收起它们。 */
  const openSettings = useCallback((target?: string) => {
    setAssistantOpen(false)
    setReader(null)
    if (typeof target === 'string' && target) setSection(target)
    setView('settings')
  }, [])
  const openMonitor = useCallback(() => {
    setAssistantOpen(false)
    setView('monitor')
  }, [])
  const openMarket = useCallback(() => {
    setAssistantOpen(false)
    setView('market')
  }, [])

  // 页面可能被删除或改名：存下来的 id 失效时回落到第一页
  const currentPage = workspace.pages.find((page) => page.id === pageId) ?? workspace.pages[0]
  useEffect(() => {
    if (currentPage && currentPage.id !== pageId) setPageId(currentPage.id)
  }, [currentPage, pageId, setPageId])

  // AI 工具调用 open_page 时先记下目标，等下一帧再切，避免在渲染期间改状态
  useEffect(() => {
    if (!pendingPage) return
    if (workspace.pages.some((page) => page.id === pendingPage)) {
      setPageId(pendingPage)
      setView('page')
    }
    setPendingPage(null)
  }, [pendingPage, workspace.pages, setPageId])

  // 应用主题：明暗 + 当前主题的变量。切换主题时要把上一个主题设过的变量清掉，不然会残留。
  const theme = activeTheme(workspace)
  const appliedVars = useRef<string[]>([])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = workspace.theme.mode
    root.dataset.primaryColor = 'red'
    for (const name of appliedVars.current) root.style.removeProperty(`--${name}`)
    appliedVars.current = Object.keys(theme.overrides)
    for (const [name, value] of Object.entries(theme.overrides)) root.style.setProperty(`--${name}`, value)
    document.title = `${settings.name === '朋友' ? '' : `${settings.name} · `}搭搭`
  }, [workspace.theme.mode, theme, settings.name])

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

  /**
   * 发一句话给搭搭。
   * fresh：先开一个新对话再发（从首页输入框、阅读器这类「外面」发起的提问，不该混进之前聊到一半的话题）；
   * 在对话面板里接着问则不传，继续当前对话。
   */
  const ask = useCallback(
    async (text: string, options?: { fresh?: boolean }) => {
      await initChat()
      if (options?.fresh) await newConv()
      const turn = beginTurn(text)
      if (!aiConfigured) {
        setTurns((prev) => [...prev, {...turn, error: '先到设置里填接口地址与模型。', endedAt: Date.now()}])
        return
      }

      // 历史按轮展开成消息：只带问答正文，思考过程和工具细节不进上下文
      const history: ChatMessage[] = contextTurns(options?.fresh ? [] : turns, settings.ai.contextTurns).flatMap((t) => {
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
        new Promise<boolean | 'always'>((resolve) => {
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
          userName: settings.name,
          messages: [...history, { role: 'user', content: text }],
          host: { openPage: (next: string) => setPendingPage(next), openSettings: (section?: string) => openSettings(section) },
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
    [settings.ai, turns, aiConfigured, setTurns, newConv],
  )

  /** 用户点了确认卡片上的允许/拒绝。 */
  const answerApproval = useCallback(
    (approved: boolean | 'always') => {
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
      openMonitor()
      return
    }
    const target = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]
    window.open(target.url + encodeURIComponent(query), '_blank', 'noopener')
  }, [openMonitor])

  const openArticle = useCallback(
    (article: Article) => {
      setReader(article)
    },
    [],
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
  const monitorInfo: ComponentHost['monitor'] = useMemo(
    () => ({
      online: onlineCount,
      total: monitorConfigs.length,
      tone,
      items: monitorConfigs.map((config) => {
        const state = monitorStates[config.id]
        const itemTone: 'ok' | 'err' | 'loading' | '' = state?.status === 'ok' ? 'ok' : state?.status === 'error' ? 'err' : state?.status === 'loading' ? 'loading' : ''
        return {
          id: config.id,
          name: config.name,
          tone: itemTone,
          text: state?.status === 'ok' ? summarize(state).primary : state?.status === 'error' ? '失败' : '',
        }
      }),
    }),
    [monitorConfigs, monitorStates, onlineCount, tone],
  )

  /** 交给组件的应用能力。组件不直接碰 store，也不直接改工作空间。 */
  const host: ComponentHost = useMemo(
    () => ({
      openPage: (id) => setPendingPage(id),
      openSettings,
      openMonitor,
      openAssistant: () => openAssistant(assistantOpenRef.current ? assistantMode : 'drawer'),
      openArticle,
      readIds,
      markRead: (id: string) => setReadIds((prev: string[]) => (prev.includes(id) ? prev : [...prev, id].slice(-500))),
      proxy: settings.proxy,
      hotSource: settings.hotSource,
      ask: (text) => {
        // 面板已经开着：这是在接着聊，留在当前对话；没开：从外面发起的新问题，新开一个对话，并用侧栏打开让回答实时出现在眼前
        const fresh = !assistantOpenRef.current
        if (fresh) openAssistant('drawer')
        void ask(text, { fresh })
      },
      aiConfigured,
      aiModel: settings.ai.model,
      aiBusy: busy,
      search: doSearch,
      monitor: monitorInfo,
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
    [settings, readIds, setReadIds, ask, aiConfigured, busy, doSearch, openArticle, edit, workspace.network, openSettings, openMonitor, monitorInfo, openAssistant, assistantMode],
  )

  const onUpdateConfig = useCallback(
    (instanceId: string, patch: Record<string, unknown>) => {
      edit((ws) => updateComponent(ws, instanceId, { config: patch }).workspace)
    },
    [edit],
  )

  const toggleTheme = useCallback(
    () => edit((ws) => setMode(ws, ws.theme.mode === 'dark' ? 'light' : 'dark')),
    [edit],
  )

  const onStatusConfig = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      edit((ws) => ({ ...ws, statusbar: ws.statusbar.map((item) => (item.id === id ? { ...item, config: { ...item.config, ...patch } } : item)) })),
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
        if (assistantOpenRef.current) setAssistantOpen(false)
        else openAssistant()
      } else if (meta && e.key === ',') {
        e.preventDefault()
        openSettings()
      } else if (!meta && !e.altKey && !typing && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const next = workspace.pages[Number(e.key) - 1]
        if (next) goPage(next.id)
      } else if (e.key === 'Escape') {
        setReader(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspace.pages, goPage, openSettings])

  const paletteActions = useMemo(
    () => [
      ...workspace.pages.map((page, index) => ({
        id: `page-${page.id}`,
        label: page.name,
        hint: String(index + 1),
        group: '页面',
        icon: pageIcon(page.icon),
        run: () => goPage(page.id),
      })),
      { id: 'cmd-ai', label: '和搭搭对话', hint: '⌘J', group: '动作', icon: Sparkles, run: () => openAssistant() },
      ...(isInstalled(workspace, 'monitor') ? [{ id: 'cmd-monitor', label: '服务监控', group: '动作', icon: Monitor, run: openMonitor }] : []),
      { id: 'cmd-market', label: '组件市场', group: '动作', icon: LayoutGrid, run: openMarket },
      { id: 'cmd-settings', label: '设置', hint: '⌘,', group: '动作', icon: Settings, run: () => openSettings() },
      {
        id: 'cmd-theme',
        label: workspace.theme.mode === 'dark' ? '切换到浅色' : '切换到深色',
        group: '动作',
        icon: workspace.theme.mode === 'dark' ? Sun : Moon,
        run: () => edit((ws) => setMode(ws, ws.theme.mode === 'dark' ? 'light' : 'dark')),
      },
      ...workspace.themes
        .filter((item) => item.id !== workspace.theme.active)
        .map((item) => ({
          id: `theme-${item.id}`,
          label: `主题：${item.name}`,
          hint: item.description ? item.description.slice(0, 14) : undefined,
          group: '主题',
          icon: Palette,
          run: () => edit((ws) => applyTheme(ws, item.id).workspace),
        })),
      ...(isInstalled(workspace, 'feeds') ? feeds : [])
        .filter((f) => f.enabled !== false)
        .map((f) => ({
          id: `feed-${f.id}`,
          label: f.title,
          group: '订阅源',
          icon: Rss,
          run: () => window.open(f.url, '_blank', 'noopener'),
        })),
    ],
    [workspace.pages, workspace.theme, workspace.themes, workspace.addons, feeds, edit, goPage, openMonitor, openMarket, openSettings],
  )

  const appCtx: AppSettingsContext = useMemo(
    () => ({
      settings,
      patch: (part) => setSettings({ ...settings, ...part }),
      feeds,
      setFeeds,
      groups,
      setGroups,
      instances: (type) =>
        workspace.pages.flatMap((page) =>
          page.components.filter((c) => c.type === type).map((c) => ({ id: c.id, pageLabel: page.label, config: c.config })),
        ),
      updateConfig: onUpdateConfig,
      workspace,
      edit,
    }),
    [settings, setSettings, feeds, setFeeds, groups, setGroups, workspace, onUpdateConfig, edit],
  )

  const monitorOn = isInstalled(workspace, 'monitor')
  const paper = currentPage?.wallpaper
  const paperUrl = paper ? wallpaperUrl(paper.mode as never, paper.mode === 'unsplash' ? paper.index : 0, paper.mode === 'custom' ? paper.url : '') : ''

  return (
    <ErrorBoundary>
      <div className="app" data-fx={view === 'page' && hasBackdrop(currentPage?.layers) ? 'on' : undefined}>
        {/* 页面背景特效铺在最底层，覆盖整个窗口，侧栏和顶栏透明地叠在上面 */}
        <div className="fx-root" ref={setFxRoot} aria-hidden="true" />
        {/* 外框：四条红边进场时从各自的方向滑进来（来自 anyway.fm 的做法） */}
        <div className="frame" aria-hidden="true">
          <i className="frame-bar frame-t" />
          <i className="frame-bar frame-b" />
          <i className="frame-bar frame-l" />
          <i className="frame-bar frame-r" />
        </div>
        <Rail
          pages={workspace.pages}
          page={currentPage?.id ?? ''}
          onPage={goPage}
          view={view}
          dock={workspace.dock}
          onMore={() => setSwitcherOpen(true)}
          onAssistant={() => (assistantOpen ? setAssistantOpen(false) : openAssistant())}
          assistantBusy={busy}
          onMonitor={openMonitor}
          onMarket={openMarket}
          monitorInstalled={monitorOn}
          onSettings={() => openSettings()}
        />

        <div className="canvas">
          <TopBar
            status={<StatusBar items={workspace.statusbar} host={host} onConfig={onStatusConfig} />}
            theme={workspace.theme.mode}
            onTheme={toggleTheme}
            onPalette={() => setPaletteOpen((v) => !v)}
            onHome={() => goPage(FROZEN_PAGE_ID)}
          />

          {view === 'page' && (
          <div
            className="page"
            data-paper={paperUrl ? 'on' : 'off'}
            style={paperUrl ? { ['--paper' as string]: `url("${paperUrl}")` } : undefined}
          >
            <FxLayers layers={currentPage?.layers} portal={fxRoot}>
              {currentPage && (
                <PageView
                  page={currentPage}
                  workspace={workspace}
                  host={host}
                  onUpdateConfig={onUpdateConfig}
                  onRemove={onRemoveComponent}
                />
              )}
            </FxLayers>
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
          )}
          {view === 'settings' && (
            <div className="page sys-view">
              <SettingsPage
                ctx={appCtx}
                themeMode={workspace.theme.mode}
                onThemeMode={(mode) => edit((ws) => setMode(ws, mode))}
                section={section}
                onSection={setSection}
                onReset={() => void resetStorage()}
              />
            </div>
          )}
          {view === 'market' && (
            <div className="page sys-view">
              <MarketPage workspace={workspace} edit={edit} onOpenPage={goPage} onOpenMonitor={openMonitor} />
            </div>
          )}
          {view === 'monitor' && monitorOn && (
            <div className="page sys-view">
              <MonitorPage
                configs={monitorConfigs}
                states={monitorStates}
                range={range}
                onRange={(r) => {
                  setRange(r)
                  void loadMonitors(r)
                }}
                onRefresh={() => void loadMonitors()}
                onSettings={() => openSettings('monitor')}
              />
            </div>
          )}
        </div>

        <Reader
          article={reader}
          ai={settings.ai}
          onClose={() => setReader(null)}
          onMarkRead={() => undefined}
          onAskAi={(prompt) => {
            setReader(null)
            openAssistant('drawer')
            void ask(prompt, { fresh: true })
          }}
          onOpenSettings={() => openSettings('ai')}
        />

        <Assistant
          open={assistantOpen}
          mode={assistantMode}
          onMode={setAssistantMode}
          ai={settings.ai}
          turns={turns}
          ready={chat.ready}
          convs={chat.convs}
          convId={chat.convId}
          onNewConv={() => void chat.newConv()}
          onOpenConv={(id) => void chat.openConv(id)}
          onDeleteConv={(id) => void chat.deleteConv(id)}
          busy={busy}
          seed={{ text: '', key: 0 }}
          onSend={(text) => void ask(text)}
          onStop={() => abortRef.current?.abort()}
          onClose={() => setAssistantOpen(false)}
          onOpenSettings={() => openSettings('ai')}
          onApprovalAnswer={answerApproval}
        />

        <PageSwitcher
          open={switcherOpen}
          system={[
            ...(monitorOn ? [{ id: 'sys-monitor', label: '服务监控', icon: Monitor, run: openMonitor }] : []),
            { id: 'sys-market', label: '组件市场', icon: LayoutGrid, run: openMarket },
            { id: 'sys-settings', label: '设置', icon: Settings, run: () => openSettings() },
          ]}
          pages={workspace.pages}
          current={view === 'page' ? (currentPage?.id ?? '') : ''}
          onPick={goPage}
          onClose={() => setSwitcherOpen(false)}
        />

        <CommandPalette
          open={paletteOpen}
          groups={isInstalled(workspace, 'bookmarks') ? groups : []}
          extra={paletteActions}
          onClose={() => setPaletteOpen(false)}
          onSearch={doSearch}
        />

      </div>
    </ErrorBoundary>
  )
}
