import {createRoot} from 'react-dom/client'
import {getDefinition, type ComponentHost} from '../src/lib/registry'
import '../src/widgets/app'

// 本页只挂真实 AppBlock；不用 App、工作空间 store、AI、持久化或网络取数。
const style=document.createElement('style')
style.textContent=`:root{--bg:#f4f0e6;--bg2:#ebe5d8;--bg3:#ddd5c4;--text:#1c1815;--text2:#5a5248;--text3:#8d8478;--text4:#cbc2b2;--border:rgba(28,24,21,.08);--rule:#1c1815;--main:#e5372e;--radius:8px;--radius-lg:12px;--c-red:#e5372e;--font-sans:system-ui,sans-serif;--font-serif:Georgia,serif;--font-mono:monospace}body{margin:16px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}#results{white-space:pre-wrap}#fixture{width:800px;max-width:none;border:1px solid var(--border)}.app-frame{display:block;width:100%;border:0}`
document.head.append(style)
document.documentElement.dataset.theme='light'
const output=document.querySelector<HTMLPreElement>('#results')!
const fixture=document.querySelector<HTMLDivElement>('#fixture')!
const results:string[]=[]
let failures=0
function assert(value:unknown,message='断言失败'):asserts value{if(!value)throw new Error(message)}
async function test(name:string,run:()=>void|Promise<void>){try{await run();results.push(`通过：${name}`)}catch(error){failures+=1;results.push(`失败：${name} — ${String(error)}`)}output.textContent=results.join('\n')}

type Metrics={token:string;counter:number;dark:boolean;theme:string;bg:string;text:string;colorScheme:string;radius:string;radiusLg:string;rule:string;red:string;width:number;scrollWidth:number;rowFits:boolean;gridFits:boolean;columns:number;tableFits:boolean;tableScrollable:boolean;mediaFits:boolean;cardTopBorder:string;primaryBg:string;primaryText:string;themeEvents:number}
const pending=new Map<number,(metrics:Metrics)=>void>()
let seq=0,boots=0
let lastMetrics:Metrics|undefined
let bootResolve:((metrics:Metrics)=>void)|undefined
window.addEventListener('message',(event)=>{
  const frame=fixture.querySelector('iframe')
  if(event.source!==frame?.contentWindow||event.data?.qa!==1)return
  const message=event.data as {qa:1;op:string;id?:number;metrics:Metrics}
  lastMetrics=message.metrics
  if(message.op==='boot'){boots+=1;bootResolve?.(message.metrics)}
  if(message.id!==undefined){pending.get(message.id)?.(message.metrics);pending.delete(message.id)}
})
const ready=new Promise<Metrics>((resolve)=>{bootResolve=resolve})
const code=String.raw`
let counter=1,themeEvents=0;
const token=Math.random().toString(36).slice(2);
const metrics=()=>{
  const root=document.documentElement,style=getComputedStyle(root),width=innerWidth;
  const fits=(selector)=>[...document.querySelectorAll(selector)].every(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=width+1});
  const children=[...document.querySelector('.grid').children];
  const firstTop=children[0].getBoundingClientRect().top;
  const table=document.querySelector('.table-wrap');
  return {token,counter,dark:tada.dark,theme:root.dataset.theme,bg:style.getPropertyValue('--bg').trim(),text:style.getPropertyValue('--text').trim(),colorScheme:style.colorScheme,radius:style.getPropertyValue('--radius').trim(),radiusLg:style.getPropertyValue('--radius-lg').trim(),rule:style.getPropertyValue('--rule').trim(),red:style.getPropertyValue('--c-red').trim(),width,scrollWidth:root.scrollWidth,rowFits:fits('.row,.row>*'),gridFits:fits('.grid,.grid>*'),columns:children.filter(el=>Math.abs(el.getBoundingClientRect().top-firstTop)<2).length,tableFits:fits('.table-wrap'),tableScrollable:table.scrollWidth>table.clientWidth,mediaFits:fits('canvas,video,svg'),cardTopBorder:getComputedStyle(document.querySelector('.card')).borderTopWidth,primaryBg:getComputedStyle(document.querySelector('.primary')).backgroundColor,primaryText:getComputedStyle(document.querySelector('.primary')).color,themeEvents};
};
const report=(op,id)=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({qa:1,op,id,metrics:metrics()},'*')));
addEventListener('tada:themechange',()=>{themeEvents++;document.querySelector('#mode').textContent=tada.dark?'深色':'浅色'});
addEventListener('message',event=>{if(event.source!==parent||event.data?.qa!==1)return;const m=event.data;if(m.op==='increment')counter++;report('metrics',m.id)});
document.querySelector('#mode').textContent=tada.dark?'深色':'浅色';
report('boot');
`
const config={
  html:`<section class="card"><span class="kicker">HTML TOOL</span><h2>响应式应用</h2><p id="mode">浅色</p></section><div class="row"><label>数值<input value="123.45" /></label><label>单位<select><option>人民币</option></select></label><button class="btn primary">换算</button></div><div class="grid"><section class="card">第一项内容</section><section class="card">第二项内容</section><section class="card">第三项内容</section></div><div class="table-wrap"><table style="min-width:720px"><tr><td>宽表格滚动一</td><td>宽表格滚动二</td><td>宽表格滚动三</td></tr></table></div><canvas width="1200" height="50"></canvas><video width="1200" height="50"></video><svg width="1200" height="30" viewBox="0 0 1200 30"><rect width="1200" height="30" fill="currentColor"/></svg>`,
  css:'',js:code,height:640,settings:{label:'仅内存'},surface:'widget',
}
const host={networkGrants:[],proxy:'',ask(){},requestNetworkGrant:async()=>false} as unknown as ComponentHost
const definition=getDefinition('app')!
const View=definition.component
const root=createRoot(fixture)
root.render(<View instance={{id:'html-runtime-fixture',type:'app',title:'HTML运行时验证',config}} config={config} host={host} updateConfig={()=>undefined}/>)
function within<T>(promise:Promise<T>,label:string):Promise<T>{return Promise.race([promise,new Promise<T>((_,reject)=>window.setTimeout(()=>reject(new Error(`${label} 超时`)),6000))])}
async function metrics(op='metrics'):Promise<Metrics>{const id=++seq;const result=new Promise<Metrics>((resolve)=>pending.set(id,resolve));fixture.querySelector('iframe')!.contentWindow!.postMessage({qa:1,op,id},'*');return within(result,'沙盒指标')}
const initial=await within(ready,'首次启动')
const initialFrame=fixture.querySelector('iframe')!
const initialSrcdoc=initialFrame.srcdoc
await test('真实 AppBlock 注入完整主题快照和纸张套件',()=>{
  assert(initial.bg==='#f4f0e6'&&initial.text==='#1c1815','初始背景与文字应继承宿主')
  assert(initial.radius==='8px'&&initial.radiusLg==='12px','缺少圆角变量')
  assert(initial.rule==='#1c1815'&&initial.red==='#e5372e','缺少规则线或错误语义色')
  assert(initial.cardTopBorder==='0px','默认卡片不应有顶部重线')
  assert(initial.primaryBg==='rgb(28, 24, 21)'&&initial.primaryText==='rgb(244, 240, 230)','主按钮应使用墨色与纸张色')
})
await test('同明暗模式改色、切换深色均热更新，不重建 iframe 或丢运行内存',async()=>{
  const incremented=await metrics('increment')
  assert(incremented.counter===2)
  document.documentElement.style.setProperty('--bg','#effaf8')
  const recolored=await metrics()
  assert(recolored.bg==='#effaf8','浅色模式内换色没有更新')
  assert(recolored.counter===2&&recolored.token===initial.token,'同模式改色重启了应用')
  document.documentElement.dataset.theme='dark'
  document.documentElement.style.setProperty('--bg','#102032')
  document.documentElement.style.setProperty('--text','#e5f1ff')
  const dark=await metrics()
  assert(dark.dark&&dark.theme==='dark'&&dark.colorScheme==='dark','深色SDK状态与CSS不同步')
  assert(dark.bg==='#102032'&&dark.text==='#e5f1ff','深色颜色未更新')
  assert(dark.counter===2&&dark.token===initial.token,'切换明暗重启了应用')
  assert(dark.themeEvents>=2,'应用未收到主题变更事件')
  assert(fixture.querySelector('iframe')===initialFrame&&initialFrame.srcdoc===initialSrcdoc&&boots===1,'主题更新替换了文档')
})
await test('兄弟 iframe 不能伪造父来源主题消息',async()=>{
  const before=await metrics()
  const sibling=document.createElement('iframe')
  sibling.hidden=true;sibling.sandbox.add('allow-scripts')
  const sent=new Promise<void>((resolve)=>{
    const confirm=(event:MessageEvent)=>{if(event.source===sibling.contentWindow&&event.data?.qaSibling===1){window.removeEventListener('message',confirm);resolve()}}
    window.addEventListener('message',confirm)
  })
  sibling.srcdoc=`<!doctype html><script>parent.frames[0].postMessage({tada:1,op:'theme',variables:{'--bg':'#ff00ff'},dark:false},'*');parent.postMessage({qaSibling:1},'*')</script>`
  document.body.append(sibling)
  await within(sent,'伪造来源检查')
  const after=await metrics()
  assert(after.bg===before.bg&&after.dark===before.dark,'非父来源改变了应用主题')
  sibling.remove()
})
for(const width of [320,390,800])await test(`真实${width}px画布下行列、媒体与表格不会撑破页面`,async()=>{
  fixture.style.width=`${width}px`
  const current=await metrics()
  assert(Math.abs(current.width-width)<2,'测试画布宽度未应用')
  assert(current.scrollWidth<=current.width+1,`页面横向溢出 ${current.scrollWidth}/${current.width}`)
  assert(current.rowFits&&current.gridFits&&current.tableFits&&current.mediaFits,'行列、表格或媒体超出画布')
  if(width<=390)assert(current.tableScrollable,'窄画布中宽表格应在自身容器滚动')
  if(width===800)assert(current.columns>=2,'宽画布应恢复多列网格')
  assert(current.token===initial.token&&current.counter===2,'响应式调整重启了应用')
})
root.unmount()
fixture.remove()
results.push(`\n${failures?'失败':'全部通过'}：${results.length-failures}/${results.length}`)
output.textContent=results.join('\n')
document.documentElement.dataset.result=failures?'failed':'passed'
document.documentElement.dataset.boots=String(boots)
if(lastMetrics)document.documentElement.dataset.lastCounter=String(lastMetrics.counter)
