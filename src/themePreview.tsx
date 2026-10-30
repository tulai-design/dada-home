import {useEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createPortal} from 'react-dom'
import {Button, ConfigProvider, Drawer, Input, Modal, Segmented} from '@lobehub/ui'
import {motion} from 'motion/react'
import {connectThemePreviewResources} from './lib/themeAuthoring/previewBridge'
import {acquireThemeFonts} from './lib/fonts'
import {resolveTheme} from './lib/themes'
import {DEFAULT_WIN98_WINDOW_GAP} from './lib/themeCatalog'
import {isThemePreviewRequest, THEME_PREVIEW_PROTOCOL, type ThemePreviewRequest, type ThemePreviewResponse} from './lib/themeAuthoring/previewProtocol'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import './styles.css'
import './theme.css'
import './switch-content.css'
import './win98-content.css'
import './theme-recipes.css'
import './theme-preview.css'

const channel = new URLSearchParams(location.hash.slice(1)).get('channel')
const portals = document.getElementById('preview-portals')!
/** 仅静态、脱敏的宿主控件；不导入业务根、组件注册或持久化模块。 */
function Presenter({request}: {request: ThemePreviewRequest}) {
  const [modal, setModal] = useState(false)
  const [drawer,setDrawer] = useState(false)
  const [segment, setSegment] = useState('today')
  const presentation=resolveTheme(request.theme,request.mode,{packageAvailability:request.availability})
  const skin = presentation.skin
  return <main className="theme-preview-fixture" data-preview-fixture>
    <header className="preview-heading"><span>搭搭 · 主题样本</span><small>固定演示内容 · {request.mode === 'light' ? '浅色' : '深色'} · {request.width}px</small></header>
    {skin === 'switch' && <section className="preview-switch" data-preview-sample><div className="preview-switch-cover">一块小小的<br/>灵感天地</div><div><strong>我的桌面</strong><p>主屏、封面与焦点色样本</p><button className="preview-switch-focus">继续探索</button></div></section>}
    {skin === 'win98' && <section className="preview-win98" data-preview-sample><header>我的电脑 <span>_ □ ×</span></header><div>欢迎来到你的数字桌面。<p>窗口边距 {presentation.shellConfig?.windowGap ?? DEFAULT_WIN98_WINDOW_GAP}px</p></div><footer>开始 ▪ 主题预览　　12:00</footer></section>}
    <section className="preview-card" data-preview-sample><h1>把日常，搭成喜欢的样子。</h1><p>这是一份固定的主题夹具，不含你的待办、聊天或应用。</p><Segmented value={segment} onChange={setSegment} options={[{label:'今天',value:'today'},{label:'灵感',value:'ideas'}]} /><div className="preview-controls"><Button type="primary" onClick={()=>setModal(true)}>打开弹窗</Button><Button onClick={()=>setDrawer(true)}>打开抽屉</Button><Button>普通按钮</Button><Button disabled>禁用状态</Button><Button className="preview-hover">悬停样本</Button></div><Input aria-label="主题预览输入" placeholder="写下一点灵感" defaultValue="固定示例" /><Input aria-label="禁用输入样本" placeholder="禁用输入" disabled /></section>
    <section className="preview-card" data-preview-sample><h2>外观设置</h2><div className="preview-row"><span>今天的色彩</span><strong className="preview-accent">主题主色</strong></div><div className="preview-row"><span>安静的留白</span><span>跟随当前设计</span></div><div className="preview-focus" tabIndex={0}>键盘焦点样本 · Tab 可访问</div></section>
    <div className="preview-overlay-grid"><section className="preview-card" role="region" aria-label="静态抽屉样本" data-preview-sample><h2>抽屉样本</h2><Input aria-label="抽屉样本输入" placeholder="仅演示，不保存" /><Button>完成</Button></section><section className="preview-card" role="region" aria-label="静态窗口样本" data-preview-sample><h2>窗口与卡片</h2><p>静态窗口内容与普通业务控件。</p><Button type="primary">确认</Button></section></div>
    {createPortal(<div className="preview-toast" role="status" data-preview-portal>已准备好 · 静态通知样本</div>, portals)}
    <Modal open={modal} title="主题弹窗样本" getContainer={portals} onCancel={()=>setModal(false)} onOk={()=>setModal(false)} okText="完成" cancelText="关闭" width={Math.min(420, request.width-32)}><p>这个弹窗只存在于预览文档。</p><Input aria-label="弹窗样本输入" placeholder="固定脱敏示例" /></Modal>
    <Drawer open={drawer} title="主题抽屉样本" getContainer={portals} width={Math.min(380,request.width-24)} styles={{popup:{height:500,top:12,bottom:'auto'},panel:{height:'100%'}}} onClose={()=>setDrawer(false)} footer={<Button onClick={()=>setDrawer(false)}>关闭抽屉样本</Button>}><p>固定脱敏抽屉，不保存数据或调用业务。</p><Input aria-label="抽屉预览输入" placeholder="独立预览文档"/></Drawer>
  </main>
}
function Preview() {
  const [request, setRequest] = useState<ThemePreviewRequest|null>(null)
  const latest=useRef<{draftId:string;revision:number}|null>(null)
  const seen=useRef(new Set<string>())
  useEffect(()=>{
    const receive = (event: MessageEvent<unknown>) => {
      if (window.parent === window || event.source !== window.parent || event.origin !== location.origin || !isThemePreviewRequest(event.data) || event.data.channel !== channel) return
      if(seen.current.has(event.data.requestId) || latest.current && (latest.current.draftId!==event.data.draftId || latest.current.revision>event.data.revision))return
      latest.current={draftId:event.data.draftId,revision:event.data.revision};seen.current.add(event.data.requestId)
      if(seen.current.size>64)seen.current.delete(seen.current.values().next().value!)
      setRequest(event.data)
    }
    window.addEventListener('message', receive)
    return ()=>window.removeEventListener('message', receive)
  },[])
  useEffect(()=>{
    if (!request) return
    const controller = new AbortController()
    const root = document.documentElement
    const resolved = resolveTheme(request.theme, request.mode, {packageAvailability:request.availability})
    root.removeAttribute('style')
    root.dataset.theme = request.mode
    if (resolved.skin === 'paper') delete root.dataset.skin; else root.dataset.skin = resolved.skin
    root.dataset.previewMotion = request.reducedMotion ? 'reduce' : 'normal'
    root.dataset.themeRecipes = (['button','input'] as const).filter(part=>resolved.recipes?.[part]?.radius !== undefined).join(' ')
    for (const [key,value] of Object.entries(resolved.values)) root.style.setProperty(`--${key}`,value)
    root.style.setProperty('--preview-window-gap',`${resolved.shellConfig?.windowGap ?? DEFAULT_WIN98_WINDOW_GAP}px`)
    const resources=connectThemePreviewResources(request,window.parent,location.origin,controller.signal)
    const lease = acquireThemeFonts(document, resolved.effectiveFonts, {signal:controller.signal,timeoutMs:7000,localResources:resources.read})
    void lease.ready.then(async resource=>{
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
      if (controller.signal.aborted) return
      const fixture = document.querySelector<HTMLElement>('[data-preview-fixture]')
      if (!fixture) return
      const contentWidth = Math.max(fixture.scrollWidth,document.documentElement.scrollWidth)
      const response: ThemePreviewResponse = {protocol:THEME_PREVIEW_PROTOCOL,type:'report',channel:request.channel,draftId:request.draftId,revision:request.revision,requestId:request.requestId,packageGeneration:request.packageGeneration,report:{draftId:request.draftId,revision:request.revision,requestId:request.requestId,mode:request.mode,width:request.width,ready:resource.ready&&resolved.availability.status==='available',...(!resource.ready||resolved.availability.status!=='available'?{reason:resolved.availability.reason??'字体资源不可用；预览正使用系统后备，尚不能应用此版本'}:{}),resources:resource.fonts,geometry:{viewport:window.innerWidth,contentWidth,overflow:contentWidth>window.innerWidth+1,sampleCount:fixture.querySelectorAll('[data-preview-sample]').length},limits:['仅校验主题schema、资源与本夹具横向几何','对比度与审美：unknown','第三方应用内部和所有交互状态：unknown']}}
      window.parent.postMessage(response,location.origin)
    })
    return ()=>{controller.abort();resources.release();lease.release()}
  },[request])
  return request ? <Presenter request={request}/> : <p className="preview-waiting">等待主题草稿连接…</p>
}
createRoot(document.getElementById('root')!).render(<ConfigProvider enableCustomFonts={false} motion={motion}><Preview/></ConfigProvider>)
