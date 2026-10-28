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
  new Function('module', 'exports', 'require', code)(module, module.exports, id => load(path.resolve(path.dirname(file), `${id}.ts`)))
  cache.set(file, module.exports)
  return module.exports
}
const {COMPONENT_NAMES} = load('src/lib/applet/catalog.ts')
const {buildRunnerDoc} = load('src/lib/applet/runner.ts')
function harness(source) {
  const messages = [], listeners = {}, timers = new Set()
  const sandbox = {
    navigator: {},
    parent: {postMessage: message => messages.push(structuredClone(message))},
    addEventListener: (name, listener) => {listeners[name] = listener},
    setTimeout: (fn, delay) => {const id = setTimeout(() => {timers.delete(id); fn()}, delay); timers.add(id); return id},
    clearTimeout: id => {clearTimeout(id); timers.delete(id)},
    setInterval: () => {throw new Error('记录示例不应创建定时器')},
    clearInterval: () => {},
  }
  sandbox.window = sandbox
  const context = vm.createContext(sandbox)
  vm.runInContext(buildRunnerDoc('').match(/<script>([\s\S]*?)<\/script>/)[1], context)
  vm.runInContext(source, context)
  const send = message => listeners.message({source: sandbox.parent, data: {applet: 1, session: '', ...message}})
  const tree = () => messages.filter(message => message.k === 'view').at(-1)?.tree
  const nodes = () => {const result = []; const visit = node => {if (node) {result.push(node); node.c.forEach(visit)}}; visit(tree()); return result}
  const waitFor = async predicate => {
    const start = Date.now()
    while (!predicate()) {
      assert.equal(messages.find(message => message.k === 'error'), undefined, JSON.stringify(messages))
      assert.ok(Date.now() - start < 2000, `runner等待超时：${JSON.stringify(messages)}`)
      await new Promise(resolve => setTimeout(resolve, 3))
    }
  }
  const event = async (type, predicate, eventName, payload) => {
    const node = nodes().find(node => node.t === type && predicate(node.p))
    assert.ok(node?.p[eventName]?.$fn, `${type}.${eventName}处理器存在`)
    const count = messages.filter(message => message.k === 'view').length
    send({k: 'event', fn: node.p[eventName].$fn, payload})
    await waitFor(() => messages.filter(message => message.k === 'view').length > count)
  }
  return {send, tree, nodes, event, waitFor, messages, stop: () => timers.forEach(clearTimeout)}
}
let passed = 0
async function test(name, run) {await run(); passed++; console.log(`通过：${name}`)}

await test('Applet目录公开DataTable且真实runner保留稳定ID、标量和patch回传', async () => {
  assert.ok(COMPONENT_NAMES.includes('DataTable'))
  assert.ok(COMPONENT_NAMES.includes('Table'))
  const app = harness(`applet({state:{table:{}},view:(s)=>ui.DataTable({columns:[{key:'name',label:'项目'}],rows:[{id:'a',values:{name:false}}],state:s.table,onChange:(patch)=>Object.assign(s.table,patch)})})`)
  try {
    app.send({k:'init',saved:{},viewport:{width:320}})
    await app.waitFor(()=>app.tree())
    assert.equal(app.tree().t,'DataTable')
    assert.deepEqual(app.tree().p.rows,[{id:'a',values:{name:false}}])
    await app.event('DataTable',()=>true,'onChange',{query:'a',page:0})
    await app.event('DataTable',()=>true,'onChange',{selectedIds:['a']})
    assert.deepEqual(app.tree().p.state,{query:'a',page:0,selectedIds:['a']})
  } finally {app.stop()}
})
const {normalizeDataTable,deriveDataTable,dataTableText} = load('src/lib/applet/dataTableData.ts')
const rawTable = (rows=[],state={}) => ({columns:[{key:'name',label:'项目',priority:1},{key:'amount',label:'金额',type:'number'},{key:'note',label:'备注',priority:3}],rows:rows.map(([id,name,amount,note])=>({id,values:{name,amount,note}})),state,selectable:true})
const data = raw => {const result=normalizeDataTable(raw);assert.equal(result.ok,true,result.error);return result.data}
await test('标量校验保留零、负数、false和null，默认状态可用且不共享业务可变对象',()=>{
 const raw=rawTable([['a','首条',0,false],['b','第二条',-2,null]])
 const before=structuredClone(raw),normalized=data(raw)
 assert.deepEqual(normalized.state,{query:'',sort:null,page:0,pageSize:10,selectedIds:[]})
 assert.equal(normalized.title,'记录')
 assert.deepEqual(normalized.columns.map(c=>[c.type,c.priority]),[['text',1],['number',2],['text',3]])
 assert.deepEqual(normalized.rows[0].values,{name:'首条',amount:0,note:false})
 assert.equal(dataTableText(false),'否');assert.equal(dataTableText(null),'—');assert.equal(dataTableText(0),'0')
 normalized.rows[0].values.name='修改';normalized.columns[0].label='新列';normalized.state.selectedIds.push('a')
 assert.deepEqual(raw,before)
})
await test('查询包含隐藏字段和显示布尔值，trim只用于匹配且无匹配不删除原记录',()=>{
 const normalized=data(rawTable([['a','Alpha',0,'隐藏工作内容'],['b','Beta',2,false],['c','Gamma',3,null]]))
 for(const [query,ids] of [[' ALPHA ',['a']],['工作',['a']],['否',['b']],['—',['c']],['不匹配',[]]]){
  const view=deriveDataTable(normalized,{...normalized.state,query})
  assert.deepEqual(view.rows.map(r=>r.id),ids);assert.equal(view.state.query,query);assert.equal(view.totalCount,3)
 }
 assert.equal(normalized.rows.length,3)
})
await test('数字和文本稳定单列排序，null在双向都最后，原始顺序可恢复',()=>{
 const normalized=data(rawTable([['a','B',10,''],['b','a',2,''],['c','A',2,''],['d','C',null,''],['e','D',-3,'']]))
 const sort=(key,direction)=>deriveDataTable(normalized,{...normalized.state,sort:{key,direction}}).rows.map(r=>r.id)
 assert.deepEqual(sort('amount','asc'),['e','b','c','a','d'])
 assert.deepEqual(sort('amount','desc'),['a','b','c','e','d'])
 assert.deepEqual(sort('name','asc'),['b','c','a','d','e'])
 assert.deepEqual(deriveDataTable(normalized).rows.map(r=>r.id),['a','b','c','d','e'])
})
await test('先过滤排序再分页，超出页夹到末页，跨页和隐藏选择按稳定ID保留',()=>{
 const rows=Array.from({length:12},(_,i)=>[String(i),'记录'+i,i,i%2?'工作':'生活'])
 const normalized=data(rawTable(rows,{page:9,pageSize:5,selectedIds:['0','0','11','gone']}))
 const end=deriveDataTable(normalized)
 assert.deepEqual(end.rows.map(r=>r.id),['10','11']);assert.equal(end.state.page,2);assert.equal(end.pageCount,3)
 assert.deepEqual(end.state.selectedIds,['0','11'])
 const view=deriveDataTable(normalized,{...end.state,query:'工作',sort:{key:'amount',direction:'desc'},page:1})
 assert.deepEqual(view.rows.map(r=>r.id),['1']);assert.equal(view.filteredCount,6);assert.deepEqual(view.state.selectedIds,['0','11'])
 const removed={...normalized,rows:normalized.rows.slice(0,10)}
 assert.equal(deriveDataTable(removed).state.page,1);assert.deepEqual(deriveDataTable(removed).state.selectedIds,['0'])
 const empty=deriveDataTable(data(rawTable()))
 assert.equal(empty.pageCount,1);assert.equal(empty.state.page,0);assert.deepEqual(empty.rows,[])
})
await test('非法列、重复ID、缺失自有单元格、错误类型及状态都明确失败',()=>{
 const good=rawTable([['a','项目',1,'备注']])
 const invalid=[null,[],{}, {...good,state:undefined},{...good,state:[]},{...good,columns:[]},{...good,columns:new Array(1)}, {...good,rows:new Array(1)}, {...good,rows:[...good.rows,...good.rows]}, {...good,title:''}, {...good,title:'x'.repeat(81)}, {...good,selectable:1}]
 for(const key of ['_bad','constructor','prototype','a.b','a'.repeat(41)])invalid.push({...good,columns:[{key,label:'列'}]})
 for(const column of [{key:'name',label:''},{key:'name',label:'列',type:'date'},{key:'name',label:'列',priority:0}])invalid.push({...good,columns:[column]})
 invalid.push({...good,columns:[good.columns[0],good.columns[0]]})
 for(const value of [undefined,{},[],()=>1,NaN,Infinity,1e12+1,'x'.repeat(501)])invalid.push({...good,rows:[{id:'a',values:{name:value,amount:1,note:''}}]})
 invalid.push({...good,rows:[{id:'a',values:{name:'n',amount:'1',note:''}}]}, {...good,rows:[{id:'a',values:Object.create({name:'继承',amount:1,note:''})}]})
 for(const state of [{query:1},{query:'x'.repeat(201)},{sort:{key:'unknown',direction:'asc'}},{sort:{key:'name',direction:'up'}},{page:-1},{page:0.5},{page:Infinity},{pageSize:7},{selectedIds:new Array(1)},{selectedIds:['']},{selectedIds:[1]}])invalid.push({...good,state})
 for(const raw of invalid){const result=normalizeDataTable(raw);assert.equal(result.ok,false,JSON.stringify(raw));assert.ok(result.error)}
})
await test('500行8列及文本数值上限可完整读取，超量明确拒绝不截断',()=>{
 const columns=Array.from({length:8},(_,i)=>({key:'c'+i,label:'列'+i}))
 const rows=Array.from({length:500},(_,i)=>({id:String(i),values:Object.fromEntries(columns.map(c=>[c.key,i===0?'字'.repeat(500):1e12]))}))
 const good={columns,rows,state:{pageSize:50,page:9}}
 const normalized=data(good)
 assert.equal(normalized.rows.length,500);assert.equal(deriveDataTable(normalized).rows.at(-1).id,'499')
 assert.equal(normalizeDataTable({...good,rows:[...rows,{id:'500',values:rows[0].values}]}).ok,false)
 assert.equal(normalizeDataTable({...good,columns:[...columns,{key:'c8',label:'额外'}]}).ok,false)
 assert.equal(normalizeDataTable({...good,state:{selectedIds:Array(501).fill('0')}}).ok,false)
})
const {RECORD_APPLET_SOURCE,RECORD_APPLET_EXAMPLE} = load('src/lib/applet/dataTableExample.ts')
await test('共享记录示例从空数据开始，添加真实记录并只保存records和稳定ID计数',async()=>{
 const app=harness(RECORD_APPLET_SOURCE)
 try{
  app.send({k:'init',saved:{},settings:RECORD_APPLET_EXAMPLE.settings,viewport:{width:320}})
  await app.waitFor(()=>app.tree())
  const table=()=>app.nodes().find(n=>n.t==='DataTable')
  assert.equal(table().p.rows.length,0);assert.equal(table().p.state.pageSize,5)
  assert.equal(normalizeDataTable(table().p).ok,true)
  await app.event('Button',p=>p.label==='添加记录','onClick')
  assert.ok(app.nodes().some(n=>n.p.text==='填写项目名称'))
  await app.event('Input',p=>p.placeholder==='项目','onChange','午餐')
  await app.event('NumberInput',()=>true,'onChange',0)
  await app.event('TextArea',()=>true,'onChange','与同事一起')
  await app.event('Button',p=>p.label==='添加记录','onClick')
  assert.deepEqual(table().p.rows,[{id:'record-1',values:{title:'午餐',amount:0,category:'生活',note:'与同事一起'}}])
  const saved=app.messages.filter(m=>m.k==='save').at(-1).data
  assert.deepEqual(Object.keys(saved).sort(),['nextId','records'])
  assert.equal(saved.nextId,2);assert.equal(saved.records.length,1)
  assert.equal(app.messages.some(m=>m.k==='call'),false)
 }finally{app.stop()}
})
await test('快速patch合并保留各状态切片，设置/尺寸/主题更新不保存临时视图',async()=>{
 const records=Array.from({length:7},(_,i)=>({id:'record-'+(i+1),title:'记录'+i,amount:i,category:'工作',note:'备注'}))
 const app=harness(RECORD_APPLET_SOURCE)
 try{
  app.send({k:'init',saved:{records,nextId:8},settings:{pageSize:'5'},viewport:{width:600}})
  await app.waitFor(()=>app.tree())
  const table=()=>app.nodes().find(n=>n.t==='DataTable')
  const fn=table().p.onChange.$fn,views=app.messages.filter(m=>m.k==='view').length
  app.send({k:'event',fn,payload:{query:'记录',page:0}})
  app.send({k:'event',fn,payload:{selectedIds:['record-1','record-7']}})
  await app.waitFor(()=>app.messages.filter(m=>m.k==='view').length>views)
  assert.equal(table().p.state.query,'记录');assert.deepEqual(table().p.state.selectedIds,['record-1','record-7'])
  await app.event('DataTable',()=>true,'onChange',{sort:{key:'amount',direction:'desc'},page:0})
  await app.event('DataTable',()=>true,'onChange',{page:1})
  assert.equal(deriveDataTable(data(table().p)).rows[0].id,'record-2')
  app.send({k:'context',settings:{pageSize:'10'},surface:'drawer'})
  await app.waitFor(()=>table()?.p.state.pageSize===10)
  assert.equal(table().p.state.page,0);assert.equal(table().p.state.query,'记录')
  app.send({k:'viewport',viewport:{width:320}});app.send({k:'dark',dark:true})
  await app.waitFor(()=>app.nodes().some(n=>n.t==='Stack'&&n.p.direction==='column'))
  assert.deepEqual(table().p.rows.map(r=>r.id),records.map(r=>r.id))
  assert.equal(app.messages.filter(m=>m.k==='save').length,0)
  app.send({k:'context',settings:{pageSize:'10'},surface:'status'})
  await app.waitFor(()=>app.tree()?.t==='Text')
  assert.equal(app.tree().p.text,'7 笔记录')
 }finally{app.stop()}
})
await test('按稳定ID批量删除后分页回有效范围，刷新只恢复业务记录和设置',async()=>{
 const records=Array.from({length:6},(_,i)=>({id:'record-'+(i+1),title:'记录'+i,amount:i,category:'生活',note:''}))
 const app=harness(RECORD_APPLET_SOURCE)
 let saved
 try{
  app.send({k:'init',saved:{records,nextId:7},settings:{pageSize:'5'}})
  await app.waitFor(()=>app.tree())
  await app.event('DataTable',()=>true,'onChange',{sort:{key:'amount',direction:'desc'},page:1,selectedIds:['record-1']})
  await app.event('Button',p=>p.label==='删除所选','onClick')
  const p=app.nodes().find(n=>n.t==='DataTable').p
  assert.equal(p.rows.length,5);assert.ok(p.rows.every(r=>r.id!=='record-1'))
  assert.equal(deriveDataTable(data(p)).state.page,0)
  assert.deepEqual(p.state.selectedIds,[])
  saved=app.messages.filter(m=>m.k==='save').at(-1).data
  assert.deepEqual(Object.keys(saved).sort(),['nextId','records'])
 }finally{app.stop()}
 const restored=harness(RECORD_APPLET_SOURCE)
 try{
  restored.send({k:'init',saved,settings:{pageSize:'10'}})
  await restored.waitFor(()=>restored.tree())
  const p=restored.nodes().find(n=>n.t==='DataTable').p
  assert.equal(p.rows.length,5)
  assert.deepEqual(p.state,{query:'',sort:null,page:0,pageSize:10,selectedIds:[]})
  await restored.event('Input',p=>p.placeholder==='项目','onChange','新记录')
  await restored.event('Button',p=>p.label==='添加记录','onClick')
  const rows=restored.nodes().find(n=>n.t==='DataTable').p.rows
  assert.equal(rows[0].id,'record-7');assert.equal(new Set(rows.map(r=>r.id)).size,6)
 }finally{restored.stop()}
})
await test('100条最长中文记录可保存于100KB内，超量及超长输入拒绝且不删旧记录',async()=>{
 const records=Array.from({length:100},(_,i)=>({id:'record-'+(i+1),title:'项'.repeat(80),amount:1e9,category:'生活',note:'注'.repeat(200)}))
 const saved={records,nextId:101},encoded=JSON.stringify(saved)
 assert.ok(encoded.length<100_000);assert.ok(Buffer.byteLength(encoded,'utf8')<100_000)
 const app=harness(RECORD_APPLET_SOURCE)
 try{
  app.send({k:'init',saved,settings:{pageSize:'20'}});await app.waitFor(()=>app.tree())
  await app.event('Input',p=>p.placeholder==='项目','onChange','新项目')
  await app.event('TextArea',()=>true,'onChange','字'.repeat(201))
  await app.event('Button',p=>p.label==='添加记录','onClick')
  assert.ok(app.nodes().some(n=>n.p.text==='备注最多 200 字符'))
  await app.event('TextArea',()=>true,'onChange','')
  await app.event('Button',p=>p.label==='添加记录','onClick')
  assert.ok(app.nodes().some(n=>n.p.text==='最多保留 100 条记录，先删除一些再添加'))
  assert.equal(app.messages.filter(m=>m.k==='save').length,0)
  assert.equal(app.nodes().find(n=>n.t==='DataTable').p.rows.length,100)
  await app.event('DataTable',()=>true,'onChange',{selectedIds:['record-1','record-100']})
  await app.event('Button',p=>p.label==='删除所选','onClick')
  await app.event('Button',p=>p.label==='添加记录','onClick')
  const current=app.messages.filter(m=>m.k==='save').at(-1).data
  assert.equal(current.records.length,99);assert.equal(current.records[0].id,'record-101');assert.equal(current.nextId,102)
  assert.ok(current.records.some(r=>r.id==='record-2'))
  assert.ok(!current.records.some(r=>['record-1','record-100'].includes(r.id)))
 }finally{app.stop()}
})
console.log(`Applet数据表回归：${passed}/${passed}`)
