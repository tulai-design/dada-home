import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file)
  const module = {exports: {}}
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, (id) => load(path.resolve(path.dirname(file), `${id}.ts`)))
  cache.set(file, module.exports)
  return module.exports
}
const {buildRunnerDoc} = load('src/lib/applet/runner.ts')
const extensionSandbox = load('src/lib/extensionSandbox.ts')
function harness(source, session = '') {
  const messages = [], listeners = {}, timeouts = new Set(), intervals = new Set()
  const sandbox = {
    navigator: {},
    parent: {postMessage: (message) => messages.push(structuredClone(message))},
    addEventListener: (name, listener) => {listeners[name] = listener},
    setTimeout: (fn, delay) => {const id = setTimeout(() => {timeouts.delete(id); fn()}, delay); timeouts.add(id); return id},
    clearTimeout: (id) => {clearTimeout(id); timeouts.delete(id)},
    setInterval: (fn, delay) => {const id = setInterval(fn, delay); intervals.add(id); return id},
    clearInterval: (id) => {clearInterval(id); intervals.delete(id)},
  }
  sandbox.window = sandbox
  const context = vm.createContext(sandbox)
  const script = buildRunnerDoc('', session).match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInContext(script, context)
  vm.runInContext(source, context)
  const send = (message, source=sandbox.parent) => listeners.message({source, data: {applet: 1, session, ...message}})
  const text = () => {
    const tree = messages.filter((message) => message.k === 'view').at(-1)?.tree
    return tree ? JSON.parse(tree.p.text) : null
  }
  const waitFor = async (predicate) => {
    const start = Date.now()
    while (!predicate()) {
      assert.ok(Date.now() - start < 2000, `runner 等待超时：${JSON.stringify(messages)}`)
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
    assert.equal(messages.find((message) => message.k === 'error'), undefined, JSON.stringify(messages))
  }
  return {send, text, waitFor, messages, intervals, context, stop: () => {timeouts.forEach(clearTimeout); intervals.forEach(clearInterval)}}
}
function deferred() {let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function hostHarness() {
  const hooks=[],effects=[],listeners=new Set(),messages=[],writes=[]
  let persistenceErrors=[]
  let cursor=0,definition,session,uuid=0,tree,readCount=0,readError,readGate,writeGate,currentSource='applet({view:()=>ui.Text({text:"test"})})'
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]))
  const react={
    useRef:value=>{const index=cursor++;return hooks[index]??(hooks[index]={current:value})},
    useMemo:(fn,deps)=>{const index=cursor++;if(!same(hooks[index]?.deps,deps))hooks[index]={deps,value:fn()};return hooks[index].value},
    useCallback:(fn,deps)=>react.useMemo(()=>fn,deps),
    useState:value=>{const index=cursor++;if(!(index in hooks))hooks[index]=value;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value}]},
    useEffect:(fn,deps)=>{const index=cursor++;if(!same(hooks[index]?.deps,deps))effects.push(()=>{hooks[index]?.cleanup?.();hooks[index]={deps,cleanup:fn()}})},
  }
  const frame={postMessage:message=>messages.push(structuredClone(message))}
  const jsx=(type,props)=>{if(type==='iframe')props.ref.current={contentWindow:frame};return {type,props}}
  const repository={
    async loadApplicationData(){readCount++;if(readGate)await readGate.promise;if(readError)throw readError;return {count:7}},
    async replaceApplicationData(ref,value){writes.push(structuredClone({ref,value}));if(writeGate)await writeGate.promise},
  }
  const module={exports:{}}
  const compiled=ts.transpileModule(readFileSync(path.join(root,'src/widgets/applet.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(compiled,{
    module,exports:module.exports,crypto:{randomUUID:()=>`host-${++uuid}`},
    window:{addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn)},
    require:id=>({
      react,'react/jsx-runtime':{jsx,jsxs:jsx},'@lobehub/ui':{Button:'Button',Flexbox:'Flexbox',Tag:'Tag',Text:'Text'},
      '@phosphor-icons/react':{},'../fx/Fx':{useDark:()=>false},
      '../lib/applet/runner':{buildRunnerDoc:(source,current)=>{session=current;return buildRunnerDoc(source,current)}},
      '../lib/applet/render':{UiTree:'UiTree',useContainerWidth:()=>({ref:{current:null},width:400})},
      '../lib/registry':{registerComponent:value=>{definition=value}},'../lib/applicationData':repository,'./app':{},
      '../lib/persistence':{usePersistenceStatus:()=>({errors:persistenceErrors})},
      '../lib/extensionSandbox':extensionSandbox,
    })[id]??{},
  })
  const render=(source=currentSource)=>{cursor=0;currentSource=source;tree=definition.component({instance:{id:'fixture'},config:{source},host:{}});effects.splice(0).forEach(fn=>fn());return tree}
  const visit=(node,fn)=>{if(Array.isArray(node)){node.forEach(child=>visit(child,fn));return}if(!node||typeof node!=='object')return;fn(node);visit(node.props?.children,fn)}
  const button=label=>{let result;visit(tree,node=>{if(node.type==='Button'&&node.props.children===label)result=node.props.onClick});assert.ok(result,`缺少按钮 ${label}`);return result}
  const text=()=>{const values=[];visit(tree,node=>{const children=node.props?.children;for(const child of [children].flat())if(typeof child==='string')values.push(child)});return values.join(' ')}
  const send=(message,source=frame)=>listeners.forEach(listener=>listener({source,data:{applet:1,session,...message}}))
  render()
  return {render,send,messages,writes,button,text,get session(){return session},get readCount(){return readCount},setReadError:error=>{readError=error},setReadGate:gate=>{readGate=gate},setWriteGate:gate=>{writeGate=gate},setPersistenceErrors:errors=>{persistenceErrors=errors}}
}
const source = `
let cancel;
applet({
  state:{count:0,initCount:0,events:[]},persist:['count'],
  async init(s,ctx){await new Promise(r=>setTimeout(r,5));s.initCount++;cancel=ctx.every(60000,()=>s.count++);},
  async onSettingsChange(s,ctx,previous){
    s.events.push(['start',previous.minutes,ctx.settings.minutes,Object.isFrozen(previous),Object.isFrozen(ctx.settings)]);
    await new Promise(r=>setTimeout(r,8));
    s.events.push(['end',ctx.settings.minutes]);
    cancel();cancel=ctx.every(60000,()=>s.count++);
  },
  view:(s,ctx)=>ui.Text({text:JSON.stringify({...s,settings:ctx.settings,viewport:ctx.viewport,frozen:Object.isFrozen(ctx.viewport)})})
});`
let passed = 0
async function test(name, run) {await run();passed++;console.log(`通过：${name}`)}

await test('实际runner初始化恢复persist，resize只更新容器viewport、不重启init或业务状态', async () => {
  const app = harness(source)
  try {
    app.send({k:'init',saved:{count:7},settings:{minutes:25,label:'计时'},surface:'widget',viewport:{width:620}})
    await app.waitFor(() => app.text()?.initCount === 1)
    app.send({k:'viewport',viewport:{width:320}})
    await app.waitFor(() => app.text()?.viewport.width === 320)
    assert.deepEqual(app.text().viewport,{width:320,compact:true})
    assert.equal(app.text().count,7); assert.equal(app.text().initCount,1); assert.equal(app.text().frozen,true)
    app.send({k:'viewport',viewport:{width:600}})
    app.send({k:'dark',dark:true})
    await app.waitFor(() => app.text()?.viewport.width === 600)
    assert.equal(app.text().viewport.compact,false)
    assert.deepEqual(app.text().events,[])
    assert.equal(app.messages.filter(message=>message.k==='save').length,0)
  } finally {app.stop()}
})
await test('异步init完成后才运行设置hook，快速更新按顺序执行并提供只读previous', async () => {
  const app = harness(source)
  try {
    app.send({k:'init',saved:{count:9},settings:{minutes:25,label:'计时'},viewport:{width:390}})
    app.send({k:'context',settings:{minutes:30,label:'计时'},surface:'drawer'})
    app.send({k:'context',settings:{minutes:40,label:'计时'},surface:'drawer'})
    await app.waitFor(() => app.text()?.events.length === 4)
    assert.equal(app.text().initCount,1)
    assert.equal(app.text().count,9)
    assert.deepEqual(app.text().events,[['start',25,30,true,true],['end',30],['start',30,40,true,true],['end',40]])
    assert.equal(app.intervals.size,1,'设置hook取消旧timer后只剩新timer')
    app.send({k:'context',settings:{label:'计时',minutes:40},surface:'page'})
    app.send({k:'viewport',viewport:{width:480}})
    app.send({k:'dark',dark:true})
    await app.waitFor(() => app.text()?.viewport.width === 480)
    assert.equal(app.text().events.length,4,'仅字段顺序、surface、viewport或dark改变不调用设置hook')
    assert.equal(app.text().viewport.compact,false)
  } finally {app.stop()}
})
await test('重复init消息不重置业务状态或重建已有timer', async () => {
  const app = harness(source)
  try {
    app.send({k:'init',saved:{count:17},settings:{minutes:25},viewport:{width:390}})
    await app.waitFor(() => app.text()?.initCount === 1)
    app.send({k:'init',saved:{count:999},settings:{minutes:99},viewport:{width:999}})
    app.send({k:'viewport',viewport:{width:320}})
    await app.waitFor(() => app.text()?.viewport.width === 320)
    assert.equal(app.text().count,17)
    assert.equal(app.text().initCount,1)
    assert.equal(app.text().settings.minutes,25)
    assert.equal(app.intervals.size,1)
  } finally {app.stop()}
})
await test('持久值从null变为NaN等JSON有损值时不会被相同JSON缓存静默跳过',async()=>{
  const app=harness(`applet({state:{value:null},persist:['value'],view:(s)=>ui.Text({text:'{}',onClick:()=>{s.value=NaN}})})`)
  try {
    app.send({k:'init',saved:{value:null}});await app.waitFor(()=>app.text()!==null)
    const fn=app.messages.filter(m=>m.k==='view').at(-1).tree.p.onClick.$fn
    app.send({k:'event',fn})
    assert.equal(app.messages.filter(m=>m.k==='save').length,0)
    assert.match(app.messages.find(m=>m.k==='storage-error')?.message,/JSON/)
  } finally {app.stop()}
})
await test('persist显式undefined被拒绝且不发删除快照，未存在的可选字段仍可省略',async()=>{
  const app=harness(`applet({state:{value:'初始'},persist:['value','optional'],view:(s)=>ui.Text({text:'{}',onClick:()=>{s.value=undefined}})})`)
  try {
    app.send({k:'init',saved:{value:'重要内容'}});await app.waitFor(()=>app.text()!==null)
    assert.equal(app.messages.filter(m=>m.k==='storage-error').length,0,'未出现的optional不是非法值')
    const fn=app.messages.filter(m=>m.k==='view').at(-1).tree.p.onClick.$fn
    app.send({k:'event',fn})
    assert.equal(app.messages.filter(m=>m.k==='save').length,0,'不能发送空快照删除原值')
    assert.match(app.messages.find(m=>m.k==='storage-error')?.message,/JSON/)
  } finally {app.stop()}
})
const editableSource=`applet({state:{count:0},persist:['count'],view:(s)=>ui.Text({text:JSON.stringify(s),onClick:()=>s.count++})})`
await test('事件结束立即捕获保存，延迟确认和旧确认不会清除较新保存；失败同值可以重试',async()=>{
  const app=harness(editableSource,'run-one')
  try {
    app.send({k:'init',saved:{count:0}});await app.waitFor(()=>app.text()?.count===0)
    const handler=()=>app.messages.filter(m=>m.k==='view').at(-1).tree.p.onClick.$fn
    const saves=()=>app.messages.filter(m=>m.k==='save')
    app.send({k:'event',fn:handler()})
    assert.equal(saves().length,1,'保存消息不能等待延迟 view')
    const first=saves()[0];assert.equal(first.data.count,1)
    app.send({k:'event',fn:handler()})
    assert.equal(saves().length,2);const second=saves()[1];assert.equal(second.data.count,2)
    app.send({k:'save-reply',id:first.id})
    app.send({k:'save-reply',id:second.id,error:'配额不足'})
    app.send({k:'retry-save'})
    const retried=saves()[2];assert.ok(retried.id>second.id);assert.equal(retried.data.count,2)
    app.send({k:'save-reply',id:first.id,error:'迟到的错误'})
    app.send({k:'save-reply',id:retried.id})
    app.send({k:'dark',dark:true});await app.waitFor(()=>app.text()?.count===2)
    assert.equal(saves().length,3,'确认后相同内容不重复保存')
  } finally {app.stop()}
})
await test('非父来源和旧运行 session 不能初始化、触发事件、确认保存或回复 RPC',async()=>{
  const app=harness(editableSource,'current')
  try {
    app.send({k:'init',saved:{count:900}},{});app.send({session:'old',k:'init',saved:{count:800}})
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(app.text(),null)
    app.send({k:'init',saved:{count:1}});await app.waitFor(()=>app.text()?.count===1)
    const fn=app.messages.filter(m=>m.k==='view').at(-1).tree.p.onClick.$fn
    app.send({session:'old',k:'event',fn});app.send({k:'event',fn},{})
    assert.equal(app.messages.filter(m=>m.k==='save').length,0)
    app.send({k:'event',fn});const save=app.messages.filter(m=>m.k==='save').at(-1)
    app.send({session:'old',k:'save-reply',id:save.id,error:'forged'})
    app.send({k:'dark',dark:true});await app.waitFor(()=>app.text()?.count===2)
    assert.equal(app.messages.filter(m=>m.k==='save').length,1,'旧确认未重置 lastSent')
  } finally {app.stop()}
})
await test('真实Applet宿主等读取成功才init；读失败提供真实重读且不发布空saved',async()=>{
  const host=hostHarness(),gate=deferred();host.setReadGate(gate)
  host.send({k:'ready'});host.send({k:'ready'})
  await tick();assert.equal(host.readCount,1);assert.equal(host.messages.filter(m=>m.k==='init').length,0)
  host.setReadError(new Error('数据库被禁止'));gate.resolve();await tick();host.render()
  assert.match(host.text(),/无法读取应用数据/);assert.equal(host.messages.filter(m=>m.k==='init').length,0)
  host.setReadError(undefined);host.setReadGate(undefined)
  host.button('重新读取')();await tick()
  assert.equal(host.readCount,2)
  assert.deepEqual(host.messages.filter(m=>m.k==='init').map(m=>m.saved),[{count:7}])
  host.send({k:'ready'});await tick();assert.equal(host.readCount,2,'重复ready不会再次初始化')
})
await test('真实Applet宿主提交后才保存回执；故障独立显示，重复请求与旧会话不能覆盖新值',async()=>{
  const host=hostHarness();host.send({k:'ready'});await tick()
  const gate=deferred();host.setWriteGate(gate)
  host.send({k:'save',id:1,data:{count:8}});host.send({k:'save',id:1,data:{count:999}})
  host.render();assert.match(host.text(),/正在保存/);assert.equal(host.writes.length,1)
  assert.equal(host.messages.filter(m=>m.k==='save-reply').length,0)
  gate.reject(new Error('配额不足'));await tick();host.render()
  assert.match(host.text(),/更改尚未保存/);assert.match(host.text(),/配额不足/)
  assert.match(host.messages.filter(m=>m.k==='save-reply')[0].error,/配额不足/)
  host.button('重试保存')();assert.equal(host.messages.at(-1).k,'retry-save')
  host.setWriteGate(undefined);host.send({k:'save',id:2,data:{count:9}});await tick();host.render()
  assert.doesNotMatch(host.text(),/更改尚未保存/)
  host.send({k:'save',id:1,data:{count:1000}});await tick();assert.equal(host.writes.length,2)
  const old=host.session,delayed=deferred();host.setWriteGate(delayed)
  host.send({k:'save',id:3,data:{count:10}})
  host.render('applet({view:()=>ui.Text({text:"new"})})')
  const before=host.messages.length
  host.send({session:old,k:'save',id:4,data:{count:2000}})
  delayed.resolve();await tick()
  assert.equal(host.writes.length,3);assert.equal(host.messages.length,before,'旧运行结果不能回复新文档')
})
await test('全局重试清除实例错误后宿主重新确认当前运行，局部提示不永久滞留',async()=>{
  const host=hostHarness();host.send({k:'ready'});await tick()
  const failed=deferred();host.setWriteGate(failed)
  host.send({k:'save',id:1,data:{count:8}});failed.reject(new Error('quota'))
  await tick();host.setPersistenceErrors([{source:'application-write:applet:fixture'}]);host.render()
  assert.match(host.text(),/更改尚未保存/)
  host.setPersistenceErrors([]);host.render()
  assert.equal(host.messages.at(-1).k,'retry-save')
  host.setWriteGate(undefined);host.send({k:'save',id:2,data:{count:8}});await tick();host.render()
  assert.doesNotMatch(host.text(),/更改尚未保存/)
})
console.log(`全部通过：${passed}/${passed} 个小程序运行时回归。`)
