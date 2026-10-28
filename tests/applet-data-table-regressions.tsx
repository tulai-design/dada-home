import {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'
import {UiTree, useContainerWidth, type UiNode} from '../src/lib/applet/render'
import {buildRunnerDoc} from '../src/lib/applet/runner'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'
import '../src/life.css'

// No workspace or storage modules: all runner records and saved snapshots stay in memory.
const columns=[{key:'name',label:'项目',priority:1},{key:'amount',label:'金额',type:'number',priority:2},{key:'category',label:'分类',priority:3},{key:'note',label:'备注',priority:3},{key:'active',label:'有效',priority:3}]
const amounts=[10,2,2,null,0,-4,11,3,8,1,4,20]
const rows=amounts.map((amount,index)=>({id:`row-${index+1}`,values:{name:`项目${String(index+1).padStart(2,'0')}`,amount,category:index%2?'生活':'工作',note:index===2?'隐藏关键词 Needle 特别说明':'备注'+(index+1),active:index!==0}}))
const source=`
const columns=${JSON.stringify(columns)};
const baseRows=${JSON.stringify(rows)};
const reset=(s,mode)=>{
 s.mode=mode;s.table={query:'',sort:null,page:0,pageSize:5,selectedIds:[]};
 s.rows=JSON.parse(JSON.stringify(baseRows));
 if(mode==='unicode'){s.rows[0].id=String.fromCharCode(0xd800);s.rows[0].values.name='特殊标识记录'};
 if(mode==='empty')s.rows=[];
 if(mode==='invalid')s.rows[0].values.amount='不是数字';
 if(mode==='excessive')s.rows=Array.from({length:501},(_,i)=>({id:'extra-'+i,values:{name:'超量'+i,amount:i,category:'工作',note:'',active:true}}));
 if(mode==='long')s.rows[0].values={name:'长标题'+ 'VeryLongUnbrokenText'.repeat(12),amount:123456789.125,category:'长分类名称'.repeat(12),note:'完整备注'.repeat(40)+'末尾标记',active:false};
};
applet({
 state:{rows:baseRows,table:{query:'',sort:null,page:0,pageSize:5,selectedIds:[]},note:'',mode:'base',initCount:0},persist:['rows','note'],
 async init(s,ctx){s.initCount++;reset(s,ctx.settings.mode||'base');await ctx.fetch('https://data-table-probe.invalid/data')},
 onSettingsChange(s,ctx){reset(s,ctx.settings.mode||'base')},
 view:(s)=>ui.Stack({gap:16},[
  ui.Input({value:s.note,placeholder:'保留输入',onChange:v=>{s.note=v}}),
  ui.DataTable({title:'记录回归',columns,rows:s.rows,state:s.table,selectable:true,onChange:patch=>{Object.assign(s.table,patch)}}),
  ui.Button({label:'删除已选记录',disabled:!s.table.selectedIds.length,onClick:()=>{const ids=new Set(s.table.selectedIds);s.rows=s.rows.filter(row=>!ids.has(row.id));s.table.selectedIds=[]}}),
  ui.Text({text:'初始化 '+s.initCount}),
 ])
})`
let initCount=0,fetchCount=0,saveCount=0,echoDelay=0
let snapshot:Record<string,unknown>={}
const patches:unknown[]=[],errors:string[]=[]
let sendExternal:(value:Record<string,unknown>)=>void=()=>{}
function findTable(tree:UiNode):UiNode|undefined{return tree.t==='DataTable'?tree:tree.c.map(findTable).find(Boolean)}
function Runtime({dark,mode,nonce}:{dark:boolean;mode:string;nonce:number}){
 const {ref,width}=useContainerWidth(),frame=useRef<HTMLIFrameElement>(null)
 const viewport=useRef({width,compact:width<480});viewport.current={width,compact:width<480}
 const context=useRef({dark,settings:{mode,nonce}});context.current={dark,settings:{mode,nonce}}
 const [tree,setTree]=useState<UiNode|null>(null),doc=useMemo(()=>buildRunnerDoc(source),[])
 const post=(message:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({applet:1,session:'',...message},'*')
 useEffect(()=>{
  const timers=new Set<ReturnType<typeof setTimeout>>()
  sendExternal=post
  const receive=(event:MessageEvent)=>{
   if(event.source!==frame.current?.contentWindow||event.data?.applet!==1)return
   const message=event.data
   if(message.k==='ready'){initCount++;post({k:'init',saved:{},dark:context.current.dark,settings:context.current.settings,surface:'widget',viewport:viewport.current})}
   if(message.k==='view'){
    const table=findTable(message.tree);snapshot=table?.p??{}
    if(echoDelay){const timer=setTimeout(()=>{timers.delete(timer);setTree(message.tree)},echoDelay);timers.add(timer)}else setTree(message.tree)
   }
   if(message.k==='save'){saveCount++;post({k:'save-reply',id:message.id})}
   if(message.k==='call'){if(message.op==='fetch')fetchCount++;post({k:'reply',id:message.id,result:{ok:true,status:200,text:'{}',json:{}}})}
   if(message.k==='error')errors.push(message.message)
  }
  window.addEventListener('message',receive)
  return()=>{window.removeEventListener('message',receive);timers.forEach(clearTimeout)}
 },[])
 useEffect(()=>{post({k:'viewport',viewport:viewport.current})},[width])
 useEffect(()=>{post({k:'dark',dark})},[dark])
 useEffect(()=>{post({k:'context',settings:{mode,nonce},surface:'widget'})},[mode,nonce])
 return <div ref={ref} className="applet" id="table-host"><iframe ref={frame} title="数据管理逻辑回归" className="applet-runner" sandbox="allow-scripts" srcDoc={doc}/>{tree&&<UiTree node={tree} fire={(fn,payload)=>{if(payload&&typeof payload==='object')patches.push(payload);post({k:'event',fn,payload})}}/>}</div>
}
const echoPatches:unknown[]=[]
function EchoProbe(){
 const [state,setState]=useState({query:''})
 useEffect(()=>{Object.assign(window,{__dataTableEcho:{render:(query:string)=>setState({query}),patches:()=>echoPatches}})},[])
 return <ConfigProvider motion={motion}><div id="echo-host" className="applet" style={{width:600,maxWidth:'100%',padding:16}}><UiTree node={{t:'DataTable',p:{title:'受控回声验证',columns:[{key:'name',label:'项目'}],rows:[{id:'a',values:{name:'a'}}],state,onChange:{$fn:1}},c:[]}} fire={(_fn,patch)=>echoPatches.push(patch)}/></div></ConfigProvider>
}
function Fixture(){
 const [mode,setMode]=useState(new URLSearchParams(location.search).get('initial')==='invalid'?'invalid':'base'),[nonce,setNonce]=useState(0),[dark,setDark]=useState(false),[width,setWidth]=useState<number|null>(null)
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light'},[dark])
 return <ConfigProvider motion={motion}><main style={{padding:16,maxWidth:1100,margin:'0 auto',color:'var(--text)',background:'var(--bg)',fontFamily:'var(--font-sans)'}}>
  <header style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:24}}>
   {['base','empty','invalid','excessive','long','unicode'].map(key=><Button key={key} id={'case-'+key} onClick={()=>{setMode(key);setNonce(v=>v+1)}}>{key}</Button>)}
   <Button id="theme" onClick={()=>setDark(!dark)}>切换主题</Button>
   {[280,360,600].map(value=><Button key={value} id={'width-'+value} onClick={()=>setWidth(value)}>{value}px</Button>)}
   <Button id="width-auto" onClick={()=>setWidth(null)}>自动宽度</Button>
  </header>
  <div id="table-container" style={{width:width??'100%',maxWidth:'100%',minWidth:0}}><Runtime dark={dark} mode={mode} nonce={nonce}/></div>
  <div id="old-table" style={{marginTop:24}}><UiTree node={{t:'Table',p:{columns:['旧列','值'],rows:[['零',0],['文字','保持']]},c:[]}} fire={()=>{}}/></div>
 </main></ConfigProvider>
}
Object.assign(window,{__dataTableFixture:{stats:()=>({init:initCount,fetch:fetchCount,saves:saveCount,errors,patches,snapshot}),setEchoDelay:(delay:number)=>{echoDelay=delay},context:(settings:Record<string,unknown>)=>sendExternal({k:'context',settings,surface:'widget'})}})
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('echo')?<EchoProbe/>:<Fixture/>)
