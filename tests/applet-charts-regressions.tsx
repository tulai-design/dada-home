import {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'
import {UiTree, useContainerWidth, type UiNode} from '../src/lib/applet/render'
import {buildRunnerDoc} from '../src/lib/applet/runner'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'
import '../src/life.css'

// This fixture imports neither workspace nor storage. Runner persistence stays in memory.
const node = (t:string,p:Record<string,unknown>={},c:UiNode[]=[]):UiNode=>({t,p,c})
const labels = Array.from({length:12},(_,i)=>`10月${i+1}日`)
const cases:Record<string,Record<string,unknown>>={
  mixed:{title:'每日收支',unit:'元',labels,series:[{name:'收入',values:[0,12,null,18,24,10,22,9,null,28,30,42]},{name:'支出',values:[-5,-8,-6,null,-12,-9,-10,-8,-11,-15,0,-18]}]},
  single:{title:'单次记录',unit:'分钟',labels:['今天'],series:[{name:'专注',values:[25]}]},
  precision:{title:'微小正负值',labels:['A','B','C'],series:[{name:'精度',values:[-1e-100,0,1e-100]}]},
  subnormal:{title:'最小正负有限值',labels:['A','B','C'],series:[{name:'精度',values:[-Number.MIN_VALUE,0,Number.MIN_VALUE]}]},
  flat:{title:'稳定记录',labels:['一','二','三'],series:[{name:'零值',values:[0,0,0]}]},
  missing:{title:'缺失记录',labels:['一','二','三'],series:[{name:'尚未记录',values:[null,null,null]}]},
  empty:{title:'空记录',labels:[],series:[{name:'记录',values:[]}]},
  invalid:{title:'错误记录',labels:['一','二'],series:[{name:'记录',values:[1]}]},
  excessive:{title:'超量记录',labels:Array.from({length:121},(_,i)=>String(i)),series:[{name:'记录',values:Array.from({length:121},(_,i)=>i)}]},
  long:{title:'这是一份名称较长但需要完整阅读的收支趋势记录',unit:'元',labels:Array.from({length:12},(_,i)=>`2026年10月第${i+1}个记录日期完整名称`),series:Array.from({length:4},(_,i)=>({name:`第${i+1}组需要完整阅读的详细系列名称`,values:Array.from({length:12},(_,j)=>(j+1)*(i+1)*12500.125)}))},
}
let runtimeInit=0, runtimeFetch=0, runtimeSaves=0
const runtimeErrors:string[]=[]
const source=`applet({state:{initCount:0,note:''},persist:['note'],async init(s,ctx){s.initCount++;await ctx.fetch('https://chart-probe.invalid/data')},view:(s,ctx)=>ui.Stack({gap:12},[
ui.Text({text:'初始化 '+s.initCount}),ui.Input({value:s.note,placeholder:'保留输入',onChange:v=>{s.note=v}}),
ui.LineChart({title:'运行时趋势',labels:['一','二','三'],series:[{name:'计数',values:[0,3,1]}]})])})`
function Runtime({dark}:{dark:boolean}){
 const {ref,width}=useContainerWidth()
 const frame=useRef<HTMLIFrameElement>(null)
 const viewport=useRef({width,compact:width<480});viewport.current={width,compact:width<480}
 const currentDark=useRef(dark);currentDark.current=dark
 const [tree,setTree]=useState<UiNode|null>(null)
 const doc=useMemo(()=>buildRunnerDoc(source),[])
 const post=(message:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({applet:1,session:'',...message},'*')
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(event.source!==frame.current?.contentWindow||event.data?.applet!==1)return
   const message=event.data
   if(message.k==='ready'){runtimeInit++;post({k:'init',saved:{note:''},dark:currentDark.current,settings:{},surface:'widget',viewport:viewport.current})}
   if(message.k==='view')setTree(message.tree)
   if(message.k==='save'){runtimeSaves++;post({k:'save-reply',id:message.id})}
   if(message.k==='call'){if(message.op==='fetch')runtimeFetch++;post({k:'reply',id:message.id,result:{ok:true,status:200,text:'{}',json:{}}})}
   if(message.k==='error')runtimeErrors.push(message.message)
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)
 },[])
 useEffect(()=>{post({k:'viewport',viewport:viewport.current})},[width])
 useEffect(()=>{post({k:'dark',dark})},[dark])
 return <div ref={ref} className="applet" id="runtime"><iframe ref={frame} title="趋势逻辑回归" className="applet-runner" sandbox="allow-scripts" srcDoc={doc}/>{tree&&<UiTree node={tree} fire={(fn,payload)=>post({k:'event',fn,payload})}/>}</div>
}
function Fixture(){
 const [kind,setKind]=useState(new URLSearchParams(location.search).get('initial')==='invalid'?'invalid':'mixed'),[dark,setDark]=useState(false),[narrow,setNarrow]=useState(false)
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light'},[dark])
 return <ConfigProvider motion={motion}><main style={{padding:16,maxWidth:1100,margin:'0 auto',color:'var(--text)',background:'var(--bg)',fontFamily:'var(--font-sans)'}}>
  <header style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
   {Object.keys(cases).map(key=><button key={key} id={'case-'+key} onClick={()=>setKind(key)}>{key}</button>)}
   <button id="theme" onClick={()=>setDark(!dark)}>切换主题</button><button id="narrow" onClick={()=>setNarrow(!narrow)}>切换窄容器</button>
  </header>
  <div id="chart-host" className="applet" style={{width:narrow?280:'100%',maxWidth:'100%',minWidth:0}}><UiTree node={node('LineChart',cases[kind])} fire={()=>{}}/></div>
  <div id="bars"><UiTree node={node('Bars',{values:[0,2,4],labels:['甲','乙','丙'],highlight:1,height:80})} fire={()=>{}}/></div>
  <section style={{marginTop:24,width:narrow?280:'100%',maxWidth:'100%',minWidth:0}}><Runtime dark={dark}/></section>
 </main></ConfigProvider>
}
Object.assign(window,{__chartFixture:{stats:()=>({init:runtimeInit,fetch:runtimeFetch,saves:runtimeSaves,errors:runtimeErrors})}})
createRoot(document.getElementById('root')!).render(<Fixture/> )
