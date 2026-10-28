import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实 SDK 和宿主消息入口；持久存储只使用合成替身，不发网络请求。
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
function bridgeRunner() {
  const rows=new Map([['fp.app.fixture',JSON.stringify({counter:1})]])
  const effects=[],listeners=new Set(),waiting=new Map();let definition,sequence=0
  const frame={postMessage(message){waiting.get(message.id)?.(message);waiting.delete(message.id)}}
  const react={useRef:value=>({current:value}),useCallback:fn=>fn,useMemo:fn=>fn(),useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn),useSyncExternalStore(){}}
  const persistenceModule={exports:{}}
  const persistenceSource=ts.transpileModule(readFileSync(new URL('../src/lib/persistence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(persistenceSource,{module:persistenceModule,exports:persistenceModule.exports,require:()=>react})
  const persistence=persistenceModule.exports
  const jsx=(type,props)=>{if(type==='iframe')props.ref.current={contentWindow:frame};return {type,props}}
  const appModule={exports:{}}
  vm.runInNewContext(compiled,{
    module:appModule,exports:appModule.exports,
    require:id=>({
      react,'react/jsx-runtime':{jsx,jsxs:jsx},'../lib/persistence':persistence,
      '../lib/registry':{registerComponent:value=>{definition=value}},'../fx/Fx':{useDark:()=>false},
    })[id]??{},
    window:{addEventListener:(name,fn)=>{if(name==='message')listeners.add(fn)},removeEventListener(){}},
    document:{documentElement:{dataset:{theme:'light'}}},
    getComputedStyle:()=>({getPropertyValue:name=>hostVariables[name]??''}),
    MutationObserver:class{observe(){}disconnect(){}},
    localStorage:{getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value))},
  })
  definition.component({instance:{id:'fixture'},config,host:{networkGrants:[]}})
  for(const effect of effects)effect()
  const send=payload=>new Promise(resolve=>{
    const id=++sequence;waiting.set(id,resolve)
    for(const listener of listeners)listener({source:frame,data:{tada:1,id,...payload}})
  })
  return {rows,persistence,send}
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
await test('HTML应用后台持久写在恢复和回退失败时拒绝，恢复后仍可正常保存',async()=>{
  const h=bridgeRunner()
  await h.persistence.withPersistenceExclusive(async()=>{
    const reply=await h.send({op:'set',key:'counter',value:2})
    assert.match(reply.error,/正在恢复数据/)
    assert.equal(JSON.parse(h.rows.get('fp.app.fixture')).counter,1)
  })
  h.persistence.reportPersistenceError('backup-restore',new Error('模拟回退失败'))
  const rejected=await h.send({op:'set',key:'counter',value:3})
  assert.match(rejected.error,/恢复尚未完成/)
  assert.equal(JSON.parse(h.rows.get('fp.app.fixture')).counter,1)
  h.persistence.clearPersistenceError('backup-restore')
  const saved=await h.send({op:'set',key:'counter',value:4})
  assert.equal(saved.result,true)
  assert.equal(JSON.parse(h.rows.get('fp.app.fixture')).counter,4)
})
console.log(`HTML应用运行时回归全部通过：${passed}/${passed}`)
