import {StrictMode, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider, Empty, Input} from '@lobehub/ui'
import {motion} from 'motion/react'
import {PageView} from '../src/components/PageView'
import {registerComponent, type ComponentHost, type ComponentProps} from '../src/lib/registry'
import type {Page, Workspace} from '../src/lib/workspace'
import {inspectPageElement} from '../src/lib/pageInspector'
import '../src/widgets/clock'
import '../src/widgets/search'
import '../src/widgets/links'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'
import '../src/page-sections.css'

// Only this isolated fixture registry is replaced. Business state stays in React, never user storage.
function FixtureContent({instance, config}: ComponentProps) {
  const [count, setCount] = useState(0)
  const [draft, setDraft] = useState('')
  const kind = config.kind
  if (kind === 'intro') return <div className="section-demo-intro"><p>10月27日 · 星期二</p><strong>今天，专注一件事。</strong><p>把想法写下来，留出动手的时间。</p></div>
  if (kind === 'editor') return <div className="section-demo-content"><h3>正在进行</h3><Input aria-label="保留输入" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下今天最重要的事" /><Button data-focus={instance.id} id="demo-counter" onClick={() => setCount((value) => value + 1)}>已完成 {count}</Button></div>
  if (kind === 'empty') return <Empty title="还没有记录" description="在这里留下一点想法。" />
  if (kind === 'agenda') return <div className="section-demo-content"><h3>接下来</h3><p><b>14:00</b>　产品讨论</p><p><b>16:30</b>　阅读与整理</p><Button type="text" data-focus={instance.id}>查看日程</Button></div>
  if (kind === 'reading') return <div className="section-demo-content"><h3>阅读清单</h3><p>设计里的秩序与留白</p><p>一份值得慢读的文字，保留内容自身的节奏。</p><Button type="text" data-focus={instance.id}>继续阅读</Button></div>
  return <div className="section-demo-content"><h3>{String(config.title ?? instance.id)}</h3><p>{String(config.body ?? '随时打开，接着上次继续。')}</p><Button type="text" data-focus={instance.id}>打开{String(config.title ?? instance.id)}</Button></div>
}
registerComponent({type: 'note', name: '夹具内容', category: 'content', defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, component: FixtureContent})
registerComponent({type: 'pomodoro', name: '舞台夹具', category: 'tool', defaultConfig: {}, configSchema: {}, defaultSpan: 'full', stage: {width: 420}, multiple: false, component: FixtureContent})

const host: ComponentHost = {openPage() {}, openSettings() {}, openMonitor() {}, openAssistant() {}, openArticle() {}, readIds: [], markRead() {}, proxy: '', hotSource: '', ask() {}, aiConfigured: false, aiModel: '', aiBusy: false, search() {}, networkGrants: [], requestNetworkGrant: async () => false, monitor: {online: 0, total: 0, tone: '', items: []}, profile: {name: '朋友', city: '', lat: 0, lon: 0, showSeconds: false, showFavicons: false}}
const base: Page = {id: 'section-demo', name: '我的工作台', label: '工作台', align: 'center', components: [
  {id: 'intro', type: 'note', config: {kind: 'intro'}, span: 'full'},
  {id: 'primary', type: 'note', config: {kind: 'editor'}},
  {id: 'reading', type: 'note', config: {kind: 'reading'}},
  {id: 'secondary', type: 'note', config: {kind: 'agenda'}},
  {id: 'shortcut-a', type: 'note', config: {title: '收藏'}},
  {id: 'shortcut-b', type: 'note', config: {title: '便签'}},
  {id: 'shortcut-c', type: 'note', config: {kind: 'empty'}},
  {id: 'unassigned', type: 'note', config: {title: '稍后处理'}, span: 'full'},
], sections: [
  {id: 'focus', kind: 'hero', items: ['intro']},
  {id: 'work', kind: 'split', title: '工作台', primary: ['primary', 'reading'], secondary: ['secondary'], ratio: 'wide-primary'},
  {id: 'shortcuts', kind: 'section', title: '随手打开', items: ['shortcut-a', 'shortcut-b', 'shortcut-c'], columns: 3},
  {id: 'empty', kind: 'section', title: '不应显示的空分区', items: []},
]}
const workspace: Workspace = {version: 6, pages: [base], layout: {columns: 12, maxWidth: 1280}, applications: [], widgets: [], statusbar: [], addons: [], network: [], templates: [], themes: [], theme: {active: 'default', mode: 'light', base: 'light'}}
function App() {
  const [width, setWidth] = useState(1120)
  const [dark, setDark] = useState(false)
  const [page, setPage] = useState(base)
  const [report, setReport] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const theme = () => {document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(!dark)}
  return <ConfigProvider motion={motion} themeMode={dark ? 'dark' : 'light'}><main className="section-demo-shell">
    <style>{`.section-demo-shell{padding:24px;background:var(--bg);color:var(--text);min-height:100vh}.section-demo-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}.section-demo-intro{padding-block:16px 24px}.section-demo-intro strong{font:500 40px/1.3 var(--font-serif);display:block;overflow-wrap:anywhere}.section-demo-intro p{font-size:13px;color:var(--text3);margin:12px 0}.section-demo-content{display:flex;flex-direction:column;align-items:flex-start;gap:12px;min-width:0}.section-demo-content h3{font:500 18px/1.4 var(--font-serif);margin:0}.section-demo-content p{font-size:14px;color:var(--text2);margin:0;overflow-wrap:anywhere}.section-demo-content input{max-width:100%}.section-demo-shell pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}`}</style>
    <div className="section-demo-controls">
      <Button id="wide" onClick={() => setWidth(1120)}>宽容器</Button><Button id="narrow" onClick={() => setWidth(360)}>窄容器</Button>
      <Button id="theme" onClick={theme}>切换明暗</Button>
      <Button id="rearrange" onClick={() => setPage({...base, sections: [{id: 'focus', kind: 'hero', items: ['intro']}, {id: 'work', kind: 'split', title: '工作台', primary: ['reading'], secondary: ['primary', 'secondary']}, ...base.sections!.slice(2)]})}>调整分区</Button>
      <Button id="flat" onClick={() => setPage(({sections: _sections, ...current}) => current)}>扁平布局</Button>
      <Button id="reset" onClick={() => setPage(base)}>恢复分区</Button>
      <Button id="long" onClick={() => setPage({...base, sections: base.sections!.map((section) => section.id === 'work' ? {...section, title: '很长的工作区标题与LongUnbrokenSectionTitleForResponsiveVerificationWithoutOverflow'} : section)})}>长标题</Button>
      <Button id="empty-primary" onClick={() => setPage({...base, sections: [{id: 'one-side', kind: 'split', title: '仅辅助内容', primary: [], secondary: ['primary', 'secondary']}]})}>空主列</Button>
      <Button id="empty-secondary" onClick={() => setPage({...base, sections: [{id: 'one-side', kind: 'split', title: '仅主内容', primary: ['primary', 'secondary'], secondary: []}]})}>空辅列</Button>
      <Button id="empty-sections" onClick={() => setPage({...base, sections: [{id: 'all-empty', kind: 'section', title: '不应显示的空分区', items: []}]})}>空分区</Button>
      <Button id="variants" onClick={() => setPage({...base, sections: base.sections!.map((section) => section.kind === 'hero' ? {...section, title: '我的一天', align: 'center'} : section.kind === 'split' ? {...section, ratio: 'equal'} : {...section, columns: 2})})}>布局选项</Button>
      <Button id="untitled" onClick={() => setPage({...base, sections: base.sections!.map(({title: _title, ...section}) => section)})}>隐藏标题</Button>
      <Button id="stage" onClick={() => setPage({id: base.id, name: '舞台', label: '', components: [{id: 'stage', type: 'pomodoro', config: {title: '专注时间'}}]})}>旧舞台</Button>
      <Button id="section-stage" onClick={() => setPage({id: base.id, name: '舞台', label: '', components: [{id: 'stage', type: 'pomodoro', config: {title: '专注时间'}}], sections: [{id: 'stage-group', kind: 'hero', items: ['stage']}]})}>分区单组件</Button>
      <Button id="legacy-home" onClick={() => setPage({id: base.id, name: '旧首页', label: '', align: 'center', components: [{id: 'clock', type: 'clock', span: 'full', config: {showDate: true, showGreeting: true, format: '24h', align: 'center'}}, {id: 'search', type: 'search', span: 'full', config: {}}, {id: 'links', type: 'links', span: 'full', config: {links: 'GitHub https://github.com', showFavicons: false}}]})}>旧首页</Button>
      <Button id="empty-page" onClick={() => setPage({...base, components: []})}>空页面</Button>
      <Button id="inspect" onClick={() => setReport(JSON.stringify(inspectPageElement(root.current, {pageId: page.id, pageName: page.name, theme: dark ? 'dark' : 'light', reducedMotion: false, revision: 'fixture', now: Date.now()})))}>检查</Button>
    </div>
    <div ref={root} id="fixture" className="page" data-page-id={page.id} style={{width, maxWidth: '100%', height: 720, position: 'relative', marginInline: 'auto'}}>
      <PageView page={page} workspace={workspace} host={host} onUpdateConfig={() => {}} onRemove={() => {}} />
    </div>
    <pre id="report">{report}</pre>
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
