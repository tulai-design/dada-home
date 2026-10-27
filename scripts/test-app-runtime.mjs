import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实 buildSrcdoc 的 SDK；不加载应用存储，不发网络请求。
const hostVariables = {
  '--bg': '#f4f0e6', '--bg2': '#ebe5d8', '--bg3': '#ddd5c4',
  '--text': '#1c1815', '--text2': '#5a5248', '--text3': '#8d8478', '--text4': '#cbc2b2',
  '--border': 'rgba(28,24,21,.08)', '--main': '#e5372e', '--rule': '#1c1815',
  '--radius': '8px', '--radius-lg': '12px', '--c-red': '#e5372e',
}
const module = {exports: {}}
const source = readFileSync(new URL('../src/widgets/app.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
vm.runInNewContext(compiled, {
  module, exports:module.exports,
  require: id => id === '../lib/registry' ? {registerComponent(){}} : {},
  document:{documentElement:{}},
  getComputedStyle:()=>({getPropertyValue:name=>hostVariables[name]??''}),
})
const config = {html:'<div class="card">应用</div>',css:'',js:'',height:320,settings:{caption:'</script><script>escaped=true</script>'},surface:'widget'}
const doc = module.exports.buildSrcdoc(config,[],false)
const sdk = doc.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(sdk,'真实文档应包含SDK')
function runner() {
  const listeners=new Map(),posted=[],events=[]
  const variables={...hostVariables}
  const root={dataset:{theme:'light'},style:{colorScheme:'light',setProperty(name,value){variables[name]=String(value)},removeProperty(name){delete variables[name]}}}
  const parent={postMessage(message){posted.push(message)}}
  const scope={
    parent,document:{documentElement:root},navigator:{},setTimeout(){},
    addEventListener(name,fn){listeners.set(name,[...(listeners.get(name)??[]),fn])},
    dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)??[])fn(event);return true},
    CustomEvent:class {constructor(type,init){this.type=type;this.detail=init?.detail}},
  }
  scope.window=scope
  vm.runInNewContext(sdk,scope)
  const send=(message,source=parent)=>{for(const fn of listeners.get('message')??[])fn({data:message,source})}
  return {scope,root,variables,parent,posted,events,send}
}
let passed=0
async function test(name,run){await run();passed+=1;console.log(`通过：${name}`)}

await test('真实HTML文档快照包含圆角、规则线和错误语义色，设置不能逃逸脚本',()=>{
  for(const name of ['--radius','--radius-lg','--rule','--c-red'])assert.ok(doc.includes(`${name}:${hostVariables[name]}`),`缺少 ${name}`)
  const r=runner()
  assert.equal(r.scope.tada.settings.caption,config.settings.caption)
  assert.equal(Object.isFrozen(r.scope.tada.settings),true)
  assert.equal(r.scope.escaped,undefined)
  assert.match(doc,/connect-src 'none'/)
  assert.match(doc,/frame-src 'none'/)
})
await test('父窗口主题消息热更新颜色、模式与color-scheme，发送themechange且不丢应用内存',()=>{
  const r=runner()
  vm.runInNewContext('window.applicationCounter=7',r.scope)
  r.send({tada:1,op:'theme',variables:{'--bg':'#101820','--text':'#edf6ff','--radius':'14px'},dark:true})
  assert.equal(r.variables['--bg'],'#101820')
  assert.equal(r.variables['--text'],'#edf6ff')
  assert.equal(r.variables['--radius'],'14px')
  assert.equal(r.root.dataset.theme,'dark')
  assert.equal(r.root.style.colorScheme,'dark')
  assert.equal(r.scope.tada.dark,true)
  assert.equal(r.scope.applicationCounter,7)
  const event=r.events.find(event=>event.type==='tada:themechange')
  assert.equal(event?.detail.dark,true)
  r.send({tada:1,op:'theme',variables:{'--bg':'#132b31'},dark:true})
  assert.equal(r.variables['--bg'],'#132b31','同一明暗模式换色也应更新')
  assert.equal(r.scope.applicationCounter,7)
  r.send({tada:1,op:'theme',variables:{'--bg':'#f6fafb'},dark:false})
  assert.equal(r.scope.tada.dark,false)
  assert.equal(r.root.style.colorScheme,'light')
})
await test('非父来源不能修改主题或伪造RPC回复，真正父回复仍可完成原请求',async()=>{
  const r=runner()
  const original=r.variables['--bg']
  r.send({tada:1,op:'theme',variables:{'--bg':'#ff00ff'},dark:true},{})
  assert.equal(r.variables['--bg'],original)
  assert.equal(r.scope.tada.dark,false)
  let settled=false,result
  const request=r.scope.tada.store.get('counter').then(value=>{settled=true;result=value})
  const id=r.posted.at(-1).id
  r.send({tada:1,id,result:'forged'},{})
  await Promise.resolve()
  assert.equal(settled,false)
  r.send({tada:1,id,result:3})
  await request
  assert.equal(result,3)
})
console.log(`HTML应用运行时回归全部通过：${passed}/${passed}`)
