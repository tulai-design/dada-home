import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import * as agentCore from '@tulai-design/agent-core'
import * as providers from '@tulai-design/agent-providers'

// 执行真实工具、数据校验和工作空间操作；仅隔离存储、网络与未使用的业务工具。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modules = new Map()
let workspace, commits = 0
const listeners = new Set()
const history = []
const store = {getWorkspace: () => workspace, subscribeWorkspace: listener => {listeners.add(listener); return () => listeners.delete(listener)}, commit: next => {history.push(workspace); workspace = next; commits += 1; for (const listener of listeners) listener()}}
const isolated = new Map([
  ['src/lib/workspaceStore.ts', store],
  ['src/lib/themeAuthoring/previewBridge.ts', {inspectThemeDraftPreview: async request => {request.signal?.throwIfAborted(); return {status:'ok',target:{draftId:request.draftId,revision:request.revision},unknown:['aesthetics'],coverage:['fixture-geometry']}}}],
  ['src/lib/skills.ts', {skillIndex: () => ''}], ['src/lib/permissions.ts', {REMEMBERABLE: {}, setAlwaysAllowed() {}}],
  ['src/lib/componentData.ts', {}], ['src/lib/browserBookmarks.ts', {}], ['src/lib/bookmarks.ts', {}], ['src/lib/persona.ts', {personaPrompt: () => ''}],
  ['src/lib/siteTools.ts', {SITE_TOOLS: []}], ['src/lib/searchTools.ts', {SEARCH_TOOLS: []}], ['src/lib/lifeTools.ts', {LIFE_TOOLS: []}],
])
function load(relative) {
  const file = path.resolve(root, relative)
  const sourcePath = path.relative(root, file)
  if (isolated.has(sourcePath)) return isolated.get(sourcePath)
  if (modules.has(file)) return modules.get(file).exports
  const module = {exports: {}}
  modules.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  const require = (id) => {
    if (id === '@tulai-design/agent-core') return agentCore
    if (id === '@tulai-design/agent-providers') return providers
    if (id === '@phosphor-icons/react') return new Proxy({}, {get: () => () => null})
    if (!id.startsWith('.')) return nodeRequire(id)
    const target = path.resolve(path.dirname(file), id)
    const resolved = ['', '.ts', '.tsx'].map((extension) => `${target}${extension}`).find(existsSync)
    assert.ok(resolved, `无法载入 ${id}（来自 ${sourcePath}）`)
    return load(resolved)
  }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require)
  return module.exports
}
const model = load('src/lib/workspace.ts')
const tools = load('src/lib/tools.ts')
const drafts = load('src/lib/themeAuthoring/store.ts')
const themes = load('src/lib/themes.ts')
const find = name => {const tool = tools.findTool(name); assert.ok(tool, `公开工具应存在：${name}`); return tool}
const run = async (name, args = {}, context = {}) => {const tool = find(name); return tools.runTool(tool, tool.parseArguments(args), {signal:new AbortController().signal, openPage: () => {throw new Error('主题作者不得导航')}, ...context})}
const version = draft => ({draftId:draft.id,expectedRevision:draft.revision})
const base = () => ({version:model.WORKSPACE_VERSION, pages:[{id:'home',name:'首页',components:[]}], themes:[model.DEFAULT_THEME,model.IOS_THEME,model.PIXEL_THEME,model.SWITCH_THEME,model.WIN98_THEME], theme:{active:'ios',mode:'light',base:'light'}, templates:[], addons:[], statusbar:[]})
let passed = 0
async function test(name, fn) {
  const old=drafts.getThemeDraft(); if(old) drafts.discardThemeDraft(version(old))
  workspace=base();commits=0;history.length=0
  for(const listener of listeners) listener()
  await fn();passed+=1;console.log(`通过：${name}`)
}

await test('六个公开工具可发现且纯主题操作不增加强制审批', async () => {
  const names=['describe_theme_schema','create_theme_draft','get_theme_draft','update_theme_draft','inspect_theme_draft','finish_theme_draft']
  for(const name of names) {assert.equal(find(name).highRisk({}),false);assert.ok(tools.toolSchemas().some(schema=>schema.function.name===name))}
  const schema=JSON.parse(await run('describe_theme_schema',{themeRef:'switch',group:'shell'}))
  assert.ok(JSON.stringify(schema).includes('coverScale'))
  assert.ok(!JSON.stringify(schema).includes('windowGap'))
  assert.equal(commits,0)
  for(const group of [[],['tokens'],{},4,'bad']) await assert.rejects(run('describe_theme_schema',{group}))
})
await test('工具完整派生与原子修改，取消不写正式状态或历史', async () => {
  const before=workspace
  let draft=JSON.parse(await run('create_theme_draft',{from:'switch',intent:'derive',name:'海边主机'}))
  assert.equal(draft.theme.skin,'switch');assert.equal(draft.theme.shell,'switch')
  assert.equal(draft.revision,1)
  draft=JSON.parse(await run('update_theme_draft',{...version(draft),operations:[
    {path:'main',scope:'light',value:'#123456'},{path:'main',scope:'dark',value:'#abcdef'},
    {path:'coverScale',scope:'shell',value:110},{path:'button.radius',scope:'recipe',value:8},{path:'fonts',scope:'resource',value:[]},
  ]}))
  assert.equal(draft.revision,2);assert.equal(draft.theme.light.main,'#123456');assert.equal(draft.theme.dark.main,'#abcdef')
  assert.equal(draft.theme.shellConfig.coverScale,110);assert.equal(draft.theme.recipes.button.radius,8)
  const stable=await run('get_theme_draft')
  for(const operation of [{path:'maim',scope:'both',value:'#123456'},{path:'main',scope:'shared',value:'#123456'},{path:'windowGap',scope:'shell',value:10},{path:'button.radius',scope:'recipe',value:25}]) {
    await assert.rejects(run('update_theme_draft',{...version(draft),operations:[{path:'main',scope:'both',value:'#ff0000'},operation]}))
    assert.equal(await run('get_theme_draft'),stable)
  }
  await assert.rejects(run('finish_theme_draft',{draftId:draft.id,expectedRevision:1,action:'discard'}))
  const report=JSON.parse(await run('inspect_theme_draft',version(draft)))
  assert.equal(report.target.revision,2);assert.deepEqual(report.unknown,['aesthetics'])
  await run('finish_theme_draft',{...version(draft),action:'discard'})
  assert.equal(workspace,before);assert.equal(commits,0);assert.equal(history.length,0)
  assert.equal(JSON.parse(await run('get_theme_draft')),null)
})
await test('应用一次提交且保留期间页面编辑与最新模式；一轮历史能恢复', async () => {
  const draft=JSON.parse(await run('create_theme_draft',{intent:'derive',name:'我的蓝色'}))
  const patched=JSON.parse(await run('update_theme_draft',{...version(draft),operations:[{path:'main',scope:'both',value:'#123456'},{path:'fonts',scope:'resource',value:[]}]}))
  const release=drafts.registerThemeAuthoringPort({prepare:async()=>({ready:true})})
  try {
    workspace={...workspace,pages:[{...workspace.pages[0],name:'编辑期间保留'}],theme:{...workspace.theme,mode:'dark',base:'dark'}}
    const before=workspace
    const result=JSON.parse(await run('finish_theme_draft',{...version(patched),action:'apply'}))
    assert.equal(result.applied,true);assert.equal(commits,1);assert.equal(history.length,1)
    assert.equal(workspace.pages[0].name,'编辑期间保留');assert.equal(workspace.theme.mode,'dark')
    assert.equal(themes.resolveTheme(model.activeTheme(workspace),'dark').values.main,'#123456')
    assert.equal(drafts.getThemeDraft(),null);assert.equal(history[0],before)
  } finally {release()}
})
await test('异步准备期间停止或正式选择 A→B→A，不留下迟到提交', async () => {
  const draft=drafts.createThemeDraft({intent:'derive'})
  let resume,entered
  const reached=new Promise(resolve=>{entered=resolve})
  const release=drafts.registerThemeAuthoringPort({prepare:()=>{entered();return new Promise(resolve=>{resume=resolve})}})
  const controller=new AbortController()
  try {
    const pending=run('finish_theme_draft',{...version(draft),action:'apply'},{signal:controller.signal})
    await reached;controller.abort();resume({ready:true})
    await assert.rejects(pending,{name:'AbortError'});assert.equal(commits,0);assert.equal(drafts.getThemeDraft().id,draft.id)
    store.commit({...workspace,theme:{...workspace.theme,active:'pixel'}})
    store.commit({...workspace,theme:{...workspace.theme,active:'ios'}})
    const before=commits
    const check=run('finish_theme_draft',{...version(draft),action:'apply'})
    await Promise.resolve();resume({ready:true})
    await assert.rejects(check);assert.equal(commits,before)
  } finally {release()}
})

await test('读取草稿只承认当前版本的预览准备状态，旧报告和无宿主不冒充就绪', async () => {
  const draft=drafts.createThemeDraft({intent:'derive'})
  let revision=0
  const release=drafts.registerThemeAuthoringPort({prepare:async()=>({ready:true}),getReadiness:()=>({draftId:draft.id,revision,status:'ready'})})
  try {
    assert.equal(JSON.parse(await run('get_theme_draft')).preview.readiness.status,'pending')
    revision=draft.revision
    assert.equal(JSON.parse(await run('get_theme_draft')).preview.readiness.status,'ready')
    await run('update_theme_draft',{...version(draft),operations:[{path:'main',scope:'both',value:'#123456'}]})
    assert.equal(JSON.parse(await run('get_theme_draft')).preview.readiness.status,'pending')
  } finally {release()}
  assert.equal(JSON.parse(await run('get_theme_draft')).preview.readiness.status,'unavailable')
  assert.equal(commits,0)
})

await test('真实 Agent 分发把非法主题修改记为失败，不把文字错误当成功',async()=>{
  const ai=load('src/lib/ai.ts'), originalFetch=globalThis.fetch
  const draft=drafts.createThemeDraft({intent:'derive'})
  const events=[];let calls=0
  globalThis.fetch=async()=>{
    calls++
    const content=calls===1?[{type:'tool_use',id:'theme-call',name:'update_theme_draft',input:{...version(draft),operations:[{path:'typo',scope:'both',value:'#123456'}]}}]:[{type:'text',text:'字段错误，正式主题未变。'}]
    return new Response(JSON.stringify({id:'fixture-response',type:'message',role:'assistant',content,stop_reason:calls===1?'tool_use':'end_turn',usage:{input_tokens:1,output_tokens:1}}),{headers:{'content-type':'application/json'}})
  }
  try {
    await ai.runAgent({config:{baseUrl:'https://example.invalid',model:'claude-test',protocol:'anthropic',apiKey:'fixture-only'},messages:[{role:'user',content:'预览主题'}],host:{openPage(){}},onDelta(){},onTool:event=>events.push(event)})
    assert.equal(calls,2);assert.equal(events.length,1);assert.equal(events[0].ok,false);assert.equal(commits,0)
    assert.equal(drafts.getThemeDraft().revision,1)
  } finally {globalThis.fetch=originalFetch}
})
console.log(`主题作者工具回归：${passed}/${passed}`)
