import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'
import '../../src/widgets'
import {ApplicationHost} from '../../src/components/ApplicationHost'
import {Assistant} from '../../src/components/Assistant'
import {ApprovalCard} from '../../src/components/ApprovalCard'
import {ShellHost, ShellCanvas, ShellNavigation, ShellPort, BUILTIN_SHELL_ADAPTERS, STANDARD_CAPABILITIES, VISIBLE_PRESENTATION, createShellRegistry, type ShellAdapter, type ShellAdapterProps, type ShellSnapshot} from '../../src/components/shell'
import {resolveShellTheme} from '../../src/lib/shell/theme'
import {projectNavigation, type ShellIntent} from '../../src/lib/shell/navigation'
import {resolveTheme} from '../../src/lib/themes'
import {IOS_THEME, SWITCH_THEME, WIN98_THEME} from '../../src/lib/workspace'
import {defaultWorkspace} from '../../src/lib/ops'
import {createApplication} from '../../src/lib/applications'
import {initStorage} from '../../src/lib/storage'
import type {ComponentHost} from '../../src/lib/registry'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../../src/styles.css'
import '../../src/theme.css'
import '../../src/dock.css'
import '../../src/life.css'
import '../../src/switch-content.css'
import '../../src/win98-content.css'

type Probe = {mounts: number; cleanups: number; events: string[]; requested: string; snapshot: ShellSnapshot | null; duplicate: string}
const probe: Probe = {mounts: 0, cleanups: 0, events: [], requested: '', snapshot: null, duplicate: ''}
Object.assign(window, {shellProbe: probe})

// 这是第四个受信实现，仅通过模块 registry 注入；未增加生产 ThemeShell 或主题记录。
function Fourth({model, dispatch, publish, reportError}: ShellAdapterProps) {
  const [hidden, setHidden] = useState(false)
  const revision = useRef(model.activation.revision)
  useEffect(() => {
    probe.mounts++
    const listener = () => probe.events.push('fourth-event')
    window.addEventListener('shell-fixture-event', listener)
    return () => {probe.cleanups++; window.removeEventListener('shell-fixture-event', listener)}
  }, [])
  useLayoutEffect(() => {if (revision.current !== model.activation.revision) {revision.current = model.activation.revision; setHidden(false)}}, [model.activation.revision])
  useLayoutEffect(() => publish({...VISIBLE_PRESENTATION, content: hidden ? 'launcher' : 'visible', reserves: {top: 48, right: 0, bottom: 0, left: 0}}), [hidden, publish])
  return <ShellPort place="canvas"><nav style={{position: 'absolute', top: 0, left: 0, display: 'flex', gap: 6, background: 'var(--bg2)', zIndex: 5}}>
    <button onClick={() => setHidden(value => !value)}>第四外壳隐藏恢复</button>
    <button onClick={() => dispatch({type: 'navigate', target: {kind: 'page', id: 'home'}})}>第四外壳同目标</button>
    <button onClick={() => reportError(new Error('测试事件故障'))}>触发事件故障</button>
    <button onClick={() => publish({...VISIBLE_PRESENTATION, reserves: {top: Number.NaN, right: 0, bottom: 0, left: 0}})}>触发布局故障</button>
    <button onClick={() => publish({...VISIBLE_PRESENTATION, reserves: {top: 4000, right: 0, bottom: 0, left: 0}})}>触发超界布局</button>
  </nav></ShellPort>
}
function Broken() {useState(0); throw new Error('测试渲染故障')}
const fourth: ShellAdapter = {id: 'test-fourth', capabilities: STANDARD_CAPABILITIES, Chrome: Fourth}
const broken: ShellAdapter = {id: 'test-render-error', capabilities: STANDARD_CAPABILITIES, Chrome: Broken}
const registry = [...BUILTIN_SHELL_ADAPTERS, fourth, broken]
try {createShellRegistry([...registry, fourth])} catch (error) {probe.duplicate = String(error)}

// 使用真实应用运行器及助手组件，业务状态属于稳定宿主；没有复制 App 的导航/外壳实现。
await initStorage()
const created = createApplication(defaultWorkspace(), {type: 'app', title: '第四外壳真实应用', openMode: 'page', config: {html: '<output id="init"></output><input aria-label="第四外壳应用草稿">', css: '', js: 'const n=(await tada.store.get("init")??0)+1;await tada.store.set("init",n);document.getElementById("init").textContent="初始化 "+n'}})
const workspace = created.workspace
const noop = () => {}
const host: ComponentHost = {openPage: noop, openSettings: noop, openMonitor: noop, openAssistant: noop, openArticle: noop, readIds: [], markRead: noop, proxy: '', hotSource: '', ask: noop, aiConfigured: true, aiModel: 'fixture', aiBusy: false, search: noop, networkGrants: [], requestNetworkGrant: async () => false, monitor: {online: 0, total: 0, tone: '', items: []}, profile: {name: '测试', city: '', lat: 0, lon: 0, showSeconds: false, showFavicons: false}}
function Harness() {
  const [requestedShell, setRequestedShell] = useState('test-fourth')
  const [theme, setTheme] = useState(IOS_THEME)
  const [snapshot, setSnapshot] = useState<ShellSnapshot>({...VISIBLE_PRESENTATION, activeShell: 'standard', activeSkin: 'ios', capabilities: STANDARD_CAPABILITIES, fault: null})
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(true)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [status, setStatus] = useState('初始')
  const [approval, setApproval] = useState(true)
  const applied = useRef<string[]>([])
  const requested = useMemo(() => resolveTheme(theme, 'light'), [theme])
  const effective = useMemo(() => resolveShellTheme(requested, snapshot), [requested, snapshot])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = effective.mode
    root.dataset.shell = snapshot.activeShell
    if (effective.skin === 'paper') delete root.dataset.skin; else root.dataset.skin = effective.skin
    for (const key of applied.current) root.style.removeProperty(`--${key}`)
    applied.current = Object.keys(effective.overrides)
    for (const [key, value] of Object.entries(effective.overrides)) root.style.setProperty(`--${key}`, value)
    probe.requested = requestedShell; probe.snapshot = snapshot
  }, [effective, requestedShell, snapshot])
  const dispatch = useCallback((intent: ShellIntent) => {
    probe.events.push(JSON.stringify(intent))
    if (intent.type === 'navigate') {setStatus(intent.target.kind === 'system' ? `设置:${intent.target.name}` : `目标:${intent.target.kind}`); setRevision(value => value + 1)}
    if (intent.type === 'assistant') {
      if (intent.action === 'stop') {setBusy(false); setStatus('停止已执行')}
      else {setAssistantOpen(true); setStatus('助手已打开')}
    }
  }, [])
  const model = useMemo(() => ({entries: projectNavigation(workspace, false), activation: {revision, target: {kind: 'page' as const, id: 'home'}, title: '稳定业务'}, mode: 'light' as const, profile: {name: '夹具', avatarSeed: 'fixture'}, assistant: {open: assistantOpen, busy}}), [revision, assistantOpen, busy])
  return <ConfigProvider motion={motion}>
    <div style={{position: 'fixed', zIndex: 20000, top: 50, right: 4, display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 340}}>
      <button onClick={() => setRequestedShell('test-fourth')}>请求第四外壳</button>
      <button onClick={() => setRequestedShell('standard')}>请求标准外壳</button>
      <button onClick={() => {setTheme(SWITCH_THEME); setRequestedShell('missing-switch')}}>请求缺失Switch外壳</button>
      <button onClick={() => {setTheme(WIN98_THEME); setRequestedShell('missing-win98')}}>请求缺失Win98外壳</button>
      <button onClick={() => {setTheme(WIN98_THEME); setRequestedShell('test-render-error')}}>请求渲染故障</button>
      <output id="fixture-status">{status}</output>
    </div>
    <div className="app">
      <ShellHost requestedShell={requestedShell} requestedSkin={theme.skin} registry={registry} model={model} dispatch={dispatch} onPresentationChange={setSnapshot}>
        <ShellNavigation />
        <ShellCanvas style={{width: 'calc(100vw - 360px)', flex: '1 1 auto', height: '100vh'}}>
          <section className="page" style={{padding: 56, overflow: 'auto'}}>
            <h1>真实稳定业务舞台</h1><input aria-label="第四外壳未提交输入" defaultValue="" />
            <ApplicationHost application={created.application} mode="page" workspace={workspace} host={host} onClose={noop} onConfig={noop} />
          </section>
        </ShellCanvas>
        <aside style={{width: 360, flex: '0 0 360px'}}>
          <Assistant open={assistantOpen} mode="split" onMode={noop} ai={{baseUrl: '', apiKey: '', model: 'fixture', protocol: 'openai'}} turns={[]} ready convs={[]} convId="fixture" activeTurnIds={[]} hasOlderTurns={false} turnsLoading={false} turnsError="" onLoadOlderTurns={async () => {}} hasMoreConvs={false} convsLoading={false} convsError="" onLoadMoreConvs={async () => {}} onNewConv={noop} onOpenConv={noop} onDeleteConv={noop} busy={false} seed={{text: '', key: 0}} onRemoveArticle={noop} onSend={noop} onStop={() => setBusy(false)} onClose={() => setAssistantOpen(false)} onOpenSettings={noop} onApprovalAnswer={noop} />
          {approval && <ApprovalCard request={{id: 'fixture-approval', tool: '夹具操作', summary: '跨外壳保留本次审批'}} onAnswer={() => setApproval(false)} />}
        </aside>
      </ShellHost>
    </div>
  </ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
