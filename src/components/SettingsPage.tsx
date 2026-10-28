import {useEffect, useRef, useState, type ReactNode} from 'react'
import {ActionIcon, Button, Modal, Segmented, Text} from '@lobehub/ui'
import {ArrowsClockwise, Brain, CaretLeft as ChevronLeft, Database, DownloadSimple as Download, Globe, Heart, Info, Layout as LayoutDashboard, Layout as LayoutTemplate, Palette, SidebarSimple as PanelLeft, Browser as PanelTop, ArrowCounterClockwise as RotateCcw, MagnifyingGlass as Search, UploadSimple as Upload, Sparkle as Sparkles, User} from '@phosphor-icons/react'
import type {Icon as PhosphorIcon} from '@phosphor-icons/react'
import {appVisible} from '../lib/market'
import {defaultWorkspace, revokeHost} from '../lib/ops'
import {AppSettingsCtx, listApps, type AppSettingsContext} from '../lib/apps'
import {listApplications} from '../lib/applications'
import {PROXY_PRESETS} from '../lib/rss'
import {useStored} from '../lib/store'
import {SEARCH_KEY, defaultSearchConfig, normalizeSearchConfig, providerInfo, searchReady} from '../lib/webSearch'
import {Group, Row, TextRow, Tile} from './ios'
import {SidebarSettings, StatusbarSettings} from './LayoutSettings'
import {exportBackupSnapshot, importBackup, MAX_BACKUP_BYTES, parseBackup, type BackupSummary} from '../lib/storage'
import {useIsMobile} from '../lib/useMedia'
import {AiSettings} from './AiSettings'
import {SyncSettings} from './SyncSettings'
import {IncrementalSyncSettings} from './IncrementalSyncSettings'
import {StorageSettings} from './StorageSettings'
import {incrementalConfigured, readIncrementalConfig, useIncrementalStatus} from '../lib/incrementalClient'
import {readSyncConfig, syncConfigured, useSyncStatus} from '../lib/sync'
import {SearchSettings} from './SearchSettings'
import {AboutPanel} from './About'
import {AppearanceSettings} from './ThemeSettings'
import {TemplateSettings} from './TemplateSettings'
import {MemorySettings, ProfileForm, SoulSettings} from './PersonaSettings'
import {usePersona} from '../lib/persona'
import {ApplicationSettings} from './ApplicationSettings'
import type {AssistantMode} from '../lib/assistantLayout'

/**
 * 设置页，仿 iOS 设置：左边是分组列表，右边是当前项的详情。
 *
 * 全局设置只留真正全局的几项（个人、外观、AI、网络、数据）。
 * 热榜、订阅、书签、天气、监控这些功能的设置由各自组件注册（lib/apps.ts），
 * 统一出现在「应用」分组里。
 */

type Section = {
  id: string
  name: string
  icon: PhosphorIcon
  color: string
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
  const persona = usePersona()
  const syncStatus = useSyncStatus()
  const incrementalStatus = useIncrementalStatus()
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
      color: '#8e8e93',
      summary: settings.name,
      description: '搭搭怎么称呼你，以及它该了解你的哪些背景。',
      render: () => (
        <>
          <Group footer="用在首页的问候语里，也是搭搭称呼你的方式。">
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
      color: '#0a84ff',
      summary: themeMode === 'dark' ? '深色' : '浅色',
      description: '配色和主题库。页面的壁纸、特效和版式，直接对搭搭说就行。',
      render: () => <AppearanceSettings mode={themeMode} onMode={onThemeMode} />,
    },
    {
      id: 'templates',
      name: '模板',
      icon: LayoutDashboard,
      color: '#bf5af2',
      summary: `${ctx.workspace.templates.length} 个`,
      description: '把整套页面设计存下来，随时切换；也可以从内置预设起步。',
      render: () => <TemplateSettings />,
    },
    {
      id: 'sidebar',
      name: '侧栏',
      icon: PanelLeft,
      color: '#5e5ce6',
      summary: `${ctx.workspace.pages.length} 页`,
      description: '管理侧栏里的页面：名称、图标、顺序和删除。首页等系统入口是固定的。',
      render: () => <SidebarSettings />,
    },
    {
      id: 'statusbar',
      name: '状态条',
      icon: PanelTop,
      color: '#ff9f0a',
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
      color: '#ff453a',
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
      color: '#0a84ff',
      summary: searchSummary,
      description: '让搭搭自己上网查资料：Tavily、Firecrawl、SearXNG 等。也可以管理「搜索并跳转」是否每次询问。',
      render: () => <SearchSettings />,
    },
    {
      id: 'soul',
      name: '灵魂',
      icon: Heart,
      color: '#ff375f',
      summary: persona.soul.name,
      description: '搭搭是谁、怎么说话、按什么原则做事。你可以改，它自己也可以（可关）。',
      render: () => <SoulSettings />,
    },
    {
      id: 'memory',
      name: '记忆',
      icon: Brain,
      color: '#bf5af2',
      summary: `${persona.memory.items.length} 条`,
      description: '搭搭在聊天里积累的、对你的认识。看得见，改得了，删得掉。',
      render: () => <MemorySettings />,
    },
    {
      id: 'network',
      name: '网络',
      icon: Globe,
      color: '#30d158',
      summary: PROXY_PRESETS.find((p) => p.template === settings.proxy)?.label.split(' ')[0] ?? '自定义',
      description: '订阅、热榜、监控取数时共用的代理。浏览器直接请求会被跨域拦住，需要走代理。',
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
      color: '#0a84ff',
      summary: syncConfigured(readSyncConfig()) ? (syncStatus.phase === 'error' ? '出错了' : readSyncConfig().auto ? '自动' : '手动') : '未开启',
      description: '把数据同步到你自己的存储里，在多台设备间保持一致。',
      render: () => <SyncSettings />,
    },
    {
      id: 'incremental',
      name: '自建增量同步',
      icon: ArrowsClockwise,
      color: '#30b0c7',
      summary: incrementalConfigured(readIncrementalConfig()) ? (incrementalStatus.phase === 'error' ? '出错了' : readIncrementalConfig().auto ? '自动上传' : '手动') : '未开启',
      description: '连接你自己的同步服务，端到端加密，只传变化的记录，聊天变多也不需要整份上传。',
      render: () => <IncrementalSyncSettings />,
    },
    {
      id: 'storage',
      name: '容量与清理',
      icon: Database,
      color: '#5e5ce6',
      description: '看清各类数据占多少空间，按时间清理旧聊天。',
      render: () => <StorageSettings />,
    },
    {
      id: 'data',
      name: '数据',
      icon: Database,
      color: '#8e8e93',
      description: '所有数据都只在这台浏览器里。',
      render: () => (
        <>
          <Group footer={importError ? <span style={{color: 'var(--lobe-color-error, #d4380d)'}}>{importError}</span> : '导出订阅、书签、待办、页面、对话和配置，密钥也在其中，请妥善保管。导入会用备份整体替换现在的数据。'}>
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
      id: 'about',
      name: '关于',
      icon: Info,
      color: '#d43f2d',
      description: '认识一下搭搭。',
      render: () => <AboutPanel />,
    },
  ]

  const builtinApps: Section[] = listApps().filter((app) => appVisible(ctx.workspace, app.id)).map((app) => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    color: app.color,
    description: app.description,
    summary: app.summary?.(ctx),
    render: () => <app.Panel />,
  }))
  const generatedApps: Section[] = listApplications(ctx.workspace).map((app) => ({
    id: `application:${app.id}`,
    name: app.instance.title || '未命名应用',
    icon: Sparkles,
    color: 'var(--main)',
    description: app.description || '搭搭为你制作的应用。在这里管理打开方式、入口和应用设置。',
    summary: app.group || 'AI 应用',
    render: () => <ApplicationSettings key={app.id} application={app} />,
  }))
  const apps = [...builtinApps, ...generatedApps]

  const all = [...general, ...system, ...apps]
  const current = all.find((item) => item.id === section) ?? general[0]

  const select = (id: string) => {
    onSection(id)
    setPane('detail')
  }
  const row = (item: Section) => (
    <Row
      key={item.id}
      icon={<Tile icon={item.icon} color={item.color} />}
      label={item.name}
      chevron
      selected={item.id === current.id}
      onClick={() => select(item.id)}
    >
      {item.summary ? <span className="ios-summary">{item.summary}</span> : undefined}
    </Row>
  )

  return (
    <AppSettingsCtx.Provider value={ctx}>
      <div className="settings-page" data-pane={pane}>
        <aside className="ios-side">
          <h1 className="ios-large">设置</h1>
          <Group>{general.slice(0, 2).map(row)}</Group>
          <Group>{general.slice(2).map(row)}</Group>
          <Group>{system.slice(0, 3).map(row)}</Group>
          {apps.length > 0 && <Group title="应用">{apps.map(row)}</Group>}
          <Group>{system.slice(3).map(row)}</Group>
        </aside>

        <main className="ios-detail">
          <div className="ios-detail-inner">
            <header className="ios-detail-head">
              <ActionIcon className="ios-back" icon={ChevronLeft} aria-label="返回设置列表" title="返回" onClick={() => setPane('list')} />
              <Tile icon={current.icon} color={current.color} size={34} />
              <h1>{current.name}</h1>
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
