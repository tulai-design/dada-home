import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Button, Input, Segmented, Select, TextArea} from '@lobehub/ui'
import {acquireThemeFonts} from '../lib/fonts'
import {getWorkspace, useWorkspace} from '../lib/workspaceStore'
import {listThemeFields, type ThemeField, type ThemeScope} from '../lib/themeAuthoring/catalog'
import {applyThemeDraft, describeThemeDraft, discardThemeDraft, getThemeDraft, registerThemeAuthoringPort, updateThemeDraft, useThemeDraft} from '../lib/themeAuthoring/store'
import {registerThemePreviewInspector, type ThemePreviewInspection} from '../lib/themeAuthoring/previewBridge'
import {isThemePreviewRequest, isThemePreviewResponse, THEME_PREVIEW_PROTOCOL, THEME_PREVIEW_WIDTHS, type ThemePreviewReport, type ThemePreviewRequest, type ThemePreviewWidth} from '../lib/themeAuthoring/previewProtocol'
import type {ThemeEntry} from '../lib/workspace'
import '../theme-authoring.css'

const scopeLabels: Record<ThemeScope,string> = {shared:'共享',light:'浅色',dark:'深色',both:'浅深同时',recipe:'控件',shell:'外壳',resource:'资源'}
const groupLabels: Record<ThemeField['group'],string> = {tokens:'颜色与布局',recipes:'控件造型',shell:'桌面外壳',resources:'字体资源'}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
function explicitValue(theme: ThemeEntry, field: ThemeField, scope: ThemeScope): unknown {
  if (scope === 'resource') return theme.fonts
  if (scope === 'shell') return theme.shellConfig?.[field.path as keyof NonNullable<ThemeEntry['shellConfig']>]
  if (scope === 'recipe') {const [part] = field.path.split('.') as ['button'|'input'];return theme.recipes?.[part]?.radius}
  return (scope === 'shared' ? theme.overrides : theme[scope === 'both' ? 'light' : scope])?.[field.path]
}
function FieldEditor({field, theme, onPatch}: {field:ThemeField;theme:ThemeEntry;onPatch:(field:ThemeField,scope:ThemeScope,value:unknown)=>void}) {
  const [scope,setScope] = useState<ThemeScope>(field.scopes.includes('both') ? 'both' : field.scopes[0])
  const current = explicitValue(theme,field,scope)
  const serialize = (value:unknown) => value === undefined ? '' : field.type === 'fonts' ? JSON.stringify(value,null,2) : field.options?.find(option=>(option.storedValue??option.value)===value)?.value ?? String(value).replace(field.type === 'length' ? /px$/ : /$^/,'')
  const [value,setValue] = useState(serialize(current))
  useEffect(()=>setValue(serialize(current)),[current,field.type]) // 当前草稿才是表单事实来源。
  const submit = () => {
    let next:unknown = value
    if ((field.type === 'number' || field.type === 'length') && value.trim()) next = Number(value)
    if (field.type === 'fonts') {try {next = JSON.parse(value)} catch {next = value}}
    onPatch(field,scope,next)
  }
  return <div className="theme-author-field" data-theme-field={field.path}>
    <label htmlFor={`author-${field.path}`}>{field.label}<small>{field.description}</small><small>{field.css ?? field.path}{field.min !== undefined ? ` · ${field.min}–${field.max}${field.type === 'length' || field.group === 'recipes' ? 'px' : ''}` : ''}</small></label>
    <div className="theme-author-field-controls">
      <label className="theme-author-sr-only" htmlFor={`author-scope-${field.path}`}>{field.label}作用域</label><Select id={`author-scope-${field.path}`} className="theme-author-scope" popupClassName="theme-author-select-popup" value={scope} onChange={value=>setScope(value as ThemeScope)} options={field.scopes.map(item=>({value:item,label:scopeLabels[item]}))}/>
      {field.type === 'fonts' ? <TextArea id={`author-${field.path}`} aria-label={field.label} value={value} onChange={event=>setValue(event.target.value)} autoSize={{minRows:2,maxRows:5}} placeholder={'[{"family":"Noto Serif SC","role":"serif"}]'}/> : field.options ? <Select id={`author-${field.path}`} popupClassName="theme-author-select-popup" value={value||undefined} placeholder="使用默认值" options={field.options.map(option=>({value:option.value,label:option.label}))} onChange={value=>setValue(String(value))}/> : <Input id={`author-${field.path}`} aria-label={field.label} value={value} onValueChange={setValue} placeholder="使用默认值" type={field.type === 'number' || field.type === 'length' ? 'number' : 'text'} min={field.min} max={field.max}/>}
      <Button size="small" onClick={submit}>修改</Button><Button size="small" onClick={()=>onPatch(field,scope,null)}>还原</Button>
    </div>
    {field.type === 'fonts' && <small>结构化字体 family/role 数组；输入 [] 明确使用系统字体，不请求网络。</small>}
  </div>
}
type Pending = {request:ThemePreviewRequest;promise:Promise<ThemePreviewReport>;resolve:(report:ThemePreviewReport)=>void;reject:(error:Error)=>void;cleanup:()=>void}
const stopped = () => new DOMException('主题预览检查已停止','AbortError')
function withAbort<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(stopped())
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(stopped())}
    signal.addEventListener('abort',abort,{once:true})
    void promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
  })
}
function DraftMetadata({draftId,revision,name,description,onError}:{draftId:string;revision:number;name:string;description:string;onError:(message:string)=>void}) {
  const [title,setTitle]=useState(name),[note,setNote]=useState(description)
  useEffect(()=>setTitle(name),[name]);useEffect(()=>setNote(description),[description])
  const save=(key:'name'|'description',value:string)=>{try{updateThemeDraft({draftId,expectedRevision:revision,[key]:value})}catch(error){onError(errorText(error))}}
  return <><label>方案名称<Input aria-label="主题草稿名称" value={title} maxLength={20} onValueChange={setTitle} onBlur={()=>{if(title!==name)save('name',title)}}/></label><label>说明<Input aria-label="主题草稿说明" value={note} maxLength={120} onValueChange={setNote} onBlur={()=>{if(note!==description)save('description',note)}}/></label></>
}
/** 稳定挂在宿主，Agent 创建草稿也自动展示；不依赖设置页挂载。 */
export default function ThemeAuthoringPanel() {
  useWorkspace() // 正式选择或源设计变化也应立即显示冲突。
  const draft = useThemeDraft()
  const draftRef = useRef(draft);draftRef.current = draft
  const iframe = useRef<HTMLIFrameElement>(null)
  const frameBox = useRef<HTMLDivElement>(null)
  const pending = useRef(new Map<string,Pending>())
  const [loadGeneration,setLoadGeneration] = useState(0)
  const loadedRef=useRef(false)
  const loadWaiters=useRef(new Set<{ready:()=>void;cancel:()=>void}>())
  const [channel] = useState(()=>crypto.randomUUID())
  const [mode,setMode] = useState<'light'|'dark'>(()=>getWorkspace().theme.mode)
  const [width,setWidth] = useState<ThemePreviewWidth>(390)
  const [scale,setScale] = useState(1)
  const [group,setGroup] = useState<ThemeField['group']>('tokens')
  const [report,setReport] = useState<ThemePreviewReport|null>(null)
  const reportRef=useRef(report);reportRef.current=report
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [collapsed,setCollapsed] = useState(false)
  const collapsedRef=useRef(false);collapsedRef.current=collapsed
  const controller = useRef<AbortController|null>(null)
  const panel=useRef<HTMLElement>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  const focusedDraft=useRef<string|null>(null)
  const src = new URL('theme-preview.html',document.baseURI);src.hash = new URLSearchParams({channel}).toString()
  const inspect = useCallback(async (input:ThemePreviewInspection):Promise<ThemePreviewReport>=>{
    if (collapsedRef.current) throw new Error('主题预览已收起，请展开作者面板后重试检查')
    if (!loadedRef.current) await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);loadWaiters.current.delete(waiter);input.signal?.removeEventListener('abort',cancel)}
      const ready=()=>{cleanup();resolve()}
      const cancel=()=>{cleanup();reject(stopped())}
      const waiter={ready,cancel}
      const timer=setTimeout(()=>{cleanup();reject(new Error('主题预览文档加载超时'))},10000)
      loadWaiters.current.add(waiter);input.signal?.addEventListener('abort',cancel,{once:true})
      if(input.signal?.aborted)cancel()
    })
    const current = getThemeDraft()
    if (!current || current.id !== input.draftId || current.revision !== input.revision) throw new Error('主题预览版本已过期')
    if (!iframe.current?.contentWindow) throw new Error('主题预览文档尚未就绪，请稍后重试')
    const existing=[...pending.current.values()].find(item=>item.request.draftId===current.id&&item.request.revision===current.revision&&item.request.mode===mode&&item.request.width===width)
    if (existing) return withAbort(existing.promise,input.signal)
    const request:ThemePreviewRequest = {protocol:THEME_PREVIEW_PROTOCOL,type:'render',channel,draftId:current.id,revision:current.revision,requestId:crypto.randomUUID(),theme:structuredClone(current.theme),mode,width,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}
    if (!isThemePreviewRequest(request)) throw new Error('主题预览请求不符合schema或超过64KiB')
    if (input.signal?.aborted) throw stopped()
    let resolveRequest!:(report:ThemePreviewReport)=>void,rejectRequest!:(error:Error)=>void
    const promise=new Promise<ThemePreviewReport>((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject})
    {
      const timer = setTimeout(()=>{pending.current.get(request.requestId)?.cleanup();rejectRequest(new Error('主题预览检查超时，当前版本不可用'))},10000)
      const cleanup = ()=>{clearTimeout(timer);pending.current.delete(request.requestId)}
      pending.current.set(request.requestId,{request,promise,resolve:resolveRequest,reject:rejectRequest,cleanup})
      iframe.current!.contentWindow!.postMessage(request,location.origin)
    }
    return withAbort(promise,input.signal)
  },[channel,mode,width])
  useEffect(()=>{
    const receive = (event:MessageEvent<unknown>)=>{
      if (event.source !== iframe.current?.contentWindow || event.origin !== location.origin || !isThemePreviewResponse(event.data) || event.data.channel !== channel) return
      const message=event.data,item=pending.current.get(message.requestId),current=draftRef.current
      if (!item || !current || message.draftId !== current.id || message.revision !== current.revision || message.report.mode !== item.request.mode || message.report.width !== item.request.width) return
      item.cleanup();reportRef.current=message.report;setReport(message.report);item.resolve(message.report)
    }
    window.addEventListener('message',receive)
    return ()=>window.removeEventListener('message',receive)
  },[channel])
  useEffect(()=>{
    const stopInspect=registerThemePreviewInspector(inspect)
    const stopPort=registerThemeAuthoringPort({getReadiness:request=>{
      const current=getThemeDraft(),checked=reportRef.current
      if(!current || current.id!==request.draftId || current.revision!==request.revision || collapsedRef.current)return {...request,status:'unavailable',reason:collapsedRef.current?'主题预览已收起':'当前草稿已变化'}
      if(!checked || checked.draftId!==current.id || checked.revision!==current.revision || checked.mode!==mode || checked.width!==width)return {...request,status:'pending'}
      return {...request,status:checked.ready?'ready':'error',...(!checked.ready?{reason:checked.reason}: {})}
    },prepare:async request=>{
      const checked=await inspect(request)
      if (!checked.ready) return {ready:false,reason:checked.reason}
      const lease=acquireThemeFonts(document,request.theme.fonts,{signal:request.signal,timeoutMs:7000})
      const resources=await lease.ready
      return {ready:resources.ready,reason:resources.ready?undefined:resources.fonts.filter(font=>font.status==='error').map(font=>`${font.family}：${font.reason}`).join('；'),release:lease.release}
    }})
    return ()=>{stopInspect();stopPort()}
  },[inspect,mode,width])
  useEffect(()=>{
    setCollapsed(false);collapsedRef.current=false
    setReport(null);setError('')
    for (const item of pending.current.values()) {item.cleanup();item.reject(new Error('草稿或预览配置已变化，旧回执无效'))}
    let active=true
    if (draft && loadedRef.current) void inspect({draftId:draft.id,revision:draft.revision}).catch(error=>{if(active)setError(errorText(error))})
    return ()=>{active=false}
  },[draft,inspect])
  useEffect(()=>{
    let active=true
    if(draft && loadGeneration>0)void inspect({draftId:draft.id,revision:draft.revision}).catch(error=>{if(active)setError(errorText(error))})
    return ()=>{active=false}
  },[loadGeneration,draft,inspect])
  useEffect(()=>{
    const box=frameBox.current
    if (!box) return
    const observer=new ResizeObserver(()=>setScale(Math.min(1,box.clientWidth/width)))
    observer.observe(box);setScale(Math.min(1,box.clientWidth/width))
    return ()=>observer.disconnect()
  },[draft?.id,width])
  useEffect(()=>()=>{
    controller.current?.abort()
    for (const waiter of loadWaiters.current) waiter.cancel()
    for (const item of pending.current.values()) {item.cleanup();item.reject(new Error('主题作者面板已关闭'))}
  },[])
  useEffect(()=>{if(!draft){loadedRef.current=false;setLoadGeneration(0);for(const waiter of loadWaiters.current)waiter.cancel()}},[draft])
  useLayoutEffect(()=>{
    if(draft && focusedDraft.current!==draft.id){
      focusedDraft.current=draft.id
      previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null
      if(previousFocus.current?.classList.contains('theme-author-entry'))panel.current?.querySelector<HTMLInputElement>('[aria-label="主题草稿名称"]')?.focus({preventScroll:true})
    }
    if(!draft || collapsed){
      const target=previousFocus.current
      if(target?.isConnected && target.getClientRects().length && !target.closest('[inert]'))target.focus({preventScroll:true})
      if(!draft){focusedDraft.current=null;previousFocus.current=null}
    }
  },[draft?.id,collapsed])
  if (!draft) return null
  const patch = (field:ThemeField,scope:ThemeScope,value:unknown)=>{
    try {updateThemeDraft({draftId:draft.id,expectedRevision:draft.revision,operations:[{path:field.path,scope,value}]})} catch(error){setError(errorText(error))}
  }
  const details=describeThemeDraft()
  const changed = details?.before ? Object.keys(details.after.light.values).filter(key=>details.before!.light.values[key]!==details.after.light.values[key] || details.before!.dark.values[key]!==details.after.dark.values[key]) : []
  return <>{collapsed && <Button className="theme-author-reopen" onClick={()=>{setCollapsed(false);requestAnimationFrame(()=>panel.current?.querySelector<HTMLInputElement>('[aria-label="主题草稿名称"]')?.focus({preventScroll:true}))}}>继续主题创作 · v{draft.revision}</Button>}<aside ref={panel} hidden={collapsed} inert={collapsed || undefined} className="theme-authoring" role="dialog" aria-label="主题作者" aria-modal="false" data-theme-draft={draft.id} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();setCollapsed(true)}}}>
    <header className="theme-author-header"><div><strong>主题作者</strong><small>内存草稿 · v{draft.revision} · {draft.theme.skin} / {draft.theme.shell}</small></div><Button size="small" onClick={()=>setCollapsed(true)}>收起预览</Button><Button size="small" disabled={busy} onClick={()=>{try{discardThemeDraft({draftId:draft.id,expectedRevision:draft.revision})}catch(error){setError(errorText(error))}}}>取消草稿</Button></header>
    <p className="theme-author-note">修改先留在草稿，点击应用才替换正式外观。刷新会丢弃草稿。</p>
    <div className="theme-author-layout"><div className="theme-author-editor">
      <DraftMetadata key={draft.id} draftId={draft.id} revision={draft.revision} name={draft.theme.name} description={draft.theme.description} onError={setError}/>
      <label className="theme-author-sr-only" htmlFor="theme-author-group">主题字段分组</label><Select id="theme-author-group" popupClassName="theme-author-select-popup" value={group} onChange={value=>setGroup(value as ThemeField['group'])} options={Object.entries(groupLabels).map(([value,label])=>({value,label}))}/>
      {listThemeFields(draft.theme,group).map(field=><FieldEditor key={`${draft.id}-${field.path}`} field={field} theme={draft.theme} onPatch={patch}/>)}
      {!listThemeFields(draft.theme,group).length && <p>当前外壳没有此组可编辑字段。</p>}
      <details><summary>设计变化 · {changed.length} 个有效变量</summary><pre>{JSON.stringify({variables:changed,recipes:draft.theme.recipes??{},shellConfig:draft.theme.shellConfig??{},fonts:draft.theme.fonts??'默认受控字体'},null,2)}</pre></details>
    </div><div className="theme-author-preview"><div className="theme-author-toolbar"><Segmented size="small" value={mode} onChange={value=>setMode(value as 'light'|'dark')} options={[{label:'浅色',value:'light'},{label:'深色',value:'dark'}]}/><label className="theme-author-sr-only" htmlFor="theme-author-width">预览宽度</label><Select id="theme-author-width" popupClassName="theme-author-select-popup" value={String(width)} onChange={value=>setWidth(Number(value) as ThemePreviewWidth)} options={THEME_PREVIEW_WIDTHS.map(value=>({value:String(value),label:`${value}px${value===480?' · 窄分栏':''}`}))}/><Button size="small" onClick={()=>void inspect({draftId:draft.id,revision:draft.revision}).catch(error=>setError(errorText(error)))}>重新检查</Button></div>
      <div className="theme-author-framebox" ref={frameBox} style={{height:900*scale}}><iframe key={draft.id} ref={iframe} title="隔离主题预览" src={src.href} sandbox="allow-scripts allow-same-origin" onLoad={()=>{for(const item of pending.current.values()){item.cleanup();item.reject(new Error('预览文档已重载'))}reportRef.current=null;setReport(null);loadedRef.current=true;setLoadGeneration(value=>value+1);for(const waiter of loadWaiters.current)waiter.ready()}} style={{width,height:900,transform:`scale(${scale})`,transformOrigin:'top left'}}/></div>
      <div className="theme-author-status" role="status">{report ? <><strong>{report.ready?'资源检查完成':'使用系统后备，资源尚未就绪'}</strong><p>{report.geometry.overflow?'夹具有横向溢出，请调整设计。':`当前夹具未发现横向溢出 · ${report.geometry.viewport}px`}</p>{report.resources.filter(font=>font.status==='error').map(font=><p key={font.family}>{font.family}：{font.reason}</p>)}<small>{report.limits.join('；')}</small></> : '等待当前版本预览…'}</div>
    </div></div>
    {(error || details?.conflict) && <p className="theme-author-error" role="alert">{error || details?.conflict}</p>}
    <footer className="theme-author-footer"><small>独立文档 · 固定脱敏样本 · 视觉效果请自行审阅</small>{busy && <Button onClick={()=>controller.current?.abort()}>停止应用</Button>}<Button type="primary" disabled={busy || !report?.ready || !!details?.conflict} loading={busy} onClick={()=>{const abort=new AbortController();controller.current=abort;setBusy(true);setError('');void applyThemeDraft({draftId:draft.id,expectedRevision:draft.revision},{signal:abort.signal}).catch(error=>setError(errorText(error))).finally(()=>{setBusy(false);controller.current=null})}}>应用此方案</Button></footer>
  </aside></>
}
