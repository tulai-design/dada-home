import {StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider, Input} from '@lobehub/ui'
import {motion} from 'motion/react'
import {PageView} from '../src/components/PageView'
import {HomepageDraftPreview} from '../src/components/HomepageDraftPreview'
import {registerComponent, type ComponentHost, type ComponentProps} from '../src/lib/registry'
import type {Workspace} from '../src/lib/workspace'
import {commit, getWorkspace, useWorkspace} from '../src/lib/workspaceStore'
import {createHomepageDraft, getHomepageDraft, getHomepageDraftWorkspace, useHomepageDraft, updateHomepageDraft} from '../src/lib/homepageDraft'
import {createHomepageDraftInspectionHost} from '../src/lib/homepageDraftInspection'
import {createPageInspectionHost, type MountedInspectionPage} from '../src/lib/pageInspectionHost'
import '../src/widgets/clock'
import '../src/widgets/search'
import '../src/widgets/links'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'
import '../src/page-sections.css'
import '../src/homepage-draft.css'

let mounts = 0
function Business({instance}: ComponentProps) {
  const [value, setValue] = useState('')
  useEffect(() => {mounts++; document.body.dataset.businessMounts = String(mounts); void fetch('/__draft_business_probe__').catch(() => {})}, [])
  return <div><h3>{instance.title}</h3><Input aria-label={`正式输入 ${instance.id}`} value={value} onChange={(event) => setValue(event.target.value)} /><Button onClick={() => localStorage.setItem(`business.${instance.id}`, '保留')}>保存{instance.id}</Button></div>
}
for (const type of ['note', 'applet'] as const) registerComponent({type, name: type === 'note' ? '便签' : '小程序', description: '', category: 'content', defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, component: Business})
const base:Workspace = {version:6,pages:[{id:'home',name:'首页',label:'首页',components:[
  {id:'clock',type:'clock',span:'full',config:{showSeconds:false,showGreeting:true,showWeather:false,align:'center'}},
  {id:'search',type:'search',span:'full',config:{engine:'bing'}},
  {id:'links',type:'links',span:'full',config:{links:'GitHub https://github.com\n知乎 https://zhihu.com\n少数派 https://sspai.com',showFavicons:false}},
  {id:'note',type:'note',title:'正在进行',config:{},look:{css:'min-height: 144px'}},
  {id:'app',type:'applet',title:'我的小工具',config:{source:'not executed in this fixture'}},
]}],layout:{columns:12,maxWidth:1280},applications:[],widgets:[],statusbar:[],addons:['desk'],network:[],templates:[],themes:[],theme:{active:'default',mode:'light',base:'light'}}
const host:ComponentHost = {openPage(){},openSettings(){},openMonitor(){},openAssistant(){},openArticle(){},readIds:[],markRead(){},proxy:'',hotSource:'',ask(){},aiConfigured:false,aiModel:'',aiBusy:false,search(){},networkGrants:[],requestNetworkGrant:async()=>false,monitor:{online:0,total:0,tone:'',items:[]},profile:{name:'朋友',city:'',lat:0,lon:0,showSeconds:false,showFavicons:false}}
commit(base)
function App() {
  const {workspace, undo, redo} = useWorkspace()
  const draft = useHomepageDraft()
  const draftWorkspace = getHomepageDraftWorkspace()
  const [width, setWidth] = useState(1120)
  const [report, setReport] = useState('')
  const [cssProbe, setCssProbe] = useState(false)
  const [badCss, setBadCss] = useState(false)
  const mounted = useRef<MountedInspectionPage|null>(null)
  const live = useRef<HTMLDivElement>(null)
  const setMounted = useCallback((value:MountedInspectionPage|null)=>{mounted.current=value}, [])
  const inspect = useRef(createHomepageDraftInspectionHost({getMounted:()=>mounted.current})).current
  const inspectLive = useRef(createPageInspectionHost({getWorkspace, getMounted:()=>live.current ? {root:live.current,pageId:'home',workspace:getWorkspace(),revision:'live'} : null})).current
  useLayoutEffect(()=>{document.documentElement.dataset.theme=workspace.theme.mode},[workspace.theme.mode])
  const create = () => createHomepageDraft({recipeId:'minimal'})
  const amend = () => {const value=getHomepageDraft()!; updateHomepageDraft({draftId:value.id,expectedRevision:value.revision,sections:[{id:'fixed',kind:'section',title:'新的内容顺序',items:['app','note','links','search','clock'],columns:1}]})}
  const cssPage = {...workspace.pages[0],components:[{id:'note',type:'note' as const,config:{},look:{css:badCss ? 'background-image: image-set("https://draft-css.invalid/image.png" 1x)' : 'min-height:240px'}}],css:badCss?'@import "https://draft-css.invalid/evil.css"':undefined}
  return <ConfigProvider motion={motion} themeMode={workspace.theme.mode}><main className="draft-fixture-shell">
    <style>{`.draft-fixture-shell{padding:16px;background:var(--bg);color:var(--text);height:100vh;overflow:auto}.draft-fixture-controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.draft-fixture-shell .canvas{position:relative;margin-inline:auto;height:780px;max-width:100%;box-shadow:none}.draft-fixture-shell .topbar{height:40px;min-height:40px}.draft-fixture-shell pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}.draft-fixture-css{margin-top:16px}`}</style>
    <div className="draft-fixture-controls">
      <Button id="create" onClick={create} disabled={Boolean(draft)}>生成草稿</Button>
      <Button id="wide" onClick={()=>setWidth(1120)}>宽容器</Button><Button id="narrow" onClick={()=>setWidth(360)}>窄容器</Button>
      <Button id="theme" onClick={()=>commit({...workspace,theme:{...workspace.theme,mode:workspace.theme.mode==='light'?'dark':'light'}})}>切换明暗</Button>
      <Button id="amend" disabled={!draft} onClick={amend}>修正草稿</Button>
      <Button id="check" disabled={!draft} onClick={()=>void inspect({draftId:draft!.id}).then(value=>setReport(JSON.stringify(value)))}>检查草稿接口</Button>
      <Button id="live-check" onClick={()=>void inspectLive({}).then(value=>setReport(JSON.stringify(value)))}>检查正式页</Button>
      <Button id="undo" onClick={()=>undo()}>撤销</Button><Button id="redo" onClick={()=>redo()}>重做</Button>
      <Button id="conflict" onClick={()=>commit({...workspace,pages:[{...workspace.pages[0],name:'正式新标题'}]})}>正式变更</Button>
      <Button id="empty" disabled={Boolean(draft)} onClick={()=>commit({...base,pages:[{...base.pages[0],components:[]}]})}>空首页</Button>
      <Button id="reset" disabled={Boolean(draft)} onClick={()=>commit(base)}>恢复首页</Button>
      <Button id="css-probe" onClick={()=>setCssProbe(value=>!value)}>样式隔离</Button>
      <Button id="bad-css" onClick={()=>{setBadCss(true);setCssProbe(true)}}>不安全样式</Button>
    </div>
    <div className="canvas" style={{width}} data-homepage-draft-active={draft ? true : undefined}>
      <div className="topbar"><Button id="live-entry" onClick={create} disabled={Boolean(draft)}>首页布局</Button></div>
      <div ref={live} id="live" className="page" data-page-id="home" inert={draft ? true : undefined} aria-hidden={draft ? true : undefined}><PageView page={workspace.pages[0]} workspace={workspace} host={host} onUpdateConfig={()=>{}} onRemove={()=>{}} /></div>
      {draft && draftWorkspace && <HomepageDraftPreview draft={draft} workspace={draftWorkspace} host={host} onMount={setMounted} inspect={inspect} />}
    </div>
    {cssProbe && <div id="css-preview" className="draft-fixture-css"><PageView page={cssPage} workspace={workspace} host={host} onUpdateConfig={()=>{}} onRemove={()=>{}} renderPreview={()=> <p>静态预览</p>}/></div>}
    <pre id="report">{report}</pre><pre id="state">{JSON.stringify({order:workspace.pages[0].components.map(item=>item.id),sections:workspace.pages[0].sections??null,draft:draft?{id:draft.id,revision:draft.revision}:null})}</pre>
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
