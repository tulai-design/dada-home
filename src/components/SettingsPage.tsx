import {useEffect, useRef, useState, type ReactNode} from 'react'
import {ActionIcon, Button, Modal, Segmented, Text} from '@lobehub/ui'
import {ArrowsClockwise, Brain, CaretLeft as ChevronLeft, Database, DownloadSimple as Download, Gear, Globe, Heart, Info, Layout as LayoutDashboard, Layout as LayoutTemplate, Palette, SidebarSimple as PanelLeft, Browser as PanelTop, ArrowCounterClockwise as RotateCcw, MagnifyingGlass as Search, UploadSimple as Upload, Sparkle as Sparkles, User} from '@phosphor-icons/react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import {appVisible} from '../lib/market'
import {defaultWorkspace, revokeHost} from '../lib/ops'
import {AppSettingsCtx, listApps, type AppSettingsContext} from '../lib/apps'
import {listApplications} from '../lib/applications'
import {PROXY_PRESETS} from '../lib/rss'
import {uid, useStored} from '../lib/store'
import {SEARCH_KEY, defaultSearchConfig, normalizeSearchConfig, providerInfo, searchReady} from '../lib/webSearch'
import {Group, Row, TextRow} from './ios'
import {SidebarSettings, StatusbarSettings} from './LayoutSettings'
import {exportBackupSnapshot, importBackup, MAX_BACKUP_BYTES, parseBackup, type BackupSummary} from '../lib/storage'
import {useIsMobile} from '../lib/useMedia'
import {AiSettings} from './AiSettings'
import {SyncSettings} from './SyncSettings'
import {StorageSettings} from './StorageSettings'
import {readSyncConfig, syncConfigured, useSyncStatus} from '../lib/sync'
import {SearchSettings} from './SearchSettings'
import {AboutPanel} from './About'
import {AppearanceSettings} from './ThemeSettings'
import {TemplateSettings} from './TemplateSettings'
import {MemorySettings, ProfileForm, SoulSettings} from './PersonaSettings'
import {usePersona} from '../lib/persona'
import {ApplicationSettings} from './ApplicationSettings'
import type {AssistantMode} from '../lib/assistantLayout'
import {activeTheme, SWITCH_THEME_ID} from '../lib/workspace'
import {ProfileAvatar} from './ProfileAvatar'
import {ExtensionSettings} from './ExtensionSettings'
import {isExtension} from '../lib/platform'

/**
 * 设置页：左边是分组目录，右边是当前项。
 * 热榜、订阅、书签、天气、监控由各自组件注册（lib/apps.ts），出现在「应用」里。
 */

type Section = {
  id: string
  name: string
  icon: PhosphorIcon
  description?: string
  summary?: string
  render: () => ReactNode
}

type Props = {
  ctx: AppSettingsContext
  themeMode: 'light' | 'dark'
  onThemeMode: (mode: 'light' | 'dark') => void
  section: string
  openRequest: number
  onSection: (id: string) => void
  onReset: () => void
  generating?: boolean
}

async function exportBackup() {
  const dump = await exportBackupSnapshot()
  const blob = new Blob([JSON.stringify(dump)], {type: 'application/json'})
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `dada-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function SettingsPage({ctx, themeMode, onThemeMode, section, openRequest, onSection, onReset, generating = false}: Props) {
  const {settings, patch} = ctx
  const mobile = useIsMobile()
  const consoleTheme = activeTheme(ctx.workspace).id === SWITCH_THEME_ID
  const persona = usePersona()
  const syncStatus = useSyncStatus()
  // 手机上一次只显示一栏：直接点进设置先看列表；从别处跳来指定某一项时直接显示那一项
  const [pane, setPane] = useState<'list' | 'detail'>(mobile && section === 'profile' ? 'list' : 'detail')
  // 外部入口可能连续打开相同 section，使用导航请求而非 section 变化进入详情。
  useEffect(() => {
    if (openRequest > 0) setPane('detail')
  }, [openRequest])
  const [resetOpen, setResetOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<{dump: Record<string, unknown>; summary: BackupSummary; name: string} | null>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    setImportError('')
    try {await exportBackup()} catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {setExporting(false)}
  }
  const pickBackup = async (file: File | undefined) => {
    if (!file) return
    setImportError('')
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过当前整包读取预算（256 MiB），请选择较小的备份。')
      const {dump, summary} = parseBackup(await file.text())
      setPendingImport({dump, summary, name: file.name})
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }
  const [storedSearch] = useStored<unknown>(SEARCH_KEY, defaultSearchConfig())
  const searchConfig = normalizeSearchConfig(storedSearch)
  const searchSummary = providerInfo(searchConfig.provider) ? (searchReady(searchConfig) ? providerInfo(searchConfig.provider)?.name : '未配好') : '未启用'
  const [assistantMode, setAssistantMode] = useStored<AssistantMode>('sidebarAi', 'full')

  const general: Section[] = [
    {
      id: 'profile',
      name: '个人',
      icon: User,
      summary: settings.name,
      description: '搭搭怎么称呼你，以及它该了解你的哪些背景。',
      render: () => (
        <>
          <Group footer="用在首页的问候语里，也是搭搭称呼你的方式。">
            {consoleTheme && <Row label="头像">
              <span className="console-avatar-preview"><ProfileAvatar seed={settings.avatarSeed || settings.name} size={40} /></span>
              <Button size="small" onClick={() => patch({avatarSeed: uid()})}>换一个</Button>
            </Row>}
            <TextRow label="称呼" value={settings.name} placeholder="朋友" onChange={(v) => patch({name: v})} />
          </Group>
          <ProfileForm />
        </>
      ),
    },
    {
      id: 'appearance',
      name: '外观',
      icon: Palette,
      summary: themeMode === 'dark' ? '深色' : '浅色',
      description: '配色和主题库。页面的壁纸、特效和版式，直接对搭搭说就行。',
      render: () => <AppearanceSettings mode={themeMode} onMode={onThemeMode} />,
    },
    {
      id: 'templates',
      name: '模板',
      icon: LayoutDashboard,
      summary: `${ctx.workspace.templates.length} 个`,
      description: '把整套页面设计存下来，随时切换；也可以从内置预设起步。',
      render: () => <TemplateSettings />,
    },
    {
      id: 'sidebar',
      name: '侧栏',
      icon: PanelLeft,
      summary: `${ctx.workspace.pages.length} 页`,
      description: '管理侧栏里的页面：名称、图标、顺序和删除。首页等系统入口是固定的。',
      render: () => <SidebarSettings />,
    },
    {
      id: 'statusbar',
      name: '状态条',
      icon: PanelTop,
      summary: `${ctx.workspace.statusbar.length + listApplications(ctx.workspace).filter((app) => app.status).length} 项`,
      description: '顶栏右侧的实时状态与应用入口。AI 应用的启动按钮或紧凑视图，在各自的应用设置中管理。',
      render: () => <StatusbarSettings />,
    },
  ]

  const system: Section[] = [
    {
      id: 'ai',
      name: '搭搭 AI',
      icon: Sparkles,
      summary: settings.ai.apiKey ? settings.ai.model : '未配置',
      description: '接入 OpenAI 或 Anthropic 兼容服务。密钥只保存在这台浏览器里。',
      render: () => (
        <>
          <AiSettings ai={settings.ai} proxy={settings.proxy} onChange={(ai) => patch({ai})} />
          <Group title="对话面板" footer="分栏仅在桌面显示。">
            <Row label="Dock AI 入口">
              <Segmented
                size="small"
                value={mobile && assistantMode === 'split' ? 'drawer' : assistantMode}
                options={[
                  {value: 'drawer', label: '抽屉'},
                  ...(!mobile ? [{value: 'split', label: '分栏'}] : []),
                  {value: 'full', label: '全屏'},
                ]}
                onChange={(v) => setAssistantMode(v as AssistantMode)}
              />
            </Row>
          </Group>
        </>
      ),
    },
    {
      id: 'search',
      name: '联网搜索',
      icon: Search,
      summary: searchSummary,
      description: '让搭搭自己上网查资料：Tavily、Firecrawl、SearXNG 等。也可以管理「搜索并跳转」是否每次询问。',
      render: () => <SearchSettings />,
    },
    {
      id: 'soul',
      name: '灵魂',
      icon: Heart,
      summary: persona.soul.name,
      description: '搭搭是谁、怎么说话、按什么原则做事。你可以改，它自己也可以（可关）。',
      render: () => <SoulSettings />,
    },
    {
      id: 'memory',
      name: '记忆',
      icon: Brain,
      summary: `${persona.memory.items.length} 条`,
      description: '搭搭在聊天里积累的、对你的认识。看得见，改得了，删得掉。',
      render: () => <MemorySettings />,
    },
    {
      id: 'network',
      name: '网络',
      icon: Globe,
      summary: PROXY_PRESETS.find((p) => p.template === settings.proxy)?.label.split(' ')[0] ?? '自定义',
      description: isExtension() ? '管理取数代理和应用授权。扩展按你的许可连接外部来源，内置同源代理预设会直接请求目标。' : '订阅、热榜、监控取数时共用的代理。浏览器直接请求会被跨域拦住，需要走代理。',
      render: () => (
        <>
          <Group title="代理预设">
            {PROXY_PRESETS.map((preset) => (
              <Row key={preset.id} label={preset.label} checked={settings.proxy === preset.template} onClick={() => patch({proxy: preset.template})} />
            ))}
          </Group>
          <Group title="自定义" footer="用 {url} 代表目标地址，例如 /__proxy?url={url}。留空表示直连。">
            <TextRow label="代理模板" stack value={settings.proxy} placeholder="/__proxy?url={url}" onChange={(v) => patch({proxy: v})} />
          </Group>
          <Group title="已授权域名" footer="撤销后，自定义组件或应用再次访问这个域名时，需要重新确认。">
            {ctx.workspace.network.length ? ctx.workspace.network.map((grant) => (
              <Row key={grant.host} label={grant.host}>
                <Button size="small" danger aria-label={`撤销 ${grant.host} 的授权`} onClick={() => ctx.edit((ws) => revokeHost(ws, grant.host))}>撤销</Button>
              </Row>
            )) : <Row label="还没有授权任何域名" hint="组件需要访问外部数据时，会先请你确认。" />}
          </Group>
        </>
      ),
    },
    {
      id: 'sync',
      name: '同步',
      icon: ArrowsClockwise,
      summary: syncConfigured(readSyncConfig()) ? (syncStatus.phase === 'error' ? '出错了' : readSyncConfig().auto ? '自动' : '手动') : '未开启',
      description: '把数据同步到你自己的存储里，在多台设备间保持一致。',
      render: () => <SyncSettings />,
    },
    {
      id: 'data',
      name: '数据',
      icon: Database,
      description: '看本机占用，导出备份，或恢复到初始状态。数据只留在这台浏览器里。',
      render: () => (
        <>
          <StorageSettings />
          <Group footer={importError ? <Text type="danger">{importError}</Text> : '导出订阅、书签、待办、页面、对话和配置，密钥也在其中。导入会用备份整体替换现在的数据。'}>
            <Row label={exporting ? '正在导出…' : '导出备份'} icon={<Download size={16} />} chevron onClick={() => void runExport()} />
            <Row label="导入备份" icon={<Upload size={16} />} chevron onClick={() => fileRef.current?.click()} />
          </Group>
          <Group footer="只把页面、侧栏、状态条和已装的组件恢复成初始状态；订阅、书签、待办、密钥和已存的模板都保留。">
            <Row label="恢复默认布局" icon={<LayoutTemplate size={16} />} onClick={() => ctx.edit((ws) => ({...defaultWorkspace(), theme: ws.theme, themes: ws.themes, templates: ws.templates, applications: listApplications(ws)}))} />
          </Group>
          <Group footer="会清掉订阅、书签、待办、页面、模板和密钥，回到初始状态。">
            <Row label="恢复默认" icon={<RotateCcw size={16} />} danger onClick={() => {
              if (generating) {setImportError('请先停止回答，再恢复数据。'); return}
              setResetOpen(true)
            }} />
          </Group>
        </>
      ),
    },
    {
      id: 'extension',
      name: '浏览器扩展',
      icon: PanelTop,
      summary: isExtension() ? '已安装' : '下载与安装',
      description: '将搭搭设为 Chrome / Edge 新标签页，打开浏览器就是自己的数字空间。',
      render: () => <ExtensionSettings />,
    },
    {
      id: 'about',
      name: '关于',
      icon: Info,
      description: '认识一下搭搭。',
      render: () => <AboutPanel />,
    },
  ]

  const builtinApps: Section[] = listApps().filter((app) => appVisible(ctx.workspace, app.id)).map((app) => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    description: app.description,
    summary: app.summary?.(ctx),
    render: () => <app.Panel />,
  }))
  const generatedApps: Section[] = listApplications(ctx.workspace).map((app) => ({
    id: `application:${app.id}`,
    name: app.instance.title || '未命名应用',
    icon: Sparkles,
    description: app.description || '搭搭为你制作的应用。在这里管理打开方式、入口和应用设置。',
    summary: app.group || 'AI 应用',
    render: () => <ApplicationSettings key={app.id} application={app} />,
  }))
  const apps = [...builtinApps, ...generatedApps]

  const all = [...general, ...system, ...apps]
  const resolved = section === 'storage' ? 'data' : section
  const current = all.find((item) => item.id === resolved) ?? general[0]
  const indexes = [
    {title: '画像', ids: ['profile', 'soul', 'memory']},
    {title: '版面', ids: ['appearance', 'templates', 'sidebar', 'statusbar']},
    {title: '搭搭', ids: ['ai', 'search']},
    ...(apps.length ? [{title: '应用', ids: apps.map((app) => app.id)}] : []),
    {title: '本机', ids: ['network', 'sync', 'data', 'extension', 'about']},
  ]

  const select = (id: string) => {
    onSection(id)
    setPane('detail')
  }
  const entry = (id: string) => {
    const item = all.find((sectionItem) => sectionItem.id === id)
    if (!item) return null
    const Icon = item.icon
    const selected = item.id === current.id
    return (
      <button key={item.id} type="button" className="settings-nav" data-selected={selected || undefined} aria-current={selected ? 'page' : undefined} onClick={() => select(item.id)}>
        <span className="settings-nav-icon"><Icon size={16} /></span>
        <span className="settings-nav-name">{item.name}</span>
        {item.summary ? <span className="settings-nav-summary">{item.summary}</span> : null}
      </button>
    )
  }

  return (
    <AppSettingsCtx.Provider value={ctx}>
      <div className="settings-page" data-pane={pane}>
        {consoleTheme && <header className="console-settings-header"><Gear size={28} aria-hidden="true" /><h1>设置</h1></header>}
        <aside className="ios-side">
          {!consoleTheme && <h1 className="ios-large"><Gear className="settings-console-mark" size={20} weight="fill" aria-hidden="true" />设置</h1>}
          <nav aria-label="设置分类">
            {indexes.map((index) => (
              <div key={index.title} className="settings-index">
                <div className="settings-index-title">{index.title}</div>
                {index.ids.map(entry)}
              </div>
            ))}
          </nav>
        </aside>

        <main className="ios-detail">
          <div className="ios-detail-inner">
            <header className="ios-detail-head">
              <ActionIcon className="ios-back" icon={ChevronLeft} aria-label="返回设置列表" title="返回" onClick={() => setPane('list')} />
              <h2>{current.name}</h2>
            </header>
            {current.description && <p className="ios-detail-desc">{current.description}</p>}
            {current.render()}
          </div>
        </main>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void pickBackup(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <Modal
        open={Boolean(pendingImport)}
        title="导入备份"
        onCancel={() => setPendingImport(null)}
        okText="替换并导入"
        okButtonProps={{className: 'ink-button'}}
        cancelText="取消"
        confirmLoading={importing}
        onOk={async () => {
          if (!pendingImport) return
          if (generating) {setImportError('请先停止回答，再恢复数据。'); setPendingImport(null); return}
          setImporting(true)
          try {
            await importBackup(pendingImport.dump)
          } catch (error) {
            setImporting(false)
            setPendingImport(null)
            setImportError(error instanceof Error ? error.message : String(error))
          }
        }}
      >
        {pendingImport && (
          <Text>
            {pendingImport.name}：{pendingImport.summary.keys} 项配置，{pendingImport.summary.data} 份组件数据，{pendingImport.summary.apps} 份应用数据，{pendingImport.summary.convs} 段对话。
            导入会替换现在的订阅、书签、待办、页面、对话和配置，建议先导出一份当前的备份。请先停止回答，并关闭其他搭搭标签页，再恢复数据。完成后页面会自动刷新。
          </Text>
        )}
      </Modal>
      <Modal
        open={resetOpen}
        title="恢复默认"
        onCancel={() => setResetOpen(false)}
        okText="确定"
        okButtonProps={{danger: true}}
        cancelText="取消"
        onOk={() => {
          if (generating) {setImportError('请先停止回答，再恢复数据。'); setResetOpen(false); return}
          setResetOpen(false)
          onReset()
        }}
      >
        <Text>会清掉订阅、书签、待办、页面和密钥。请先停止回答，并关闭其他搭搭标签页，再恢复默认。</Text>
      </Modal>
    </AppSettingsCtx.Provider>
  )
}
