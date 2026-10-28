import {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'
import {UiTree, useContainerWidth, type UiNode} from '../src/lib/applet/render'
import {buildRunnerDoc} from '../src/lib/applet/runner'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/theme.css'
import '../src/life.css'

// Uses isolated runner messages and in-memory state; never imports the workspace or storage modules.
const node = (t: string, p: Record<string, unknown> = {}, c: UiNode[] = []): UiNode => ({t,p,c})
const text = (value: string) => node('Text',{text:value})
const fixture = node('Stack',{},[
  node('Stack',{width:900},[text('固定 900px 的旧布局会收进当前容器')]),
  node('Grid',{columns:3},Array.from({length:3},(_,i)=>node('Card',{title:`表单 ${i+1}`},[
    node('Grid',{columns:2},[node('Input',{value:'自适应输入'}),node('NumberInput',{value:2})]),
  ]))),
  node('Stack',{direction:'row'},[node('Stack',{width:240},[text('默认行内换行 A')]),node('Stack',{width:240},[text('默认行内换行 B')])]),
  node('Grid',{columns:4,responsive:false},Array.from({length:4},(_,i)=>node('Button',{label:String(i+1)}))),
  node('Table',{columns:Array.from({length:12},(_,i)=>`月份 ${i+1}`),rows:[Array.from({length:12},(_,i)=>`¥ ${(i+1)*1035}.50`)]}),
])
const fire = () => undefined
let latest: {count:number;initCount:number;settingsCount:number;minutes:number;viewport:{width:number;compact:boolean}} | undefined
let resizeRuntime = (_width:number) => {}
let runtimePost = (_message:Record<string,unknown>) => {}
const runnerErrors: string[] = []
const source = `applet({
  state:{count:0,initCount:0,settingsCount:0},persist:['count'],
  init(s){s.initCount++},
  async onSettingsChange(s,ctx,previous){await new Promise(r=>setTimeout(r,5));s.settingsCount++;},
  view:(s,ctx)=>ui.Text({text:JSON.stringify({...s,minutes:ctx.settings.minutes,viewport:ctx.viewport})})
})`
function Runtime() {
  const [width,setWidth] = useState(620)
  const {ref,width:contentWidth} = useContainerWidth()
  const frame = useRef<HTMLIFrameElement>(null)
  const viewport = useRef({width:contentWidth,compact:contentWidth<480})
  viewport.current = {width:contentWidth,compact:contentWidth<480}
  const [tree,setTree] = useState<UiNode|null>(null)
  const doc = useMemo(()=>buildRunnerDoc(source),[])
  const post = (message:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({applet:1,session:'',...message},'*')
  resizeRuntime = setWidth
  runtimePost = post
  useEffect(()=>{
    const receive = (event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow || event.data?.applet!==1)return
      const message = event.data
      if(message.k==='ready')post({k:'init',saved:{count:67},settings:{minutes:25},surface:'widget',viewport:viewport.current})
      if(message.k==='view'){latest=JSON.parse(message.tree.p.text);setTree(message.tree)}
      if(message.k==='save')post({k:'save-reply',id:message.id})
      if(message.k==='error')runnerErrors.push(message.message)
    }
    window.addEventListener('message',receive)
    return()=>window.removeEventListener('message',receive)
  },[])
  useEffect(()=>{post({k:'viewport',viewport:viewport.current})},[contentWidth])
  return <div style={{width,maxWidth:'100%'}}><div ref={ref} className="applet" id="runtime" style={{minWidth:0}}>
    <iframe ref={frame} title="隔离逻辑回归" className="applet-runner" sandbox="allow-scripts" srcDoc={doc}/>
    {tree&&<UiTree node={tree} fire={fire}/>}
  </div></div>
}
function App() {
  return <ConfigProvider motion={motion}><main style={{padding:16,maxWidth:1000,margin:'0 auto',color:'var(--text)',background:'var(--bg)',fontFamily:'var(--font-sans)'}}>
    <h1 style={{fontSize:24}}>应用响应式回归</h1>
    <p>320 / 390 / 760px：嵌套网格、固定宽度、换行、四列键盘、表格；运行时只使用内存。</p>
    <pre id="results" style={{whiteSpace:'pre-wrap'}}>运行中…</pre>
    <h2>容器宽度上下文与设置生命周期</h2><Runtime/>
    {[320,390,760].map(width=><section key={width} id={`fixture-${width}`} style={{width,maxWidth:'100%',margin:'28px 0',padding:0,border:'1px solid var(--border)'}}>
      <h2 style={{fontSize:18}}>{width}px</h2><div className="applet" style={{minWidth:0}}><UiTree node={fixture} fire={fire}/></div>
    </section>)}
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<App/> )
const results: string[] = []
let failures=0
function assert(value:unknown,message='断言失败'):asserts value {if(!value)throw new Error(message)}
async function until(predicate:()=>unknown) {
  const start=performance.now()
  while(!predicate()){assert(performance.now()-start<8000,'等待渲染超时');await new Promise(resolve=>setTimeout(resolve,20))}
}
async function test(name:string,run:()=>unknown|Promise<unknown>) {
  try{await run();results.push(`通过：${name}`)}catch(error){failures++;results.push(`失败：${name} — ${String(error)}`)}
  document.getElementById('results')!.textContent=results.join('\n')
}
await until(()=>document.querySelector('#fixture-760 .ap-grid')?.getAttribute('data-columns')==='3')
await test('320px与390px按自身宽度收列，嵌套Grid使用内部宽度',()=>{
  for(const [width,columns] of [[320,1],[390,2],[760,3]]){
    const fixture=document.getElementById(`fixture-${width}`)!
    const grids=fixture.querySelectorAll<HTMLElement>('.ap-grid')
    assert(grids[0].dataset.columns===String(columns),`${width}px外层列数 ${grids[0].dataset.columns}`)
    assert(grids[1].dataset.columns==='1',`${width}px嵌套Grid未收为1列`)
    assert(grids[grids.length-1].dataset.columns==='4','responsive:false应保留四列键盘')
  }
})
await test('固定宽度、Lobe输入和默认row换行不撑大320px容器',()=>{
  for(const width of [320,390]){
    const fixture=document.getElementById(`fixture-${width}`)!
    const root=fixture.querySelector<HTMLElement>('.applet')!
    assert(root.scrollWidth<=root.clientWidth+1,`${width}px外层发生横向溢出 ${root.scrollWidth}/${root.clientWidth}`)
    const fixed=root.querySelector<HTMLElement>('.ap-stack .ap-stack')!
    assert(fixed.getBoundingClientRect().width<=root.clientWidth+1,'固定900px宽度没有收缩')
    for(const input of root.querySelectorAll('input'))assert(input.getBoundingClientRect().right<=root.getBoundingClientRect().right+1,'输入框超出容器')
    const row=root.querySelector<HTMLElement>('.ap-stack > .ap-stack:nth-child(3)')!
    assert((row.children[1] as HTMLElement).offsetTop>(row.children[0] as HTMLElement).offsetTop,'row未自动换行')
  }
})
await test('12列宽表局部横滚，单元格仍可折行，整体容器不被撑大',()=>{
  const table=document.querySelector<HTMLElement>('#fixture-320 .ap-table-wrap')!
  assert(table.scrollWidth>table.clientWidth,'长单行表格没有局部滚动内容')
  table.scrollLeft=100
  assert(table.scrollLeft>0,'表格无法横向滚动')
})
await test('真实iframe resize保留persist且init只执行一次，ctx.viewport为可见内容宽度',async()=>{
  await until(()=>latest?.initCount===1)
  resizeRuntime(320)
  await until(()=>latest?.viewport.width===320)
  assert(latest!.count===67&&latest!.initCount===1&&latest!.viewport.compact,'resize丢失状态或重启')
  resizeRuntime(620)
  await until(()=>latest?.viewport.width===620)
  assert(!latest!.viewport.compact&&latest!.count===67&&latest!.initCount===1,'宽容器上下文错误')
})
await test('真实iframe用户设置更新仅调用设置hook，viewport变化不重复调用',async()=>{
  runtimePost({k:'context',settings:{minutes:30},surface:'widget'})
  await until(()=>latest?.settingsCount===1)
  resizeRuntime(390)
  await until(()=>latest?.viewport.width===390)
  assert(latest!.settingsCount===1&&latest!.initCount===1&&latest!.minutes===30,'设置生命周期计数错误')
  assert(!runnerErrors.length,runnerErrors.join('\n'))
})
document.getElementById('results')!.textContent=`${failures?'失败':'全部通过'}：${results.length-failures}/${results.length}\n\n${results.join('\n')}`
document.title=`${failures?'失败':'通过'} ${results.length-failures}/${results.length} · 应用响应式回归`
