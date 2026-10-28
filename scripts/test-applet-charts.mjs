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
    setInterval: () => {throw new Error('趋势示例不应创建定时器')},
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

await test('Applet目录公开LineChart，真实runner保留分类标签、负数与缺失值', async () => {
  assert.ok(COMPONENT_NAMES.includes('LineChart'))
  assert.ok(COMPONENT_NAMES.includes('Bars'))
  const app = harness(`applet({state:{},view:()=>ui.LineChart({labels:['周一','周二','周三'],series:[{name:'净额',values:[0,null,-5]}]})})`)
  try {
    app.send({k:'init',saved:{},viewport:{width:320}})
    await app.waitFor(() => app.tree())
    assert.equal(app.tree().t, 'LineChart')
    assert.deepEqual(app.tree().p, {labels:['周一','周二','周三'],series:[{name:'净额',values:[0,null,-5]}]})
  } finally {app.stop()}
})
const {normalizeLineChart} = load('src/lib/applet/lineChartData.ts')
await test('图表边界保留零/负数/null并计算准确摘要，不变更输入', () => {
  const raw = {labels: ['一', '二', '三', '四'], series: [{name: '净额', values: [0, -5, 12.25, null]}]}
  const before = structuredClone(raw)
  const result = normalizeLineChart(raw)
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.series[0], {name:'净额',tone:'accent',values:[0,-5,12.25,null],summary:{latest:{label:'三',value:12.25},min:-5,max:12.25,missingCount:1}})
  assert.equal(result.data.title, '趋势'); assert.equal(result.data.unit, ''); assert.equal(result.data.height, 220)
  result.data.labels.push('新标签'); result.data.series[0].values.push(100)
  assert.deepEqual(raw, before, '规整结果与业务数组不共用可变引用')
})
await test('稀疏标签数组作为非法unknown输入拒绝，不产生undefined标签', () => {
  const result = normalizeLineChart({labels: new Array(1), series: [{name:'数据',values:[1]}]})
  assert.equal(result.ok, false)
})
await test('格式错误、非有限数字、缺失字段与数据长度错配明确失败，不隐式转为零', () => {
  const good = {labels:['一'],series:[{name:'数据',values:[1]}]}
  const invalid = [null, [], {}, {...good,labels:'一'}, {...good,labels:[1]}, {...good,labels:['字'.repeat(81)]}, {...good,title:''}, {...good,title:'  '}, {...good,title:42}, {...good,unit:1}, {...good,unit:'字'.repeat(17)}, {...good,height:NaN}, {...good,height:'200'}, {...good,series:[]}, {...good,series:[null]}, {...good,series:[{name:' ',values:[1]}]}, {...good,series:[{name:'字'.repeat(81),values:[1]}]}, {...good,series:[{name:'数据',values:[]}]}, {...good,series:[{name:'数据',values:[1],tone:'red'}]}]
  for (const value of [undefined, '2', true, NaN, Infinity, -Infinity, 1e12 + 1]) invalid.push({...good,series:[{name:'数据',values:[value]}]})
  for (const raw of invalid) {
    const result = normalizeLineChart(raw)
    assert.equal(result.ok, false, String(raw))
    assert.equal(typeof result.error, 'string')
    assert.ok(result.error.length > 0)
  }
})
await test('120点和4系列边界保留完整数据，超量明确拒绝，默认系列色与高度约束一致', () => {
  const raw = {labels:Array.from({length:120},(_,i)=>String(i)),series:['甲','乙','丙','丁'].map(name=>({name,values:Array(120).fill(0)})),height:999}
  const result = normalizeLineChart(raw)
  assert.equal(result.ok, true)
  assert.equal(result.data.labels.length,120)
  assert.deepEqual(result.data.series.map(item=>item.tone),['accent','blue','green','orange'])
  assert.equal(result.data.height,360)
  assert.equal(normalizeLineChart({...raw,height:0}).data.height,160)
  assert.equal(normalizeLineChart({...raw,labels:[...raw.labels,'120'],series:raw.series.map(s=>({...s,values:[...s.values,1]}))}).ok,false)
  assert.equal(normalizeLineChart({...raw,series:[...raw.series,{name:'戊',values:Array(120).fill(1)}]}).ok,false)
})
await test('空标签和全缺失是合法空态，单点/常数/极值摘要准确', () => {
  const empty = normalizeLineChart({labels:[],series:[{name:'空',values:[]}]})
  assert.equal(empty.ok,true)
  assert.deepEqual(empty.data.series[0].summary,{latest:null,min:null,max:null,missingCount:0})
  const missing = normalizeLineChart({labels:['一','二'],series:[{name:'缺失',values:[null,null]}]})
  assert.equal(missing.ok,true)
  assert.deepEqual(missing.data.series[0].summary,{latest:null,min:null,max:null,missingCount:2})
  for (const values of [[0],[7,7],[-1e12,1e12]]) {
    const result = normalizeLineChart({labels:values.map((_,i)=>String(i)),series:[{name:'值',values}]})
    assert.equal(result.ok,true)
    assert.deepEqual(result.data.series[0].values,values)
    assert.equal(result.data.series[0].summary.latest.value,values.at(-1))
  }
})
const {TREND_APPLET_SOURCE, TREND_APPLET_EXAMPLE} = load('src/lib/applet/chartExample.ts')
await test('共享趋势示例从空数据开始，经真实runner事件添加记录并保存业务分钟', async () => {
  const app = harness(TREND_APPLET_SOURCE)
  try {
    app.send({k:'init',saved:{},settings:TREND_APPLET_EXAMPLE.settings,viewport:{width:320}})
    await app.waitFor(()=>app.tree())
    const chart = () => app.nodes().find(node=>node.t==='LineChart')
    assert.deepEqual(chart().p.labels,[])
    assert.equal(normalizeLineChart(chart().p).ok,true)
    await app.event('Button',p=>p.label==='添加记录','onClick')
    assert.ok(app.nodes().some(node=>node.p.text==='填写日期或标签'))
    assert.equal(app.messages.filter(m=>m.k==='save').length,0)
    await app.event('Input',p=>p.placeholder==='日期或标签','onChange','周一')
    await app.event('NumberInput',()=>true,'onChange',75)
    await app.event('Button',p=>p.label==='添加记录','onClick')
    assert.deepEqual(chart().p.labels,['周一'])
    assert.deepEqual(chart().p.series[0].values,[75])
    assert.deepEqual(app.messages.filter(m=>m.k==='save').at(-1).data,{records:[{label:'周一',minutes:75}]})
    app.send({k:'context',settings:{unit:'hours',range:'30'},surface:'drawer'})
    await app.waitFor(()=>chart()?.p.unit==='小时')
    assert.deepEqual(chart().p.series[0].values,[1.25])
    assert.ok(app.nodes().some(node=>node.p.text==='最近 30 条 · 已保存 1 条'))
    const saves = app.messages.filter(m=>m.k==='save').length
    app.send({k:'viewport',viewport:{width:900}}); app.send({k:'dark',dark:true})
    await app.waitFor(()=>app.nodes().find(node=>node.t==='Stack' && node.p.direction==='row' && node.p.gap===12))
    assert.deepEqual(chart().p.series[0].values,[1.25])
    assert.equal(app.messages.filter(m=>m.k==='save').length,saves)
    assert.equal(app.messages.some(m=>m.k==='call'),false,'无网络或宿主副作用调用')
    app.send({k:'context',settings:{unit:'hours',range:'30'},surface:'status'})
    await app.waitFor(()=>app.tree()?.t==='Text')
    assert.equal(app.tree().p.text,'1.25 小时')
  } finally {app.stop()}
})
await test('示例观察范围只限制展示且显式注明，持久化全记录恢复不丢失', async () => {
  const records = Array.from({length:8},(_,i)=>({label:`记录${i}`,minutes:i*30}))
  const app = harness(TREND_APPLET_SOURCE)
  try {
    app.send({k:'init',saved:{records},settings:{unit:'minutes',range:'7'},viewport:{width:600}})
    await app.waitFor(()=>app.tree())
    const chart = () => app.nodes().find(node=>node.t==='LineChart')
    assert.deepEqual(chart().p.labels,['记录1','记录2','记录3','记录4','记录5','记录6','记录7'])
    assert.ok(app.nodes().some(node=>node.p.text==='最近 7 条 · 已保存 8 条'))
    app.send({k:'context',settings:{unit:'minutes',range:'120'},surface:'page'})
    await app.waitFor(()=>chart()?.p.labels.length===8)
    assert.deepEqual(chart().p.series[0].values,[0,30,60,90,120,150,180,210])
    assert.equal(app.messages.filter(m=>m.k==='save').length,0,'只改范围不重写记录')
  } finally {app.stop()}
})
await test('示例达到记录上限拒绝新增且不删旧数据，删除最近一条后恢复添加', async () => {
  const records = Array.from({length:120},(_,i)=>({label:`记录${i}`,minutes:i}))
  const app = harness(TREND_APPLET_SOURCE)
  try {
    app.send({k:'init',saved:{records},settings:{unit:'minutes',range:'120'},viewport:{width:320}})
    await app.waitFor(()=>app.tree())
    const chart = () => app.nodes().find(node=>node.t==='LineChart')
    await app.event('Input',()=>true,'onChange','新记录')
    await app.event('Button',p=>p.label==='添加记录','onClick')
    assert.equal(chart().p.labels.length,120)
    assert.equal(chart().p.labels.at(-1),'记录119')
    assert.ok(app.nodes().some(node=>node.p.text==='最多保留 120 条记录，先删除一条再添加'))
    assert.equal(app.messages.filter(m=>m.k==='save').length,0)
    await app.event('Button',p=>p.label==='删除最近一条','onClick')
    await app.event('Button',p=>p.label==='添加记录','onClick')
    const saved = app.messages.filter(m=>m.k==='save').at(-1).data.records
    assert.equal(saved.length,120)
    assert.deepEqual(saved[0],{label:'记录0',minutes:0})
    assert.deepEqual(saved.at(-1),{label:'新记录',minutes:25})
  } finally {app.stop()}
})
console.log(`Applet图表协议回归：${passed}/${passed}`)
