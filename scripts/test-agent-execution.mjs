import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import * as core from '@tulai-design/agent-core'

// 执行真实产品工具与 runAgent，网络/存储/宿主只在其公开边界隔离，不读取用户数据。
function compile(name, dependencies = {}) {
  const module = {exports: {}}
  const js = ts.transpileModule(readFileSync(`src/lib/${name}.ts`, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  new Function('module', 'exports', 'require', js)(module, module.exports, id => dependencies[id] ?? {})
  return module.exports
}
const {WorkspaceError} = compile('errors')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}}
let writes = [], groups = [], playerError = '', sourceRequest, geocodeRequest, bridgeRequest
const context = () => ({signal: new AbortController().signal, openPage() {}})
const common = {
  '@tulai-design/agent-core': core,
  './errors': {WorkspaceError},
  './defaults': {OPEN_TARGETS: [], SEARCH_ENGINES: [], defaultSettings: () => ({})},
  './workspaceStore': {getWorkspace: () => ({pages: [{id:'home', name:'首页', components:[{id:'hot',type:'hot',config:{boards:'one'}}]}]}), commit: next => writes.push(next)},
  './store': {readStored: (_key, fallback) => fallback, writeStored: (key, value) => writes.push({key,value})},
  './skills': {SKILLS: [], skillIndex: () => '', findSkill: () => undefined},
  './permissions': {isAlwaysAllowed: () => false},
  './hot': {DEFAULT_HOT_BOARDS: [], fetchSources: () => sourceRequest()},
  './weather': {geocode: (...args) => geocodeRequest(...args)},
  './calendar': {REPEAT_LABEL: {}, parseYmd: () => null},
  './player': {MODE_LABEL: {}, PRESETS: [], getPlayerState: () => ({error:playerError}), playerActions: {pause() {}}, currentTrack: () => null},
  '../fx/policy': {FX_BUDGET_LIMITS:{},FX_COMPACT_LIMITS:{}},
  './dock': {DOCK_PRESETS:[]},
  './market': {ADDONS: [], isInstalled: () => true},
  './componentData': {SHARED: {}, readData: (_id, fallback) => fallback},
  './webSearch': {searchReady: () => false, readSearchConfig: () => ({})},
  './bookmarks': {getBookmarks: () => groups, updateBookmark: () => ({error:'该书签不存在'}), setBookmarks: next => {groups = next; writes.push(next)}},
  './browserBookmarks': {detect: () => bridgeRequest(), NO_EXTENSION_HINT:'请安装扩展'},
  './ops': {updateComponent: () => ({workspace:{changed:true}})},
}
const site = compile('siteTools', common)
const life = compile('lifeTools', common)
const search = compile('searchTools', common)
const tools = compile('tools', {...common, './siteTools':site, './lifeTools':life, './searchTools':search, './homepageDraftTools':{HOMEPAGE_DRAFT_TOOLS:[]}, './themeAuthoringTools':{THEME_AUTHORING_TOOLS:[]}})
const config = {baseUrl:'https://fixture.invalid',model:'fixture',maxRounds:3}
const call = (name, args = {}, id = name) => ({id, function:{name,arguments:JSON.stringify(args)}})
const toolReply = (...calls) => ({ok:true,content:'',toolCalls:calls})
const done = {ok:true,content:'完成'}
const fixture = core.createToolFactory()({schema:{parse: value => value},json:{type:'object',properties:{}}}, {name:'fixture_write',title:'隔离写入',effect:'write',highRisk:()=>false,execute:()=>''})
function runner({provider = async () => done, execute, extraTools = []} = {}) {
  const definitions = [...tools.HOME_TOOLS, ...extraTools]
  const requests = [], events = [], grants = [], deltas = [], reasoning = []
  const ai = compile('ai', {
    ...common,
    '@tulai-design/agent-providers': {streamChatCompletions: async (input, handlers) => {requests.push({...input, handlers}); return provider({...input, handlers}, requests.length)}},
    './aiProtocol': {resolveAiProtocol: () => 'openai'},
    './persona': {personaPrompt: () => ''},
    './permissions': {REMEMBERABLE:{open_search:{label:'搜索'}},setAlwaysAllowed:(...args)=>grants.push(args)},
    './tools': {toolSchemas:()=>definitions.map(t=>({type:'function',function:{name:t.name,parameters:t.parameters}})),findTool:name=>definitions.find(t=>t.name===name),runTool:execute ?? tools.runTool},
  })
  return {requests,events,grants,deltas,reasoning, run:options=>ai.runAgent({config,messages:[],host:{openPage(){}},onDelta:text=>deltas.push(text),onReasoning:text=>reasoning.push(text),onTool:event=>events.push(event),...options})}
}
let passed=0
async function test(name, run) {writes=[];groups=[];await run();passed++;console.log(`通过：${name}`)}

await test('预先停止不启动 provider',async()=>{
  const r=runner(), controller=new AbortController();controller.abort()
  await assert.rejects(()=>r.run({signal:controller.signal}),{name:'AbortError'})
  assert.equal(r.requests.length,0)
})
for(const late of [true,'always']) await test(`审批等待可停止，迟到 ${late} 不执行也不记住授权`,async()=>{
  const reached=deferred(), approval=deferred(), controller=new AbortController()
  const listeners=new Set()
  const add=controller.signal.addEventListener.bind(controller.signal), remove=controller.signal.removeEventListener.bind(controller.signal)
  controller.signal.addEventListener=(type,...args)=>{if(type==='abort')listeners.add(args[0]);return add(type,...args)}
  controller.signal.removeEventListener=(type,...args)=>{if(type==='abort')listeners.delete(args[0]);return remove(type,...args)}
  const r=runner({provider:async()=>toolReply(call('open_search',{query:'测试'})),execute:async()=>{writes.push('执行');return '已执行'}})
  const running=r.run({signal:controller.signal,onApproval:()=>{reached.resolve();return approval.promise}})
  const outcome=running.then(()=>assert.fail('取消不能成功'),error=>error.name)
  await reached.promise;controller.abort()
  assert.equal(await Promise.race([outcome,new Promise(resolve=>setTimeout(()=>resolve('仍挂起'),100))]),'AbortError')
  approval.resolve(late);await tick()
  assert.equal(listeners.size,0);assert.equal(writes.length,0);assert.equal(r.grants.length,0);assert.equal(r.requests.length,1);assert.equal(r.events.length,0)
})
await test('审批回调中同步停止也不能写永久授权',async()=>{
  const controller=new AbortController()
  const r=runner({provider:async()=>toolReply(call('open_search',{query:'测试'})),execute:async()=>{writes.push(1);return ''}})
  await assert.rejects(()=>r.run({signal:controller.signal,onApproval:()=>{controller.abort();return 'always'}}),{name:'AbortError'})
  assert.equal(writes.length,0);assert.equal(r.grants.length,0)
})
await test('provider aborted 单独成为取消，晚到正文/思考不污染已结束轮',async()=>{
  let handlers
  const r=runner({provider:async input=>{handlers=input.handlers;return {ok:false,aborted:true,message:'停止'}}})
  await assert.rejects(()=>r.run(),{name:'AbortError'})
  handlers.onDelta('迟到');handlers.onReasoning('迟到')
  assert.deepEqual(r.deltas,[]);assert.deepEqual(r.reasoning,[])
})
await test('模型请求期间停止后丢弃返回工具与后续请求',async()=>{
  const response=deferred(),controller=new AbortController()
  const r=runner({provider:()=>response.promise,execute:async()=>{writes.push(1);return ''}})
  const running=r.run({signal:controller.signal});await tick();controller.abort()
  r.requests[0].handlers.onDelta('迟到');r.requests[0].handlers.onReasoning('迟到')
  response.resolve(toolReply(call('set_theme',{})))
  await assert.rejects(()=>running,{name:'AbortError'})
  assert.equal(writes.length,0);assert.equal(r.requests.length,1);assert.deepEqual(r.deltas,[])
})
await test('同批工具之间停止保留已提交副作用，跳过剩余工具和下轮请求',async()=>{
  const controller=new AbortController()
  const r=runner({extraTools:[fixture],provider:async()=>toolReply(call('fixture_write',{},'one'),call('fixture_write',{},'two')),execute:async()=>{writes.push('已提交');return '已提交'}})
  await assert.rejects(()=>r.run({signal:controller.signal,onTool:event=>{r.events.push(event);controller.abort()}}),{name:'AbortError'})
  assert.deepEqual(writes,['已提交']);assert.equal(r.events.length,1);assert.equal(r.requests.length,1)
})
await test('在途工具沿用signal，停止后等待合作结束且不吞AbortError',async()=>{
  const entered=deferred(),cleanup=deferred(),controller=new AbortController()
  const r=runner({extraTools:[fixture],provider:async()=>toolReply(call('fixture_write')),execute:async(_tool,_args,ctx)=>{assert.equal(ctx.signal,controller.signal);entered.resolve();await cleanup.promise;ctx.signal.throwIfAborted();writes.push(1);return ''}})
  let settled=false
  const running=r.run({signal:controller.signal}).finally(()=>{settled=true})
  const outcome=assert.rejects(()=>running,{name:'AbortError'})
  await entered.promise;controller.abort();await tick();assert.equal(settled,false)
  cleanup.resolve();await outcome
  assert.equal(writes.length,0);assert.equal(r.events.length,0);assert.equal(r.requests.length,1)
})
await test('工具自行抛AbortError终止而不是普通失败继续',async()=>{
  const r=runner({extraTools:[fixture],provider:async()=>toolReply(call('fixture_write')),execute:async()=>{throw new DOMException('停止','AbortError')}})
  await assert.rejects(()=>r.run(),{name:'AbortError'});assert.equal(r.requests.length,1);assert.equal(r.events.length,0)
})
for(const [name,args,message] of [
  ['open_page',{pageId:'missing'},/没有这个页面/],
  ['update_bookmark',{id:'missing'},/该书签不存在/],
  ['move_bookmarks',{ids:[],group:''},/目标分组名/],
  ['read_article',{link:'https://missing.invalid'},/没找到这篇/],
  ['open_settings',{},/不能打开设置/],
  ['read_tool_result',{},/不能读取历史/],
  ['get_date_info',{date:'bad'},/YYYY-MM-DD/],
  ['control_music',{action:'invalid'},/action 不对/],
  ['web_search',{query:'测试'},/联网搜索还没配好/],
  ['web_fetch',{url:'not-a-url'},/网址不对/],
]) await test(`真实工具 ${name} 领域失败标记ok:false并回传模型`,async()=>{
  const r=runner({provider:async(_input,n)=>n===1?toolReply(call(name,args)):done})
  assert.equal(await r.run(),'完成');assert.equal(r.events.length,1);assert.equal(r.events[0].ok,false);assert.match(r.events[0].text,message)
  assert.equal(r.requests[1].messages.at(-1).content,r.events[0].text)
})
await test('真实 schema 解析失败、未知异常、用户拒绝分别失败且模型可继续',async()=>{
  const schema=runner({provider:async(_input,n)=>n===1?toolReply(call('set_theme',{dark:'invalid'})):done})
  await schema.run();assert.equal(schema.events[0].ok,false);assert.match(schema.events[0].text,/参数格式不对/)
  const error=runner({extraTools:[fixture],provider:async(_input,n)=>n===1?toolReply(call('fixture_write')):done,execute:async()=>{throw new Error('意外错误')}})
  await error.run();assert.equal(error.events[0].ok,false);assert.equal(error.events[0].text,'意外错误')
  const denied=runner({extraTools:[fixture],provider:async(_input,n)=>n===1?toolReply(call('fixture_write')):done,execute:async()=>assert.fail('拒绝后不可执行')})
  await denied.run({permissionMode:'ask',onApproval:()=>false});assert.equal(denied.events[0].ok,false);assert.match(denied.events[0].text,/用户拒绝/)
})
await test('成功文本即使含失败字样仍成功，正常空列表保持成功',async()=>{
  const r=runner({extraTools:[fixture],provider:async(_input,n)=>n===1?toolReply(call('fixture_write')):done,execute:async()=> '没有成功：这是用户保存的原始文字'})
  await r.run();assert.equal(r.events[0].ok,true)
  const empty=runner({provider:async(_input,n)=>n===1?toolReply(call('list_bookmarks')):done})
  await empty.run();assert.equal(empty.events[0].ok,true);assert.match(empty.events[0].text,/还没有任何书签/)
})
await test('update_settings 地名查询停止后不写设置/输入框/侧栏',async()=>{
  const gate=deferred(),controller=new AbortController()
  geocodeRequest=async(_city,signal)=>{assert.equal(signal,controller.signal);await gate.promise;return [{name:'杭州',lat:30,lon:120}]}
  const tool=tools.findTool('update_settings')
  const running=tools.runTool(tool,tool.parseArguments({name:'测试',city:'杭州',searchEngine:'ai',sidebarAi:'drawer'}),{...context(),signal:controller.signal})
  controller.abort();gate.resolve();await assert.rejects(()=>running,{name:'AbortError'});assert.equal(writes.length,0)
})
await test('set_hot_boards 查询后停止不提交工作空间',async()=>{
  const gate=deferred(),controller=new AbortController();sourceRequest=async()=>{await gate.promise;return [{id:'one'}]}
  const tool=tools.findTool('set_hot_boards')
  const running=tools.runTool(tool,tool.parseArguments({boards:['one']}),{...context(),signal:controller.signal})
  controller.abort();gate.resolve();await assert.rejects(()=>running,{name:'AbortError'});assert.equal(writes.length,0)
})
await test('扩展探测期间停止不启动远端写，未连接扩展是失败事件',async()=>{
  const gate=deferred(),controller=new AbortController();bridgeRequest=()=>gate.promise
  const tool=tools.findTool('add_browser_bookmarks')
  const running=tools.runTool(tool,tool.parseArguments({items:[{url:'https://example.invalid'}]}),{...context(),signal:controller.signal})
  controller.abort();gate.resolve(true);await assert.rejects(()=>running,{name:'AbortError'})
  bridgeRequest=async()=>false
  const r=runner({provider:async(_input,n)=>n===1?toolReply(call('list_browser_bookmarks')):done})
  await r.run();assert.equal(r.events[0].ok,false);assert.equal(r.events[0].text,'请安装扩展')
})
await test('音乐播放器报告错误以真实失败返回',async()=>{
  playerError='播放地址失效'
  const tool=tools.findTool('control_music')
  await assert.rejects(()=>tools.runTool(tool,tool.parseArguments({action:'pause'}),context()),/没成功：播放地址失效/)
  playerError=''
})
await test('正常noopener返回null也不误判浏览器跳转失败',async()=>{
  const original=globalThis.window
  let opened
  globalThis.window={open:(...args)=>{opened=args;return null}}
  const local=compile('searchTools',{...common,'./defaults':{OPEN_TARGETS:[{id:'google',label:'谷歌',url:'https://example.invalid?q='}]}})
  const tool=local.SEARCH_TOOLS.find(t=>t.name==='open_search')
  try {
    assert.match(await tool.execute(tool.parseArguments({query:'测试'}),context()),/已请求浏览器/)
    assert.equal(opened[2],'noopener')
  } finally {globalThis.window=original}
})
await test('真实浏览器导入等待结束后取消不落库，同步不启动下一批',async()=>{
  let requests=[],gate=deferred()
  const browser=compile('browserBookmarks',{
    './platform':{extensionApi:()=>({runtime:{sendMessage:message=>{requests.push(message);return gate.promise}}})},
    './bookmarks':{getBookmarks:()=>groups,groupName:()=> '测试',addBookmarks:()=>assert.fail('取消后不得计算导入'),setBookmarks:()=>assert.fail('取消后不得保存导入')},
  })
  const imported=new AbortController()
  const importing=browser.importFromBrowser(imported.signal)
  imported.abort();gate.resolve({ok:true,data:{items:[{path:['书签栏'],url:'https://example.invalid'}]}})
  await assert.rejects(()=>importing,{name:'AbortError'})
  assert.equal(requests.length,1)
  groups=[{name:'测试',items:Array.from({length:401},(_,i)=>({title:`${i}`,url:`https://example.invalid/${i}`}))}]
  requests=[];gate=deferred()
  const pushed=new AbortController()
  const pushing=browser.pushToBrowser(pushed.signal)
  assert.equal(requests.length,1)
  pushed.abort();gate.resolve({ok:true,data:{created:200,skipped:[]}})
  await assert.rejects(()=>pushing,{name:'AbortError'})
  assert.equal(requests.length,1,'已发送批次保留，停止后不再发送第二批')
})
await test('真实geocode将可选取消信号传给网络',async()=>{
  const weather=compile('weather'),original=globalThis.fetch,controller=new AbortController()
  globalThis.fetch=async(_url,options)=>{assert.equal(options.signal,controller.signal);return {ok:true,json:async()=>({results:[]})}}
  try {assert.deepEqual(await weather.geocode('杭州',controller.signal),[])} finally {globalThis.fetch=original}
})
console.log(`Agent 执行语义回归：${passed} 项通过`)
