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
const frameModule = {exports: {}}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/extensionSandbox.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
  module: frameModule, exports: frameModule.exports, require: () => ({isExtension: () => false}),
})
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
  const send=(message,source=parent)=>{for(const fn of listeners.get('message')??[])fn({data:{session:'',...message},source})}
  return {scope,root,variables,parent,posted,events,send}
}
function deferred() {let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function bridgeRunner() {
  const rows=new Map([['app:fixture',{counter:1}]])
  const hooks=[],effects=[],listeners=new Set(),waiting=new Map(),replies=[]
  let definition,sequence=0,cursor=0,renderConfig=config,document,uuid=0,writeBarrier,readError,writes=0
  const frame={postMessage(message){replies.push(message);waiting.get(message.id)?.(message);waiting.delete(message.id)}}
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]))
  const react={
    useRef:value=>{const index=cursor++;return hooks[index]??(hooks[index]={current:value})},
    useMemo:(fn,deps)=>{const index=cursor++;if(!same(hooks[index]?.deps,deps))hooks[index]={deps,value:fn()};return hooks[index].value},
    useCallback:(fn,deps)=>react.useMemo(()=>fn,deps),
    useState:value=>{const index=cursor++;if(!(index in hooks))hooks[index]=value;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value}]},
    useEffect:(fn,deps)=>{const index=cursor++;if(!same(hooks[index]?.deps,deps)){effects.push(()=>{hooks[index]?.cleanup?.();hooks[index]={deps,cleanup:fn()}})}},
    useSyncExternalStore(){},
  }
  const persistenceModule={exports:{}}
  const persistenceSource=ts.transpileModule(readFileSync(new URL('../src/lib/persistence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(persistenceSource,{module:persistenceModule,exports:persistenceModule.exports,require:()=>react})
  const persistence=persistenceModule.exports
  const repository={
    async loadApplicationData(ref){if(readError)throw readError;return structuredClone(rows.get(`${ref.kind}:${ref.id}`)??{})},
    async setApplicationValue(ref,key,value){
      persistence.assertPersistenceWritable();writes++
      if(readError)throw readError
      if(writeBarrier)await writeBarrier.promise
      const id=`${ref.kind}:${ref.id}`;rows.set(id,{...rows.get(id),[key]:value})
    },
  }
  const jsx=(type,props)=>{if(type==='iframe'){props.ref.current={contentWindow:frame};document=props.srcDoc}return {type,props}}
  const appModule={exports:{}}
  vm.runInNewContext(compiled,{
    module:appModule,exports:appModule.exports,
    require:id=>({
      react,'react/jsx-runtime':{jsx,jsxs:jsx},'../lib/applicationData':repository,
      '../lib/registry':{registerComponent:value=>{definition=value}},'../fx/Fx':{useDark:()=>false},
      '../lib/extensionSandbox':frameModule.exports,
      '../lib/platform':{prepareExtensionRequest:()=>undefined},
    })[id]??{},
    crypto:{randomUUID:()=>`session-${++uuid}`},
    window:{addEventListener:(name,fn)=>{if(name==='message')listeners.add(fn)},removeEventListener:(_name,fn)=>listeners.delete(fn)},
    document:{documentElement:{dataset:{theme:'light'}}},
    getComputedStyle:()=>({getPropertyValue:name=>hostVariables[name]??''}),
    MutationObserver:class{observe(){}disconnect(){}},
  })
  const render=(next=renderConfig)=>{cursor=0;renderConfig=next;definition.component({instance:{id:'fixture'},config:next,host:{networkGrants:[]}});effects.splice(0).forEach(fn=>fn())}
  render()
  const session=()=>JSON.parse(document.match(/const session=(.*?);/)[1])
  const dispatch=payload=>{for(const listener of listeners)listener({source:frame,data:{tada:1,session:session(),...payload}})}
  const send=payload=>new Promise(resolve=>{const id=payload.id??++sequence;waiting.set(id,resolve);dispatch({id,...payload})})
  return {rows,persistence,send,dispatch,replies,render,session,get writes(){return writes},setWriteBarrier:value=>{writeBarrier=value},setReadError:value=>{readError=value}}
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
    assert.equal(h.rows.get('app:fixture').counter,1)
  })
  h.persistence.reportPersistenceError('backup-restore',new Error('模拟回退失败'))
  const rejected=await h.send({op:'set',key:'counter',value:3})
  assert.match(rejected.error,/恢复尚未完成/)
  assert.equal(h.rows.get('app:fixture').counter,1)
  h.persistence.clearPersistenceError('backup-restore')
  const saved=await h.send({op:'set',key:'counter',value:4})
  assert.equal(saved.result,true)
  assert.equal(h.rows.get('app:fixture').counter,4)
})
await test('set 仅在宿主提交后确认；事务失败 reject，读取失败不会变成空数据',async()=>{
  const h=bridgeRunner(),gate=deferred();h.setWriteBarrier(gate)
  let settled=false
  const pending=h.send({op:'set',key:'counter',value:8}).then(reply=>{settled=true;return reply})
  await tick();assert.equal(settled,false);assert.equal(h.rows.get('app:fixture').counter,1)
  gate.resolve();assert.equal((await pending).result,true);assert.equal(h.rows.get('app:fixture').counter,8)
  const failed=deferred();h.setWriteBarrier(failed)
  const rejected=h.send({op:'set',key:'counter',value:9});failed.reject(new Error('事务中止'))
  assert.match((await rejected).error,/事务中止/);assert.equal(h.rows.get('app:fixture').counter,8)
  h.setReadError(new Error('无法读取数据库'))
  assert.match((await h.send({op:'get',key:'counter'})).error,/无法读取数据库/)
  assert.equal(h.rows.get('app:fixture').counter,8)
})
await test('同一会话重复 set 不重新执行，旧会话消息和旧异步回包不能进入新文档',async()=>{
  const h=bridgeRunner(),gate=deferred();h.setWriteBarrier(gate)
  const oldSession=h.session()
  const pending=h.send({id:1,op:'set',key:'counter',value:2})
  h.dispatch({id:1,op:'set',key:'counter',value:999})
  assert.equal(h.writes,1)
  gate.resolve();await pending;await tick()
  h.dispatch({id:1,op:'set',key:'counter',value:999})
  await tick();assert.equal(h.writes,1);assert.equal(h.rows.get('app:fixture').counter,2)
  const delayed=deferred();h.setWriteBarrier(delayed)
  h.dispatch({id:2,op:'set',key:'counter',value:3})
  const before=h.replies.length
  h.render({...config,js:'window.changed=true'})
  assert.notEqual(h.session(),oldSession)
  h.dispatch({session:oldSession,id:3,op:'set',key:'counter',value:1000})
  delayed.resolve();await tick()
  assert.equal(h.writes,2);assert.equal(h.replies.length,before,'旧请求不能回包到新文档')
  assert.equal(h.rows.get('app:fixture').counter,3,'已接受的旧运行保存继续完成')
  h.setWriteBarrier(undefined)
  assert.equal((await h.send({id:1,op:'get',key:'counter'})).result,3)
})
await test('扩展取数先等待两层授权，用户等待不占用15秒网络超时且拒绝不请求',async()=>{
  const permission=deferred(),events=[]
  let preparing=permission.promise
  const appModule={exports:{}}
  vm.runInNewContext(compiled,{
    module:appModule,exports:appModule.exports,
    require:id=>({
      '../lib/registry':{registerComponent(){}},
      '../lib/customWidget':{checkUrl:url=>({ok:true,url,host:'data.example'})},
      '../lib/rss':{proxied:(url,proxy)=>proxy?proxy+encodeURIComponent(url):url},
      '../lib/platform':{prepareExtensionRequest:target=>{events.push(['browser-permission',target]);return preparing}},
    })[id]??{},
    AbortController:class {constructor(){events.push(['controller']);this.signal={aborted:false}}},
    setTimeout:(_fn,ms)=>{events.push(['timeout',ms]);return 1},clearTimeout(){},
    fetch:async target=>{events.push(['fetch',target]);return {ok:true,status:200,text:async()=>'{"value":7}'}},
  })
  const host={networkGrants:[],requestNetworkGrant:async host=>{events.push(['application-permission',host]);return true},proxy:'https://proxy.example/?url='}
  const pending=appModule.exports.bridgeFetch('https://data.example/api',host)
  await tick()
  assert.deepEqual(events,[['application-permission','data.example'],['browser-permission','https://proxy.example/?url=https%3A%2F%2Fdata.example%2Fapi']])
  permission.resolve()
  assert.equal((await pending).json.value,7)
  assert.deepEqual(events.slice(2).map(event=>event[0]),['controller','timeout','fetch'])
  const before=events.length
  preparing=Promise.reject(new Error('用户拒绝浏览器网络权限'))
  await assert.rejects(appModule.exports.bridgeFetch('https://data.example/api',host),/用户拒绝/)
  assert.deepEqual(events.slice(before).map(event=>event[0]),['application-permission','browser-permission'])
})
console.log(`HTML应用运行时回归全部通过：${passed}/${passed}`)
