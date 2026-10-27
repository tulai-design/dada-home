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
function harness(source) {
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
  const script = buildRunnerDoc('').match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInContext(script, context)
  vm.runInContext(source, context)
  const send = (message) => listeners.message({data: {applet: 1, ...message}})
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
  return {send, text, waitFor, messages, intervals, stop: () => {timeouts.forEach(clearTimeout); intervals.forEach(clearInterval)}}
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
console.log(`全部通过：${passed}/${passed} 个小程序运行时回归。`)
