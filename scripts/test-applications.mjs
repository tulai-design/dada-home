import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 运行真实应用目录、操作、迁移和模板；只隔离与这些数据操作无关的特效及图标。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()
const mocks = new Map([
  [path.resolve(root, 'src/lib/pageIcons.ts'), {isPageIcon: () => true, PAGE_ICON_KEYS: ['home', 'code']}],
  [path.resolve(root, 'src/fx/catalog.ts'), {normalizeLayer: (layer) => layer}],
])
function load(relative) {
  const file = path.resolve(root, relative)
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}
  cache.set(file, module)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = (id) => {
    if (id === 'react') return {useCallback: (fn) => fn, useSyncExternalStore() {}}
    if (id === '@phosphor-icons/react') return new Proxy({}, {get: () => () => null})
    assert.ok(id.startsWith('.'), `未隔离的运行依赖：${id}`)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}
const registry = load('src/lib/registry.ts')
for (const type of ['clock', 'search', 'links', 'note']) registry.registerComponent({type, name: type, defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, ...(type === 'clock' ? {status: () => null} : {})})
registry.registerComponent({type: 'app', name: '沙盒应用', defaultConfig: {html: '', css: '', js: '', height: 320, settings: {}, surface: 'widget'}, configSchema: {html: {kind:'string'}, css: {kind:'string'}, js: {kind:'string'}, height: {kind:'number',min:120,max:900}, settings: {kind:'json'}, surface: {kind:'string'}}, defaultSpan:'half',multiple:true})
registry.registerComponent({type: 'applet', name: '小程序', defaultConfig: {source:'',settings:{},surface:'widget'}, configSchema: {source:{kind:'string'},settings:{kind:'json'},surface:{kind:'string'}}, defaultSpan:'half',multiple:true})
const model = load('src/lib/workspace.ts')
const apps = load('src/lib/applications.ts')
const ops = load('src/lib/ops.ts')
const templates = load('src/lib/templates.ts')
const {migrate} = load('src/lib/workspaceStore.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const base = () => ({...ops.defaultWorkspace(), statusbar: []})
const make = (workspace = base(), patch = {}) => apps.createApplication(workspace, {type:'applet', title:'换算器', config:{source:'applet({view:()=>ui.Text({text:"hello"})})'}, ...patch})
const settingsSchema = {
  precision: {kind:'number', label:'小数位', min:0,max:6,default:2},
  currency: {kind:'select',label:'货币',options:[{value:'CNY',label:'人民币'},{value:'USD',label:'美元'}],default:'CNY'},
  showHint: {kind:'boolean',label:'显示提示',default:true},
  heading: {kind:'string',label:'标题',default:'换算'},
}
let passed = 0
function test(name, run) {run();passed += 1;console.log(`通过：${name}`)}

test('新建应用只进入目录，不自动创建页面或导航，默认弹窗与固定私有id', () => {
  const ws = base();const before=clone(ws)
  const result = make(ws)
  assert.equal(result.workspace.pages.length, ws.pages.length)
  assert.deepEqual(result.workspace.pages, ws.pages)
  assert.equal(result.application.id, result.application.instance.id)
  assert.equal(result.application.openMode, 'modal')
  assert.equal(result.application.dock, false)
  assert.equal(result.application.status, false)
  assert.equal(result.application.statusMode, 'launcher')
  assert.equal(result.application.group, '')
  assert.equal(apps.findApplication(result.workspace, '换算器').id, result.application.id)
  assert.deepEqual(ws,before)
})
test('旧应用按原实例id迁移，纯应用页隐藏Dock，混合页和首页保持', () => {
  const ws = base();delete ws.applications;ws.version=4
  ws.pages.push({id:'tool',name:'工具',label:'工具',components:[{id:'old-app',type:'app',title:'旧游戏',config:{html:'<canvas></canvas>',js:'let score=1'}}]})
  ws.pages.push({id:'mixed',name:'混合',label:'混合',components:[{id:'old-applet',type:'applet',title:'旧计算器',config:{source:'abc'}},{id:'note',type:'note',config:{}}]})
  const migrated=migrate(ws)
  assert.equal(migrated.version,model.WORKSPACE_VERSION)
  assert.equal(migrated.applications.length,2)
  assert.equal(migrated.applications[0].id,'old-app')
  assert.equal(migrated.applications[0].instance.config.html,'<canvas></canvas>')
  assert.equal(migrated.pages.find(p=>p.id==='tool').dock,false)
  assert.equal(migrated.pages.find(p=>p.id==='mixed').dock,undefined)
  assert.equal(migrated.pages[0].dock,undefined)
  assert.deepEqual(migrate(migrated),migrated)
})
test('已有应用目录与显式页面Dock选择往返保留，不重复纳入', () => {
  let {workspace:ws,application}=make()
  ws=apps.configureApplication(ws,application.id,{dock:true,status:true,statusMode:'compact',openMode:'drawer',group:' 日常工具 '})
  ws=apps.mountApplication(ws,application.id,'home','third')
  ws.pages[0].dock=true
  const migrated=migrate(ws)
  assert.equal(migrated.applications.length,1)
  assert.equal(migrated.applications[0].group,'日常工具')
  assert.equal(migrated.applications[0].dock,true)
  assert.equal(migrated.applications[0].status,true)
  assert.equal(migrated.applications[0].statusMode,'compact')
  assert.equal(migrated.applications[0].openMode,'drawer')
  assert.equal(migrated.pages[0].dock,true)
  assert.equal(migrated.pages[0].components.filter(i=>i.id===application.id).length,1)
})
test('设置schema默认值、补丁合并和数值范围生效，非法字段原子失败', () => {
  let {workspace:ws,application}=make(base(),{settingsSchema})
  assert.deepEqual(application.settings,{precision:2,currency:'CNY',showHint:true,heading:'换算'})
  ws=apps.configureApplication(ws,application.id,{settings:{precision:99,showHint:false}})
  assert.deepEqual(apps.findApplication(ws,application.id).settings,{precision:6,currency:'CNY',showHint:false,heading:'换算'})
  const before=clone(ws)
  for(const patch of [{openMode:'popup'},{statusMode:'fullscreen'},{dock:'yes'},{settings:{precision:'2'}},{settings:{unknown:1}},{settings:{currency:'EUR'}},{settingsSchema:{invalid:{kind:'code',label:'bad'}}}]) assert.throws(()=>apps.configureApplication(ws,application.id,patch))
  assert.deepEqual(ws,before)
})
test('每种打开形式注入相同settings和id，不把宿主字段写入源码配置', () => {
  const {workspace:ws,application}=make(base(),{settingsSchema})
  for(const surface of ['modal','drawer','page','widget','status']) {
    const instance=apps.applicationInstance(ws,application.id,surface)
    assert.equal(instance.id,application.id)
    assert.equal(instance.config.surface,surface)
    assert.deepEqual(instance.config.settings,application.settings)
    instance.config.settings.heading='局部副本'
    assert.equal(application.settings.heading,'换算')
  }
  assert.equal(application.instance.config.settings,undefined)
  assert.equal(application.instance.config.surface,undefined)
  const updated=apps.updateApplication(ws,application.id,{config:{source:'new',settings:{heading:'bad'},surface:'page'}})
  assert.equal(updated.application.instance.config.source,'new')
  assert.equal(updated.application.instance.config.settings,undefined)
})
test('小组件移动和移除只改挂载，目录与业务身份持续保留', () => {
  let {workspace:ws,application}=make()
  ws=ops.addPage(ws,{name:'工作',id:'work'}).workspace
  ws=apps.mountApplication(ws,application.id,'home','third')
  ws=apps.mountApplication(ws,application.id,'work','full')
  assert.equal(ws.pages.flatMap(p=>p.components).filter(i=>i.id===application.id).length,1)
  assert.equal(ws.pages.find(p=>p.id==='work').components[0].span,'full')
  ws=apps.mountApplication(ws,application.id,null)
  assert.equal(ws.pages.flatMap(p=>p.components).filter(i=>i.id===application.id).length,0)
  assert.equal(apps.findApplication(ws,application.id).id,application.id)
  const before=clone(ws)
  assert.throws(()=>apps.mountApplication(ws,application.id,'missing'))
  assert.deepEqual(ws,before)
})
test('更新canonical源码和名称同步已有小组件，改分组不改变id与挂载', () => {
  let {workspace:ws,application}=make()
  ws=apps.mountApplication(ws,application.id,'home')
  ws=apps.updateApplication(ws,application.id,{name:'新换算器',config:{source:'next'},group:'办公'}).workspace
  const instance=ws.pages[0].components.find(i=>i.id===application.id)
  assert.equal(instance.title,'新换算器')
  assert.equal(instance.config.source,'next')
  assert.equal(apps.findApplication(ws,application.id).group,'办公')
  ws=apps.configureApplication(ws,application.id,{group:''})
  assert.equal(apps.findApplication(ws,'新换算器').id,application.id)
})
test('旧add/update/remove组件操作与独立目录同步，移除页面不卸载应用', () => {
  let ws=base()
  const added=ops.addComponent(ws,{pageId:'home',type:'applet',title:'旧路径',config:{source:'original'}})
  ws=added.workspace
  assert.equal(ws.applications[0].id,added.instance.id)
  ws=ops.updateComponent(ws,added.instance.id,{config:{source:'changed'},title:'同步名称'}).workspace
  assert.equal(apps.findApplication(ws,added.instance.id).instance.config.source,'changed')
  assert.equal(apps.findApplication(ws,added.instance.id).instance.title,'同步名称')
  ws=ops.removeComponent(ws,added.instance.id).workspace
  assert.equal(ws.applications.length,1)
  ws=ops.addPage(ws,{id:'tool',name:'工具'}).workspace
  ws=apps.mountApplication(ws,added.instance.id,'tool')
  ws=ops.removePage(ws,'tool')
  assert.equal(apps.findApplication(ws,added.instance.id).id,added.instance.id)
})
test('卸载清理应用目录、Dock状态入口和所有挂载，保留其他应用及数据对象', () => {
  let {workspace:ws,application}=make(base(),{dock:true,status:true})
  ws=apps.mountApplication(ws,application.id,'home')
  const other=make(ws,{title:'其他应用'})
  ws={...other.workspace,exampleBusinessData:{kept:true}}
  const before=clone(ws)
  const removed=apps.removeApplication(ws,application.id)
  assert.equal(removed.applications.length,1)
  assert.equal(removed.applications[0].id,other.application.id)
  assert.ok(!removed.pages.some(p=>p.components.some(i=>i.id===application.id)))
  assert.deepEqual(removed.exampleBusinessData,{kept:true})
  assert.deepEqual(ws,before)
})
test('状态栏容量计入系统状态项，达到上限拒绝新增且不修改已有应用', () => {
  let {workspace:ws,application}=make()
  ws.statusbar=Array.from({length:model.MAX_STATUS_ITEMS},(_,i)=>({id:`status-${i}`,type:'clock',config:{}}))
  const before=clone(ws)
  assert.throws(()=>apps.configureApplication(ws,application.id,{status:true}),/状态栏最多/)
  assert.throws(()=>make(ws,{status:true}),/状态栏最多/)
  assert.deepEqual(ws,before)
  const imported=migrate({...ws,applications:ws.applications.map(app=>({...app,status:true}))})
  assert.equal(imported.applications[0].status,false)
})
test('模板与导入保留完整应用库、分组、设置、同id业务身份及现有未挂载应用', () => {
  let {workspace:ws,application}=make(base(),{settingsSchema,group:'生活',dock:true,openMode:'page',statusMode:'compact'})
  ws=apps.mountApplication(ws,application.id,'home')
  const saved=templates.saveTemplate(ws,{name:'我的工具桌'})
  const other=make(saved.workspace,{title:'后来安装'})
  const applied=templates.applyTemplate(other.workspace,saved.template.id).workspace
  assert.equal(applied.applications.length,2)
  assert.equal(apps.findApplication(applied,application.id).group,'生活')
  assert.equal(apps.findApplication(applied,application.id).statusMode,'compact')
  assert.equal(apps.findApplication(applied,application.id).settings.precision,2)
  assert.equal(apps.findApplication(applied,other.application.id).id,other.application.id)
  const migrated=migrate(saved.workspace)
  const snapshot=migrated.templates[0].snapshot
  assert.equal(snapshot.applications[0].id,application.id)
  assert.equal(snapshot.applications[0].statusMode,'compact')
  assert.equal(snapshot.pages[0].components.find(i=>i.id===application.id).id,application.id)
  snapshot.applications[0].settings.precision=5
  assert.equal(saved.workspace.applications[0].settings.precision,2)
})
test('坏导入条目隔离，重复id不重复纳入，超出安装上限明确拒绝', () => {
  const {workspace:ws,application}=make()
  const read=apps.readApplications([null,{id:'broken',instance:{type:'clock'}},application,application],[])
  assert.equal(read.length,1)
  assert.equal(apps.readApplications([{...application,statusMode:'bad'}],[])[0].statusMode,'launcher')
  const full={...ws,applications:Array.from({length:model.MAX_APPLICATIONS},(_,i)=>({...application,id:`app-${i}`,instance:{...application.instance,id:`app-${i}`}}))}
  assert.throws(()=>make(full),/应用最多/)
  assert.throws(()=>apps.createApplication(ws,{type:'note'}),/只能是 app/)
})
console.log(`应用目录回归全部通过：${passed}/${passed}`)
