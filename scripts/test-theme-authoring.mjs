import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 执行真实主题领域与读取模块；不触碰用户数据、网络或浏览器。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map(), mocks = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}; cache.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === 'react') return {useCallback: fn => fn, useSyncExternalStore() {}}
    assert.ok(id.startsWith('.'), `未隔离的外部依赖：${id}`)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', 'localStorage', compiled)(module, module.exports, require, {getItem: () => null, setItem() {}})
  return module.exports
}
const model = load('src/lib/workspace.ts'), themes = load('src/lib/themes.ts')
const clone = value => JSON.parse(JSON.stringify(value))
const base = (active = 'ios') => ({
  version: model.WORKSPACE_VERSION, pages: [{id: 'home', name: '首页', label: '首页', components: []}],
  statusbar: [], addons: [], widgets: [], network: [], templates: [], applications: [],
  layout: {columns: 12, maxWidth: 1440}, theme: {active, mode: 'light', base: 'dark', frameOff: true}, themes: themes.readThemes([]),
})
// Red：当前清理器接受拼错的未消费变量，作者边界必须明确拒绝。
assert.throws(() => themes.assertThemeEntry({...model.IOS_THEME, overrides: {...model.IOS_THEME.overrides, maim: '#123456'}}), /maim|字段|变量/)
console.log('通过：未知主题字段在真实数据边界被拒绝')
const catalog = load('src/lib/themeAuthoring/catalog.ts')
const validation = load('src/lib/themeAuthoring/validation.ts')
const domain = load('src/lib/themeAuthoring/draft.ts')
let checked = 0
function test(name, run) {run(); checked += 1; console.log(`通过：${name}`)}
test('合法长名称派生后仍可继续修改和应用', () => {
  const workspace=base()
  const source={...clone(model.IOS_THEME),id:'long-title',name:'12345678901234567890'}
  delete source.builtin
  workspace.themes.push(source)
  const draft=domain.createDraft(workspace,{from:source.id,intent:'derive'},0)
  assert.equal(draft.theme.name.length,20)
  const patched=domain.patchDraft(draft,{draftId:draft.id,expectedRevision:1,operations:[{path:'main',scope:'both',value:'#123456'}]})
  assert.equal(model.activeTheme(domain.buildDraftCommit(workspace,patched,0)).light.main,'#123456')
})
test('字体资源接管角色后，别名循环判断与真实解析使用同一有效字体层', () => {
  const next=validation.applyThemeOperations(model.SWITCH_THEME,[
    {path:'fonts',scope:'resource',value:[{family:'Playfair Display',role:'serif'}]},
    {path:'font-sans',scope:'shared',value:'var(--font-serif)'},
  ])
  const resolved=themes.resolveTheme(next,'light')
  assert.match(resolved.values['font-serif'],/Playfair Display/)
  assert.equal(resolved.values['font-sans'],'var(--font-serif)')
})
for (const theme of themes.readThemes([])) test(`${theme.id}通过同目录完整校验`, () => themes.assertThemeEntry(theme))
test('目录描述与工具schema来自同一字段集且schema紧凑', () => {
  const fields = catalog.listThemeFields(model.SWITCH_THEME)
  assert.ok(fields.every(field => field.label && field.description && field.storage))
  const schema = catalog.themePatchJsonSchema(model.SWITCH_THEME)
  assert.deepEqual(schema.items.properties.path.enum, fields.map(field => field.path))
  assert.ok(JSON.stringify(catalog.themePatchJsonSchema()).length < 3000)
  assert.equal(fields.some(field => field.path === 'windowGap'), false)
})
test('严格颜色语法、作用域、受控字体和空未知recipe拒绝', () => {
  for (const color of ['rgb(1,,2,3)', 'rgb(1,2,3 / .5)', 'rgb(10%, 20, 30)', 'rgba(1 2 3 .5)', 'oklch(1, .2, 40)', 'rgb(999 2 3)', 'url(https://example.com)']) assert.equal(validation.isThemeColor(color), false, color)
  for (const color of ['#abc', '#12345678', 'rgba(1, 2, 3, .5)', 'rgb(10% 20% 30% / 50%)', 'hsl(200 50% 50%)', 'oklch(70% .1 40)']) assert.equal(validation.isThemeColor(color), true, color)
  assert.throws(() => validation.applyThemeOperations(model.IOS_THEME, [{path:'main',scope:'shared',value:'#123456'}]), /作用域/)
  assert.throws(() => themes.assertThemeEntry({...model.IOS_THEME,recipes:{other:{}}}), /recipe/)
  assert.throws(() => themes.assertThemeEntry({...model.IOS_THEME,overrides:{...model.IOS_THEME.overrides,'font-sans':'Unregistered Fancy Font'}}), /字体/)
  assert.throws(() => themes.assertThemeEntry({...model.SWITCH_THEME,overrides:{...model.SWITCH_THEME.overrides,'font-sans':'var(--font-serif)'}}), /循环/)
})
test('原子patch保留源，both模式、真实recipe/config与系统字体生效', () => {
  const source = clone(model.SWITCH_THEME)
  const next = validation.applyThemeOperations(source,[{path:'main',scope:'both',value:'#123456'},{path:'button.radius',scope:'recipe',value:9},{path:'coverScale',scope:'shell',value:110},{path:'fonts',scope:'resource',value:[]}])
  assert.deepEqual(source,model.SWITCH_THEME)
  assert.deepEqual(next.fonts,[])
  assert.equal(themes.resolveTheme(next,'light').values['font-sans'],load('src/lib/fonts.ts').DEFAULT_STACKS.sans)
  assert.throws(()=>validation.applyThemeOperations(source,[{path:'fonts',scope:'resource',value:[{family:'Roboto',role:'sans'}]},{path:'font-sans',scope:'shared',value:'system-ui'}]),/同时/)
  assert.equal(next.shellConfig.coverScale,110)
  for(const mode of ['light','dark']) {
    const resolved=themes.resolveTheme(next,mode)
    assert.equal(resolved.values.main,'#123456')
    assert.equal(resolved.values['recipe-button-radius'],'9px')
    assert.equal(resolved.values['switch-cover-scale'],'1.1')
  }
  assert.throws(()=>validation.applyThemeOperations(source,[{path:'main',scope:'both',value:'#123456'},{path:'windowGap',scope:'shell',value:10}]),/不支持/)
  assert.deepEqual(source,model.SWITCH_THEME)
  assert.throws(()=>validation.applyThemeOperations(source,[{path:'main',scope:'both',value:'#123456'},{path:'main',scope:'dark',value:'#234567'}]),/重复/)
})
test('纯草稿只提交最新workspace主题部分；source/选择/版本冲突不覆盖', () => {
  const ws=base('switch'), draft=domain.createDraft(ws,{intent:'derive',name:'主题事务'},4)
  const updated=domain.patchDraft(draft,{draftId:draft.id,expectedRevision:1,operations:[{path:'coverScale',scope:'shell',value:115}]})
  assert.equal(updated.revision,2)
  assert.throws(()=>domain.patchDraft(updated,{draftId:draft.id,expectedRevision:1,name:'过期'}),/过期/)
  const latest={...ws,pages:[...ws.pages,{id:'new-page',name:'新增页面',components:[]}],dock:{preset:'bar'}}
  const applied=domain.buildDraftCommit(latest,updated,4)
  assert.equal(applied.pages,latest.pages)
  assert.equal(applied.dock,latest.dock)
  assert.equal(applied.theme.mode,latest.theme.mode)
  assert.equal(model.activeTheme(applied).shellConfig.coverScale,115)
  assert.throws(()=>domain.buildDraftCommit(ws,updated,6),/选择/)
  const changed={...ws,themes:ws.themes.map(theme=>theme.id==='switch'?{...theme,name:'已改名'}:theme)}
  assert.throws(()=>domain.buildDraftCommit(changed,updated,4),/来源/)
  assert.throws(()=>domain.createDraft(ws,{intent:'edit'}),/内置/)
})

// Store通过真实公开操作边界运行；仅替换持久化端口，不mock事务实现。
let latest = base('switch'), history = [], workspaceListeners = new Set()
const write = workspace => {history.push(latest); latest=workspace; workspaceListeners.forEach(listener=>listener())}
mocks.set(path.resolve(root,'src/lib/workspaceStore.ts'),{getWorkspace:()=>latest,commit:write,subscribeWorkspace:listener=>{workspaceListeners.add(listener);return()=>workspaceListeners.delete(listener)}})
const store = load('src/lib/themeAuthoring/store.ts')
function discard() {const draft=store.getThemeDraft(); if(draft)store.discardThemeDraft({draftId:draft.id,expectedRevision:draft.revision})}
async function asyncTest(name,run) {await run();checked+=1;console.log(`通过：${name}`)}
await asyncTest('异步prepare后重新核对选择A→B→A，保留草稿并释放lease',async()=>{
 let resume,released=0
 const unregister=store.registerThemeAuthoringPort({prepare:()=>new Promise(resolve=>{resume=resolve})})
 const draft=store.createThemeDraft({intent:'derive'})
 const pending=store.applyThemeDraft({draftId:draft.id,expectedRevision:draft.revision})
 write({...latest,theme:{...latest.theme,active:'ios'}})
 write({...latest,theme:{...latest.theme,active:'switch'}})
 const before=history.length
 resume({ready:true,release:()=>released++})
 await assert.rejects(pending,/选择/)
 assert.equal(history.length,before);assert.equal(released,1);assert.equal(store.getThemeDraft().id,draft.id)
 discard();unregister()
})
await asyncTest('资源等待期间patch立即取消旧准备，业务编辑保留且成功仅一次commit/undo',async()=>{
 let resume,preparingSignal,released=0
 const unregister=store.registerThemeAuthoringPort({prepare:({signal})=>{preparingSignal=signal;return new Promise(resolve=>{resume=resolve})}})
 const draft=store.createThemeDraft({intent:'derive',name:'作者方案'})
 const pending=store.applyThemeDraft({draftId:draft.id,expectedRevision:draft.revision})
 const changed=store.updateThemeDraft({draftId:draft.id,expectedRevision:1,name:'修改后的草稿'})
 assert.equal(preparingSignal.aborted,true)
 resume({ready:true,release:()=>released++});await assert.rejects(pending,{name:'AbortError'});assert.equal(released,1)
 unregister()
 const immediate=store.registerThemeAuthoringPort({prepare:async()=>({ready:true,release:()=>released++})})
 write({...latest,pages:[...latest.pages,{id:'during',name:'期间编辑',components:[]}]})
 const before=latest,count=history.length
 await store.applyThemeDraft({draftId:changed.id,expectedRevision:changed.revision})
 assert.equal(history.length,count+1);assert.equal(latest.pages,before.pages);assert.equal(history.at(-1),before)
 assert.equal(store.getThemeDraft(),null);assert.equal(model.activeTheme(latest).name,'修改后的草稿')
 immediate()
})
await asyncTest('丢弃草稿立即停止准备中的资源，不等字体超时',async()=>{
 let signal,released=0
 const unregister=store.registerThemeAuthoringPort({prepare:request=>new Promise(resolve=>{
   signal=request.signal
   signal.addEventListener('abort',()=>{released++;resolve({ready:false,reason:'取消'})},{once:true})
 })})
 const draft=store.createThemeDraft({intent:'derive'}),before=history.length
 const pending=store.applyThemeDraft({draftId:draft.id,expectedRevision:draft.revision})
 discard()
 assert.equal(signal.aborted,true);assert.equal(released,1)
 await assert.rejects(pending,{name:'AbortError'})
 assert.equal(history.length,before);assert.equal(store.getThemeDraft(),null)
 unregister()
})
await asyncTest('取消/资源失败/AbortError不提交且释放临时资源',async()=>{
 let released=0
 let unregister=store.registerThemeAuthoringPort({prepare:async()=>({ready:false,reason:'字体404',release:()=>released++})})
 let draft=store.createThemeDraft({intent:'derive'})
 let before=history.length
 await assert.rejects(store.applyThemeDraft({draftId:draft.id,expectedRevision:1}),/404/)
 assert.equal(history.length,before);assert.equal(released,1)
 discard();assert.equal(history.length,before);unregister()
 const abort=new AbortController()
 unregister=store.registerThemeAuthoringPort({prepare:async()=>{abort.abort();return{ready:true,release:()=>released++}}})
 draft=store.createThemeDraft({intent:'derive'})
 await assert.rejects(store.applyThemeDraft({draftId:draft.id,expectedRevision:1},{signal:abort.signal}),error=>error.name==='AbortError')
 assert.equal(history.length,before);assert.equal(released,2)
 discard();unregister()
})
test('edit精确替换源主题，派生新字段经读取与保存往返',()=>{
  const ws=themes.saveTheme(base('win98'),{name:'定制桌面',recipes:{input:{radius:7}},shellConfig:{windowGap:18},fonts:[]}).workspace
  const draft=domain.createDraft(ws,{intent:'edit'},3)
  const updated=domain.patchDraft(draft,{draftId:draft.id,expectedRevision:1,operations:[{path:'windowGap',scope:'shell',value:22}]})
  const result=domain.buildDraftCommit(ws,updated,3)
  assert.equal(result.themes.length,ws.themes.length)
  assert.equal(result.theme.active,ws.theme.active)
  const entry=model.activeTheme(result)
  assert.equal(entry.shellConfig.windowGap,22)
  const read=themes.readThemes(JSON.parse(JSON.stringify(result.themes))).find(theme=>theme.id===entry.id)
  assert.deepEqual(read,entry)
  const renamed=themes.saveTheme(result,{id:entry.id,name:'改名保留',activate:false}).theme
  assert.deepEqual(renamed.recipes,entry.recipes);assert.deepEqual(renamed.shellConfig,entry.shellConfig);assert.deepEqual(renamed.fonts,[])
})
console.log(`主题作者领域/事务回归：${checked} 项通过`)
