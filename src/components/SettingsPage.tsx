import {useState, type ReactNode} from 'react'
import {ActionIcon, Modal, Segmented, Slider, Text} from '@lobehub/ui'
import {ChevronLeft, Database, Download, Globe, LayoutTemplate, Palette, PanelLeft, PanelTop, RotateCcw, Sparkles, User} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import {appVisible} from '../lib/market'
import {defaultWorkspace} from '../lib/ops'
import {AppSettingsCtx, listApps, type AppSettingsContext} from '../lib/apps'
import {PROXY_PRESETS} from '../lib/rss'
import {useStored} from '../lib/store'
import {Group, Row, TextRow, Tile} from './ios'
import {SidebarSettings, StatusbarSettings} from './LayoutSettings'

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
  icon: LucideIcon
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
  onSection: (id: string) => void
  onReset: () => void
}

function exportBackup() {
  const dump: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith('fp.')) dump[key] = localStorage.getItem(key)
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], {type: 'application/json'})
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `dada-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function SettingsPage({ctx, themeMode, onThemeMode, section, onSection, onReset}: Props) {
  const {settings, patch} = ctx
  const [pane, setPane] = useState<'list' | 'detail'>('detail')
  const [resetOpen, setResetOpen] = useState(false)
  const [assistantMode, setAssistantMode] = useStored<'drawer' | 'full'>('assistantMode', 'drawer')

  const general: Section[] = [
    {
      id: 'profile',
      name: '个人',
      icon: User,
      color: '#8e8e93',
      summary: settings.name,
      description: '搭搭怎么称呼你。',
      render: () => (
        <Group footer="用在首页的问候语里。">
          <TextRow label="称呼" value={settings.name} placeholder="朋友" onChange={(v) => patch({name: v})} />
        </Group>
      ),
    },
    {
      id: 'appearance',
      name: '外观',
      icon: Palette,
      color: '#0a84ff',
      summary: themeMode === 'dark' ? '深色' : '浅色',
      render: () => (
        <Group footer="页面的壁纸、特效和版式，直接对搭搭说就行。">
          <Row label="配色">
            <Segmented
              size="small"
              value={themeMode}
              options={[
                {value: 'light', label: '浅色'},
                {value: 'dark', label: '深色'},
              ]}
              onChange={(v) => onThemeMode(v as 'light' | 'dark')}
            />
          </Row>
        </Group>
      ),
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
      summary: `${ctx.workspace.statusbar.length} 项`,
      description: '顶栏右侧的实时小组件，比如时钟、天气、服务在线数。',
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
      description: '接入兼容 OpenAI 的模型。密钥只保存在这台浏览器里。',
      render: () => (
        <>
          <Group title="模型">
            <TextRow label="接口地址" stack value={settings.ai.baseUrl} placeholder="https://api.openai.com/v1" onChange={(v) => patch({ai: {...settings.ai, baseUrl: v}})} />
            <TextRow label="密钥" secret value={settings.ai.apiKey} placeholder="sk-…" onChange={(v) => patch({ai: {...settings.ai, apiKey: v}})} />
            <TextRow label="模型" value={settings.ai.model} placeholder="gpt-4o-mini" onChange={(v) => patch({ai: {...settings.ai, model: v}})} />
          </Group>
          <Group title="风格" footer="数值越低回答越稳，越高越发散。">
            <Row label="温度" stack hint={settings.ai.temperature.toFixed(1)}>
              <Slider min={0} max={1.5} step={0.1} value={settings.ai.temperature} onChange={(v) => patch({ai: {...settings.ai, temperature: v}})} />
            </Row>
          </Group>
          <Group title="对话面板" footer="也可以随时点面板右上角的图标切换。">
            <Row label="打开方式">
              <Segmented
                size="small"
                value={assistantMode}
                options={[
                  {value: 'drawer', label: '侧栏'},
                  {value: 'full', label: '全屏'},
                ]}
                onChange={(v) => setAssistantMode(v as 'drawer' | 'full')}
              />
            </Row>
          </Group>
        </>
      ),
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
        </>
      ),
    },
    {
      id: 'data',
      name: '数据',
      icon: Database,
      color: '#8e8e93',
      description: '所有数据都只在这台浏览器里。',
      render: () => (
        <>
          <Group footer="导出订阅、书签、待办、页面和配置。密钥也在其中，请妥善保管。">
            <Row label="导出备份" icon={<Download size={16} />} chevron onClick={exportBackup} />
          </Group>
          <Group footer="只把页面、侧栏、状态条和已装的组件恢复成初始状态；订阅、书签、待办和密钥都保留。">
            <Row label="恢复默认布局" icon={<LayoutTemplate size={16} />} onClick={() => ctx.edit((ws) => ({...defaultWorkspace(), theme: ws.theme}))} />
          </Group>
          <Group footer="会清掉订阅、书签、待办、页面和密钥，回到初始状态。">
            <Row label="恢复默认" icon={<RotateCcw size={16} />} danger onClick={() => setResetOpen(true)} />
          </Group>
        </>
      ),
    },
  ]

  const apps: Section[] = listApps().filter((app) => appVisible(ctx.workspace, app.id)).map((app) => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    color: app.color,
    description: app.description,
    summary: app.summary?.(ctx),
    render: () => <app.Panel />,
  }))

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
          <Group>{system.slice(0, 2).map(row)}</Group>
          {apps.length > 0 && <Group title="应用">{apps.map(row)}</Group>}
          <Group>{system.slice(2).map(row)}</Group>
        </aside>

        <main className="ios-detail">
          <div className="ios-detail-inner">
            <header className="ios-detail-head">
              <ActionIcon className="ios-back" icon={ChevronLeft} title="返回" onClick={() => setPane('list')} />
              <Tile icon={current.icon} color={current.color} size={34} />
              <h1>{current.name}</h1>
            </header>
            {current.description && <p className="ios-detail-desc">{current.description}</p>}
            {current.render()}
          </div>
        </main>
      </div>

      <Modal
        open={resetOpen}
        title="恢复默认"
        onCancel={() => setResetOpen(false)}
        okText="确定"
        cancelText="取消"
        onOk={() => {
          setResetOpen(false)
          onReset()
        }}
      >
        <Text>会清掉订阅、书签、待办、页面和密钥，确定吗？</Text>
      </Modal>
    </AppSettingsCtx.Provider>
  )
}
