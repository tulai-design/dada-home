import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {Button,Modal,Text} from '@lobehub/ui'
import {Group} from './ios'
import {getThemePackageGeneration,subscribeThemePackages,listThemePackages,parseThemePackage,installThemePackage,setThemePackageEnabled,activateThemePackage,getThemePackageDependents,uninstallThemePackage,exportThemePackage} from '../lib/themePackages'
import {PACKAGE_LIMITS,type ThemePackageImport,type ThemePackageSummary} from '../lib/themePackages/contracts'
import '../theme-packages.css'

const explain=(error:unknown)=>error instanceof Error?error.message:String(error)
const size=(bytes:number)=>bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(bytes<10240?1:0)} KiB`
export function downloadThemePackage(text:string,name:string) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`${name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g,'-')}.dada-theme.json`;anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
/** 文件导入与本机安装分开；任何启用/选择均调用同一个领域事务。 */
export function ThemePackageSettings() {
  useSyncExternalStore(subscribeThemePackages,getThemePackageGeneration,getThemePackageGeneration)
  const packages=listThemePackages()
  const file=useRef<HTMLInputElement>(null)
  const controller=useRef<AbortController|null>(null)
  const [pending,setPending]=useState<ThemePackageImport|null>(null)
  const [removing,setRemoving]=useState<ThemePackageSummary|null>(null)
  const [busy,setBusy]=useState('')
  const [canStop,setCanStop]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>()=>controller.current?.abort(),[])
  const run=async (label:string,operation:(signal:AbortSignal)=>Promise<unknown>,success?:string,cancellable=false)=>{
    if(controller.current)return
    const abort=new AbortController();controller.current=abort;setBusy(label);setCanStop(cancellable);setError('');setNotice('')
    try{await operation(abort.signal);if(success)setNotice(success)}catch(error){setError(explain(error))}finally{controller.current=null;setBusy('');setCanStop(false)}
  }
  const selectFile=async (selected?:File)=>{
    if(!selected)return
    await run('正在验证主题包',async signal=>{
      if(selected.size>PACKAGE_LIMITS.file)throw new Error('主题包文件不能超过6MiB')
      const parsed=await parseThemePackage(await selected.text());if(signal.aborted)throw new DOMException('主题包验证已停止','AbortError');setPending(parsed)
    },undefined,true)
  }
  const dependents=removing?getThemePackageDependents(removing):[]
  return <Group title={`本地主题包 · ${packages.length} 个`} footer="只接受本地声明式JSON与包内字体，不执行代码。包安装在本机；同步只保留设计引用，其他设备需导入同一文件。">
    <div className="theme-packages" aria-label="本地主题包">
      <div className="theme-package-actions"><Button disabled={!!busy} onClick={()=>file.current?.click()}>导入主题包</Button><small>安装后默认停用，不改变当前主题</small></div>
      <input ref={file} type="file" accept="application/json,.json" aria-label="主题包文件" hidden onChange={event=>{const selected=event.currentTarget.files?.[0];event.currentTarget.value='';void selectFile(selected)}}/>
      {!packages.length&&<p className="theme-package-muted">还没有安装主题包。导入 .dada-theme.json 后，可单独启用并选择其中的设计。</p>}
      {packages.map(item=><article className="theme-package-card" key={`${item.packageId}@${item.version}`} data-theme-package={item.packageId}>
        <header><strong>{item.name}</strong><span>{item.state==='unsupported'?'当前版本不支持':item.enabled?'已启用':'已停用'}</span></header>
        <p>{item.description}</p><small>{item.packageId} · v{item.version} · {size(item.bytes)} · 摘要 {item.digest.slice(0,12)}</small>
        <div className="theme-package-actions"><Button size="small" disabled={!!busy||item.state==='unsupported'} onClick={()=>void run(item.enabled?'正在停用':'正在准备资源',signal=>setThemePackageEnabled(item,!item.enabled,{signal}),item.enabled?'主题包已停用，设计引用保留':'主题包已启用；可选择下面的主题',!item.enabled)}>{item.enabled?'停用主题包':'启用主题包'}</Button><Button size="small" disabled={!!busy} onClick={()=>void run('正在导出',async()=>downloadThemePackage(await exportThemePackage(item),`${item.packageId}-${item.version}`))}>导出原包</Button><Button size="small" disabled={!!busy} onClick={()=>{setError('');setRemoving(item)}}>卸载主题包</Button></div>
        {item.themes.map(theme=><div className="theme-package-contribution" key={theme.id}><div><strong>{theme.name}</strong><small>{theme.skin} / {theme.shell}</small></div><Button size="small" disabled={!!busy||!item.enabled||item.state==='unsupported'} onClick={()=>void run('正在准备主题',signal=>activateThemePackage(item,theme.id,{signal}),`已使用「${theme.name}」`,true)}>使用此主题</Button></div>)}
      </article>)}
      {busy&&<p role="status">{busy}… {canStop&&<Button size="small" onClick={()=>controller.current?.abort()}>停止</Button>}</p>}
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="theme-package-error">{error}</p>}
    </div>
    <Modal open={!!pending} title="安装本地主题包" okText="安装，保持停用" cancelText="取消" confirmLoading={!!busy} onCancel={()=>{if(!busy)setPending(null)}} onOk={()=>{if(pending)void run('正在安装',async()=>{await installThemePackage(pending);setPending(null)},'安装完成，当前主题未改变。启用主题包后再选择设计。')}}>
      {pending&&<div className="theme-package-summary"><strong>{pending.manifest.name}</strong><p>{pending.manifest.description}</p><p>{pending.manifest.packageId} · v{pending.manifest.version}</p><p>摘要 {pending.manifest.digest}</p><p>{pending.manifest.contributions.length} 个主题 · {pending.resources.length} 个本地字体 · {size(pending.resources.reduce((sum,item)=>sum+item.bytes.byteLength,0))}</p><Text>文件摘要用于内容校验，不是作者身份或安全签名。安装只保存到本机，不会自动启用，也不会随配置同步字体。</Text>{pending.unsupportedEnvelope&&<p>当前版本不支持此类型，仅保存元数据供导出或卸载，不能启用。</p>}</div>}
      {error&&<p role="alert">{error}</p>}
    </Modal>
    <Modal open={!!removing} title="卸载主题包" okText="卸载" cancelText="取消" okButtonProps={{disabled:dependents.length>0}} confirmLoading={!!busy} onCancel={()=>{if(!busy)setRemoving(null)}} onOk={()=>{if(removing)void run('正在卸载',async()=>{await uninstallThemePackage(removing);setRemoving(null)},'主题包已卸载')}}>
      {dependents.length?<><p>以下设计仍引用此包，请先改用或删除这些主题与模板，取消或移除作者草稿中的引用，再卸载。</p><ul>{dependents.map(item=><li key={`${item.kind}-${item.id}`}>{item.kind==='theme'?'主题':item.kind==='draft'?'作者草稿':'模板'}：{item.name}</li>)}</ul></>:<p>卸载「{removing?.name}」及其本地字体？</p>}{error&&<p role="alert">{error}</p>}
    </Modal>
  </Group>
}
