import {isThemePreviewResourceResponse,sameThemeFontResource,THEME_PREVIEW_PROTOCOL,THEME_PREVIEW_RESOURCE_TOTAL_BYTES,type ThemePreviewReport,type ThemePreviewRequest,type ThemePreviewResourceRequest} from './previewProtocol'
import type {LocalThemeFontRef,LocalThemeResourceReader} from '../themePackages/contracts'

export type ThemePreviewInspection = {draftId: string; revision: number; signal?: AbortSignal}
type Inspector = (request: ThemePreviewInspection) => Promise<ThemePreviewReport>
let inspector: Inspector | undefined
/** 单个可见作者舞台；模块只管理连接，不启动业务、存储或 iframe。 */
export function registerThemePreviewInspector(next: Inspector): () => void {
  inspector = next
  return () => {if (inspector === next) inspector = undefined}
}
export async function inspectThemeDraftPreview(request: ThemePreviewInspection): Promise<ThemePreviewReport> {
  if (request.signal?.aborted) throw new DOMException('主题预览检查已停止','AbortError')
  if (!inspector) throw new Error('主题预览暂不可用：作者面板尚未连接')
  return inspector(request)
}

/** 独立预览只通过精确会话读取字体，不访问父文档存储或资源 URL。 */
export function connectThemePreviewResources(request:ThemePreviewRequest, target:Window, origin:string, signal:AbortSignal) {
  const waiting=new Map<string,{resolve:(bytes:ArrayBuffer)=>void;reject:(error:Error)=>void;cleanup:()=>void;ref:LocalThemeFontRef}>()
  const allowed=(request.theme.fonts??[]).flatMap(font=>font.resource?[font.resource]:[])
  let total=0,count=0
  const abortError=()=>new DOMException('预览资源读取已停止','AbortError')
  const receive=(event:MessageEvent<unknown>)=>{
    if(event.source!==target || event.origin!==origin || !isThemePreviewResourceResponse(event.data))return
    const response=event.data,item=waiting.get(response.resourceRequestId)
    if(!item || response.channel!==request.channel || response.draftId!==request.draftId || response.revision!==request.revision || response.requestId!==request.requestId || response.packageGeneration!==request.packageGeneration || !sameThemeFontResource(response.ref,item.ref))return
    item.cleanup()
    if(response.error!==undefined){item.reject(new Error(response.error));return}
    total+=response.bytes.byteLength
    if(total>THEME_PREVIEW_RESOURCE_TOTAL_BYTES){item.reject(new Error('预览资源总大小超过4MiB'));return}
    item.resolve(response.bytes)
  }
  const stop=()=>{window.removeEventListener('message',receive);for(const item of [...waiting.values()]){item.cleanup();item.reject(abortError())}}
  window.addEventListener('message',receive);signal.addEventListener('abort',stop,{once:true})
  const read:LocalThemeResourceReader=(ref,readSignal)=>new Promise((resolve,reject)=>{
    if(signal.aborted||readSignal?.aborted){reject(abortError());return}
    if(!allowed.some(item=>sameThemeFontResource(item,ref))){reject(new Error('此字体不在当前草稿资源声明中'));return}
    if(waiting.size>=4 || count>=4){reject(new Error('预览资源请求超过4项'));return}
    count++
    const resourceRequestId=crypto.randomUUID()
    const cancel=()=>{cleanup();reject(abortError())}
    const timer=setTimeout(()=>{cleanup();reject(new Error('预览本地资源读取超时'))},7000)
    const cleanup=()=>{clearTimeout(timer);waiting.delete(resourceRequestId);readSignal?.removeEventListener('abort',cancel)}
    waiting.set(resourceRequestId,{resolve,reject,cleanup,ref})
    readSignal?.addEventListener('abort',cancel,{once:true})
    const message:ThemePreviewResourceRequest={protocol:THEME_PREVIEW_PROTOCOL,type:'resource-request',channel:request.channel,draftId:request.draftId,revision:request.revision,requestId:request.requestId,packageGeneration:request.packageGeneration,resourceRequestId,ref}
    target.postMessage(message,origin)
  })
  return {read,release:()=>{signal.removeEventListener('abort',stop);stop()}}
}

/** 异步读取前后都核对即时会话；不等待 React effect 才使旧草稿授权失效。 */
export async function readThemePreviewResource(ref:LocalThemeFontRef, options:{read:LocalThemeResourceReader;signal:AbortSignal;current:()=>boolean}):Promise<ArrayBuffer|undefined> {
  if(options.signal.aborted || !options.current())return undefined
  const bytes=await options.read(ref,options.signal)
  if(options.signal.aborted || !options.current())return undefined
  return bytes.slice(0) // transfer 只交出副本，不转移安装仓缓存所有权。
}
