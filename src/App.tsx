import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { A, ActionIcon, Modal, Text, toast } from '@lobehub/ui'
import {AppWindow, SquaresFour as LayoutGrid, Monitor, Moon, Palette, ArrowClockwise as Redo, ArrowsClockwise as RefreshCw, Rss, Gear as Settings, Sparkle as Sparkles, Sun, ArrowCounterClockwise as Undo} from '@phosphor-icons/react'
import { pageIcon } from './lib/pageIcons'
import { activeTheme, IOS_THEME_ID, PIXEL_THEME_ID, type ApplicationOpenMode } from './lib/workspace'
import {findApplication, listApplications, updateApplication} from './lib/applications'
import {ApplicationHost} from './components/ApplicationHost'
import { applyTheme, resolveThemeOverrides, setMode } from './lib/themes'
import { fontVars, syncFonts } from './lib/fonts'
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
import {HomepageDraftPreview} from './components/HomepageDraftPreview'
import {createHomepageDraft, getHomepageDraft, getHomepageDraftWorkspace, useHomepageDraft} from './lib/homepageDraft'
import {createHomepageDraftInspectionHost} from './lib/homepageDraftInspection'
import { FxLayers, hasBackdrop } from './fx/Fx'
import { Reader } from './components/Reader'
import { ChatAssistant } from './components/ChatAssistant'
import { AssistantSplitPane } from './components/AssistantSplitPane'
import { DEFAULT_ASSISTANT_RATIO, normalizeAssistantMode, type AssistantMode } from './lib/assistantLayout'
import { visibleDock } from './lib/dock'
import { CommandPalette } from './components/CommandPalette'
import { SettingsPage } from './components/SettingsPage'
import { SYNC_OPEN_FLAG } from './lib/sync'
import type { AppSettingsContext } from './lib/apps'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MonitorPage } from './components/Monitor'
import { MarketPage } from './components/MarketPage'
import { isInstalled } from './lib/market'
import { resetStorage } from './lib/storage'
import { appendTool, appendTurn, beginTurn, getChatState, initChat, loadContextTurns, newConv, patchTurn, readToolDetail, turnContent, type Turn } from './lib/chat'
import { articleContext } from './lib/articleContext'
import { normalizeHost } from './lib/customWidget'
import type { Article, BookmarkGroup, Feed, Settings as SettingsShape } from './lib/types'
import type { ComponentHost } from './lib/registry'
import { getWorkspace, useWorkspace } from './lib/workspaceStore'
import {PersistenceNotice} from './components/PersistenceNotice'
import {usePersistenceStatus} from './lib/persistence'
import {createPageInspectionHost, type MountedInspectionPage} from './lib/pageInspectionHost'
import { grantHost, removeComponent, updateComponent } from './lib/ops'
import { removeData, useComponentData, SHARED } from './lib/componentData'
import { wallpaperUrl } from './lib/wallpaper'
import './widgets'
import './applications.css'

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

  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 待答复的确认请求：由 ask 写入，由确认卡片按钮调用。 */
  const settleRef = useRef<((approved: boolean | 'always') => void) | null>(null)

  const [pageId, setPageId] = useStored<string>('page', 'home')
  const [pendingPage, setPendingPage] = useState<string | null>(null)

  const [reader, setReader] = useState<Article | null>(null)
  const [draftArticle, setDraftArticle] = useState<Article | null>(null)
  const [assistantSeed, setAssistantSeed] = useState({ text: '', key: 0 })
  const [assistantOpen, setAssistantOpen] = useState(false)
  // Logo 恢复上一次侧边布局；Dock / ⌘J 保留独立的打开偏好。
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('drawer')
  const [sidebarAi] = useStored<AssistantMode>('sidebarAi', 'full')
  const [panelMode, setPanelMode] = useStored<'drawer' | 'split'>('assistantPanelMode', 'drawer')
  const [assistantRatio, setAssistantRatio] = useStored<number>('assistantSplitRatio', DEFAULT_ASSISTANT_RATIO)
  const [splitAvailable, setSplitAvailable] = useState(false)
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null)
  const [fxRoot, setFxRoot] = useState<HTMLDivElement | null>(null)
  const assistantOpenRef = useRef(false)
  assistantOpenRef.current = assistantOpen
  const splitActive = assistantOpen && assistantMode === 'split' && splitAvailable
  const splitActiveRef = useRef(false)
  splitActiveRef.current = splitActive
  const changeAssistantMode = useCallback((mode: AssistantMode) => {
    const next = normalizeAssistantMode(mode)
    setAssistantMode(next)
    if (next !== 'full') setPanelMode(next)
  }, [setPanelMode])
  const openAssistant = useCallback((mode?: AssistantMode) => {
    changeAssistantMode(mode ?? normalizeAssistantMode(sidebarAi))
    setAssistantOpen(true)
  }, [sidebarAi, changeAssistantMode])
  const openAssistantPanel = useCallback(() => {
    openAssistant(panelMode === 'split' ? 'split' : 'drawer')
  }, [openAssistant, panelMode])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  // 当前画布显示什么：普通页面、设置、监控。设置和监控是整页，不再用抽屉
  const [view, setView] = useState<'page' | 'settings' | 'monitor' | 'market' | 'application'>('page')
  const [applicationView, setApplicationView] = useState<{id: string; mode: ApplicationOpenMode} | null>(null)
  const applicationViewRef = useRef(applicationView)
  applicationViewRef.current = applicationView
  const [applicationMinimized, setApplicationMinimized] = useState(false)
  const applicationMinimizedRef = useRef(false)
  applicationMinimizedRef.current = applicationMinimized
  const viewRef = useRef(view)
  viewRef.current = view
  const applicationReturnView = useRef<'page' | 'settings' | 'monitor' | 'market'>('market')
  const [section, setSection] = useState('profile')
  const [settingsRequest, setSettingsRequest] = useState(0)

  const { workspace, edit, undo, redo, canUndo, canRedo } = useWorkspace()
  const persistence = usePersistenceStatus()
  const homepageDraft = useHomepageDraft()
  const homepageDraftWorkspace = getHomepageDraftWorkspace()
  const mountedDraftInspection = useRef<MountedInspectionPage | null>(null)
  const setDraftInspection = useCallback((mounted: MountedInspectionPage | null) => {mountedDraftInspection.current = mounted}, [])
  const inspectHomepageDraft = useMemo(() => createHomepageDraftInspectionHost({getMounted: () => mountedDraftInspection.current}), [])

  const openApplication = useCallback((ref: string, requestedMode?: ApplicationOpenMode) => {
    try {
      const application = findApplication(getWorkspace(), ref)
      const current = applicationViewRef.current
      const mode = requestedMode ?? (applicationMinimizedRef.current && current?.id === application.id ? current.mode : application.openMode)
      if (viewRef.current !== 'application') applicationReturnView.current = viewRef.current
      applicationMinimizedRef.current = false
      setApplicationMinimized(false)
      setApplicationView({id: application.id, mode})
      setView(mode === 'page' ? 'application' : applicationReturnView.current)
      setReader(null)
      if (!splitActiveRef.current) setAssistantOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])
  const minimizeApplication = useCallback(() => {
    applicationMinimizedRef.current = true
    setApplicationMinimized(true)
  }, [])
  const restoreApplication = useCallback(() => {
    applicationMinimizedRef.current = false
    setApplicationMinimized(false)
  }, [])
  const closeApplication = useCallback(() => {
    applicationMinimizedRef.current = false
    setApplicationMinimized(false)
    setApplicationView(null)
    if (viewRef.current === 'application') setView(applicationReturnView.current)
  }, [])
  const applications = listApplications(workspace)
  const openedApplication = applicationView && applications.find((item) => item.id === applicationView.id)
  useEffect(() => {
    if (applicationView && !openedApplication) closeApplication()
  }, [applicationView, openedApplication, closeApplication])

  // 同一域名共享一次确认；其他域名排队，避免并发请求覆盖尚未答复的弹窗。
  const grantQueue = useRef<{host: string; promise: Promise<boolean>; resolve: (allowed: boolean) => void}[]>([])
  const [grantPrompt, setGrantPrompt] = useState<string | null>(null)
  const requestNetworkGrant = useCallback((raw: string): Promise<boolean> => {
    const host = normalizeHost(raw)
    if (!host) return Promise.resolve(false)
    if (getWorkspace().network.some((grant) => grant.host === host)) return Promise.resolve(true)
    const pending = grantQueue.current.find((item) => item.host === host)
    if (pending) return pending.promise
    let resolve!: (allowed: boolean) => void
    const promise = new Promise<boolean>((settle) => { resolve = settle })
    grantQueue.current.push({ host, promise, resolve })
    setGrantPrompt(grantQueue.current[0].host)
    return promise
  }, [])
  const answerNetworkGrant = useCallback((expectedHost: string | null, allowed: boolean) => {
    const pending = grantQueue.current[0]
    if (!pending || pending.host !== expectedHost) return
    grantQueue.current.shift()
    if (allowed) edit((ws) => grantHost(ws, pending.host))
    pending.resolve(allowed)
    setGrantPrompt(grantQueue.current[0]?.host ?? null)
  }, [edit])
  useEffect(() => () => {
    grantQueue.current.splice(0).forEach((pending) => pending.resolve(false))
  }, [])

  const clearArticleDraft = useCallback(() => {
    setDraftArticle(null)
    setAssistantSeed((prev) => ({ text: '', key: prev.key + 1 }))
  }, [])

  const goPage = useCallback(
    (id: string) => {
      if (!applicationMinimizedRef.current) setApplicationView(null)
      setPageId(id)
      setView('page')
    },
    [setPageId],
  )
  /** 系统页替换左侧画布，分栏中的助手继续保留。 */
  const openSettings = useCallback((target?: string) => {
    if (!applicationMinimizedRef.current) setApplicationView(null)
    if (!splitActiveRef.current) setAssistantOpen(false)
    setReader(null)
    if (typeof target === 'string' && target) {
      setSection(target)
      setSettingsRequest((request) => request + 1)
    }
    setView('settings')
  }, [])
  useEffect(() => {
    if (sessionStorage.getItem(SYNC_OPEN_FLAG) !== '1') return
    sessionStorage.removeItem(SYNC_OPEN_FLAG)
    openSettings('sync')
  }, [openSettings])
  const openMonitor = useCallback(() => {
    if (!applicationMinimizedRef.current) setApplicationView(null)
    if (!splitActiveRef.current) setAssistantOpen(false)
    setView('monitor')
  }, [])
  const openMarket = useCallback(() => {
    if (!applicationMinimizedRef.current) setApplicationView(null)
    if (!splitActiveRef.current) setAssistantOpen(false)
    setView('market')
  }, [])

  // 页面可能被删除或改名：存下来的 id 失效时回落到第一页
  const currentPage = workspace.pages.find((page) => page.id === pageId) ?? workspace.pages[0]
  const inspectionRoot = useRef<HTMLDivElement | null>(null)
  const mountedInspection = useRef<MountedInspectionPage | null>(null)
  const inspectionRevision = useRef({workspace, value: 0})
  const setInspectionRoot = useCallback((root: HTMLDivElement | null) => {
    inspectionRoot.current = root
    if (!root) mountedInspection.current = null
  }, [])
  // 只记录已提交的 React 树，避免新工作空间与旧 DOM 混为一次检查。
  useLayoutEffect(() => {
    if (inspectionRevision.current.workspace !== workspace) {
      inspectionRevision.current = {workspace, value: inspectionRevision.current.value + 1}
    }
    mountedInspection.current = !homepageDraft && view === 'page' && currentPage && inspectionRoot.current
      ? {root: inspectionRoot.current, pageId: currentPage.id, workspace, revision: String(inspectionRevision.current.value)}
      : null
  })
  const inspectPage = useMemo(() => createPageInspectionHost({getWorkspace, getMounted: () => mountedInspection.current}), [])
  useEffect(() => {
    if (currentPage && currentPage.id !== pageId) setPageId(currentPage.id)
  }, [currentPage, pageId, setPageId])

  // AI 工具调用 open_page 时先记下目标，等下一帧再切，避免在渲染期间改状态
  useEffect(() => {
    if (!pendingPage) return
    if (workspace.pages.some((page) => page.id === pendingPage)) {
      setPageId(pendingPage)
      if (!applicationMinimizedRef.current) setApplicationView(null)
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
    if (theme.id === IOS_THEME_ID) root.dataset.skin = 'ios'
    else if (theme.id === PIXEL_THEME_ID) root.dataset.skin = 'pixel'
    else delete root.dataset.skin
    for (const name of appliedVars.current) root.style.removeProperty(`--${name}`)
    // 字体接管的变量在前，主题自己写的变量在后（后者优先）
    const vars = { ...fontVars(theme.fonts), ...resolveThemeOverrides(theme, workspace.theme.mode) }
    if (workspace.theme.frameOff) {
      vars.frame = '0px'
      vars['frame-gap'] = '0px'
    }
    appliedVars.current = Object.keys(vars)
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(`--${name}`, value)
    syncFonts(theme.fonts, (family) => toast.error(`字体「${family}」没加载出来：检查名字是否是 Google Fonts 上的，或网络能不能访问 fonts.googleapis.com。`))
    document.title = `${settings.name === '朋友' ? '' : `${settings.name} · `}搭搭`
  }, [workspace.theme.mode, workspace.theme.frameOff, theme, settings.name])

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
    async (text: string, options?: { fresh?: boolean; article?: Article }) => {
      if (abortRef.current) return
      // 在任何异步存储操作前占住发送锁，避免新对话尚未就绪时重复发起。
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      try {
        await initChat()
        const targetConvId = options?.fresh ? await newConv() : getChatState().convId
        const turn = beginTurn(text)
        if (options?.article) {
          turn.article = { title: options.article.title, link: options.article.link, context: articleContext(options.article) }
        }
        if (!aiConfigured) {
          appendTurn(targetConvId, {...turn, error: '先到设置里填接口地址与模型。', endedAt: Date.now()})
          return
        }

        const context = options?.fresh ? [] : await loadContextTurns(targetConvId, settings.ai.contextTurns)
        if (controller.signal.aborted) return
        // 历史按轮展开成消息：带问答正文和工具「操作痕迹」（名称、参数摘要、成败、编号）；
        // 思考过程和工具正文不进上下文，模型需要时用 read_tool_result 按编号读回。
        const TRACE_LIMIT = 40
        const trace = (tools: { title: string; ok: boolean; detailId?: string }[]) => {
          if (!tools.length) return ''
          const shown = tools.slice(-TRACE_LIMIT)
          const lines = shown.map((tool, index) => `${tools.length - shown.length + index + 1}. ${tool.title} ${tool.ok ? '成功' : '失败'} id=${tool.detailId ?? ''}`)
          const omitted = tools.length > shown.length ? `（更早的 ${tools.length - shown.length} 步省略）\n` : ''
          return `[本轮操作记录，仅是痕迹；需要具体结果时用 read_tool_result 传入 id]\n${omitted}${lines.join('\n')}`
        }
        const history: ChatMessage[] = context.flatMap((t) => {
          const items: ChatMessage[] = [{ role: 'user', content: turnContent(t) }]
          const note = trace(t.tools ?? [])
          const content = [note, t.answer].filter(Boolean).join('\n\n')
          if (content) items.push({ role: 'assistant', content })
          return items
        })

        appendTurn(targetConvId, turn)

        /** 只改这一轮，不碰其它轮。 */
        const patch = (part: Partial<Omit<Turn, 'id' | 'convId' | 'tools'>>) =>
          patchTurn(targetConvId, turn.id, part)

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
            messages: [...history, { role: 'user', content: turnContent(turn) }],
            host: { readToolDetail, openPage: (next: string) => setPendingPage(next), openSettings: (section?: string) => openSettings(section), openApplication, inspectPage, inspectHomepageDraft },
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
              appendTool(targetConvId, turn.id, {name: info.name, title: info.title, ok: info.ok, text: info.text})
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
          // 中止或出错时若有未答复的确认，一并清掉，否则卡片会一直挂着
          settleRef.current?.(false)
          patch({ pending: undefined })
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [settings.ai, aiConfigured, newConv, openSettings, openApplication, inspectPage, inspectHomepageDraft],
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
      requestNetworkGrant,
      profile: {
        name: settings.name,
        city: settings.city,
        lat: settings.lat,
        lon: settings.lon,
        showSeconds: settings.showSeconds,
        showFavicons: settings.showFavicons,
      },
    }),
    [settings, readIds, setReadIds, ask, aiConfigured, busy, doSearch, openArticle, requestNetworkGrant, workspace.network, openSettings, openMonitor, monitorInfo, openAssistant, assistantMode],
  )

  const onUpdateConfig = useCallback(
    (instanceId: string, patch: Record<string, unknown>) => {
      edit((ws) => listApplications(ws).some((item) => item.id === instanceId) ? updateApplication(ws, instanceId, {config: patch}).workspace : updateComponent(ws, instanceId, { config: patch }).workspace)
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
      // 文本编辑保持浏览器自身撤销；工作空间历史仅在非输入区域接管。
      if (meta && !e.altKey && !e.isComposing && !typing && e.key.toLowerCase() === 'z') {
        if (e.shiftKey ? redo() : undo()) e.preventDefault()
      } else if (meta && e.key.toLowerCase() === 'k') {
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
  }, [workspace.pages, goPage, openSettings, openAssistant, undo, redo])

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
      ...applications.map((application) => ({id:`application-${application.id}`,label:application.instance.title || '应用',hint:application.description.slice(0,20),group:application.group || 'AI 应用',icon:AppWindow,run:() => openApplication(application.id)})),
      ...(canUndo ? [{id: 'cmd-undo', label: '撤销上一步', hint: '⌘Z / Ctrl+Z', group: '编辑', icon: Undo, run: () => { undo() }}] : []),
      ...(canRedo ? [{id: 'cmd-redo', label: '重做上一步', hint: '⌘⇧Z / Ctrl+Shift+Z', group: '编辑', icon: Redo, run: () => { redo() }}] : []),
      {id: 'cmd-homepage-draft', label: '预览首页方案', group: '编辑', icon: LayoutGrid, run: () => {
        try {if (!getHomepageDraft()) createHomepageDraft({recipeId: 'minimal'})}
        catch (error) {toast.error({title: error instanceof Error ? error.message : String(error)})}
      }},
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
    [workspace.pages, workspace.applications, workspace.theme, workspace.themes, workspace.addons, feeds, edit, goPage, openMonitor, openMarket, openSettings, openApplication, canUndo, canRedo, undo, redo, openAssistant],
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
      openApplication,
    }),
    [settings, setSettings, feeds, setFeeds, groups, setGroups, workspace, onUpdateConfig, edit, openApplication],
  )

  const monitorOn = isInstalled(workspace, 'monitor')
  const activeApplicationIds = [...new Set([
    ...(applicationView ? [applicationView.id] : []),
    ...(view === 'page' ? currentPage.components.filter((item) => applications.some((application) => application.id === item.id)).map((item) => item.id) : []),
  ])]
  const paper = currentPage?.wallpaper
  const paperUrl = paper ? wallpaperUrl(paper.mode as never, paper.mode === 'unsplash' ? paper.index : 0, paper.mode === 'custom' ? paper.url : '') : ''

  return (
    <ErrorBoundary>
      <PersistenceNotice />
      <div className="app" inert={persistence.busy || persistence.errors.some(error => error.source === 'backup-restore') || undefined} data-fx={view === 'page' && hasBackdrop(currentPage?.layers) ? 'on' : undefined}>
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
          applications={applications}
          applicationId={openedApplication && !applicationMinimized ? openedApplication.id : undefined}
          onApplication={openApplication}
          page={currentPage?.id ?? ''}
          onPage={goPage}
          view={view}
          dock={visibleDock(workspace.dock, theme.id === IOS_THEME_ID, theme.id === PIXEL_THEME_ID)}
          onMore={() => setSwitcherOpen(true)}
          onAssistant={() => (assistantOpen ? setAssistantOpen(false) : openAssistant())}
          onLogo={openAssistantPanel}
          assistantBusy={busy}
          onMonitor={openMonitor}
          onMarket={openMarket}
          monitorInstalled={monitorOn}
          onSettings={() => openSettings()}
        />

        <AssistantSplitPane
          enabled={assistantOpen && assistantMode === 'split'}
          ratio={assistantRatio}
          onRatioChange={setAssistantRatio}
          onAvailableChange={setSplitAvailable}
          assistant={
            <ChatAssistant
              open={assistantOpen}
              mode={assistantMode}
              canSplit={splitAvailable}
              onMode={changeAssistantMode}
              ai={settings.ai}
              onConvChange={clearArticleDraft}
              busy={busy}
              seed={assistantSeed}
              articleTitle={draftArticle?.title}
              onRemoveArticle={() => setDraftArticle(null)}
              onSend={(text) => {
                void ask(text, draftArticle ? { fresh: true, article: draftArticle } : undefined)
                setDraftArticle(null)
              }}
              onStop={() => abortRef.current?.abort()}
              onClose={() => setAssistantOpen(false)}
              onOpenSettings={() => openSettings('ai')}
              onApprovalAnswer={answerApproval}
            />
          }
        >
          <div className="canvas" ref={setCanvasElement} data-split={splitActive || undefined} data-homepage-draft-active={homepageDraft ? true : undefined}>
            <TopBar
              status={<StatusBar items={workspace.statusbar} host={host} onConfig={(id,patch) => applications.some((application) => application.id === id) ? onUpdateConfig(id,patch) : onStatusConfig(id,patch)} applications={applications} onApplication={openApplication} workspace={workspace} activeApplicationIds={activeApplicationIds} />}
              theme={workspace.theme.mode}
              onTheme={toggleTheme}
              onPalette={() => setPaletteOpen((v) => !v)}
              onAssistant={openAssistantPanel}
            />

            {view === 'page' && (
            <div
              className="page"
              inert={homepageDraft ? true : undefined}
              aria-hidden={homepageDraft ? true : undefined}
              ref={setInspectionRoot}
              data-page-id={currentPage?.id}
              data-paper={paperUrl ? 'on' : 'off'}
              style={paperUrl ? { ['--paper' as string]: `url("${paperUrl}")` } : undefined}
            >
              <FxLayers page={currentPage} container={canvasElement} portal={fxRoot}>
                {currentPage && (
                  <PageView
                    page={currentPage}
                    workspace={workspace}
                    host={host}
                    onUpdateConfig={onUpdateConfig}
                    onRemove={onRemoveComponent}
                    suspendedApplicationId={applicationView?.id}
                    onResumeApplication={applicationMinimized ? restoreApplication : closeApplication}
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
              <div className="page sys-view" inert={homepageDraft ? true : undefined} aria-hidden={homepageDraft ? true : undefined}>
                <SettingsPage
                  ctx={appCtx}
                  themeMode={workspace.theme.mode}
                  onThemeMode={(mode) => edit((ws) => setMode(ws, mode))}
                  section={section}
                  openRequest={settingsRequest}
                  generating={busy}
                  onSection={setSection}
                  onReset={() => { void resetStorage().catch(error => toast.error(error instanceof Error ? error.message : String(error))) }}
                />
              </div>
            )}
            {view === 'market' && (
              <div className="page sys-view" inert={homepageDraft ? true : undefined} aria-hidden={homepageDraft ? true : undefined}>
                <MarketPage workspace={workspace} edit={edit} onOpenPage={goPage} onOpenMonitor={openMonitor} onOpenApplication={openApplication} onOpenSettings={openSettings} />
              </div>
            )}
            {view === 'monitor' && monitorOn && (
              <div className="page sys-view" inert={homepageDraft ? true : undefined} aria-hidden={homepageDraft ? true : undefined}>
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
            {view === 'application' && openedApplication && applicationView && (
              <div className="page sys-view" inert={homepageDraft ? true : undefined} aria-hidden={homepageDraft ? true : undefined}>
                <ApplicationHost application={openedApplication} mode="page" workspace={workspace} host={host} onClose={closeApplication} onConfig={onUpdateConfig}/>
              </div>
            )}
            {homepageDraft && homepageDraftWorkspace && <HomepageDraftPreview draft={homepageDraft} workspace={homepageDraftWorkspace} host={host} onMount={setDraftInspection} inspect={inspectHomepageDraft} />}
          </div>

        </AssistantSplitPane>

        {applicationView && openedApplication && applicationView.mode !== 'page' && <ApplicationHost application={openedApplication} mode={applicationView.mode} canvasContainer={canvasElement} minimized={applicationMinimized} onMinimize={minimizeApplication} onRestore={restoreApplication} overlayContainer={splitActive ? canvasElement : undefined} workspace={workspace} host={host} onClose={closeApplication} onConfig={onUpdateConfig}/>}

        <Reader
          overlayContainer={splitActive ? canvasElement : undefined}
          article={reader}
          ai={settings.ai}
          onClose={() => setReader(null)}
          onMarkRead={() => undefined}
          onAskAi={(article) => {
            if (busy) {
              toast.info('搭搭正在回答，请等回答结束后再带入文章。')
              return
            }
            setReader(null)
            setDraftArticle(article)
            setAssistantSeed((prev) => ({ text: '关于这篇文章，我想问：', key: prev.key + 1 }))
            openAssistant(splitActiveRef.current ? 'split' : 'drawer')
          }}
          onOpenSettings={() => openSettings('ai')}
        />

        <Modal
          key={grantPrompt}
          open={Boolean(grantPrompt)}
          title="允许访问外部数据？"
          okText="允许这个域名"
          cancelText="拒绝"
          onOk={() => answerNetworkGrant(grantPrompt, true)}
          onCancel={() => answerNetworkGrant(grantPrompt, false)}
        >
          <Text>自定义组件或应用希望从 <strong>{grantPrompt}</strong> 获取数据。允许后会记住此域名，可以在「设置 → 网络」中撤销授权。</Text>
        </Modal>

        <PageSwitcher
          open={switcherOpen}
          system={[
            ...applications.filter((application) => application.dock).map((application) => ({id:`sys-application-${application.id}`,label:application.instance.title || '应用',icon:AppWindow,run:() => openApplication(application.id),hint:application.group || '应用'})),
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
