import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const modules = new Map()
function load(url) {
  if(modules.has(url.href))return modules.get(url.href)
  const module = {exports:{}}
  modules.set(url.href,module.exports)
  const source=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInThisContext(`(function(module,exports,require){${source}\n})`)(module,module.exports,id=>load(new URL(`${id}.ts`,url)))
  return module.exports
}
const {acquireThemeFonts, fontVars, DEFAULT_STACKS} = load(new URL('../src/lib/fonts.ts',import.meta.url))
const turn = () => new Promise(resolve => setImmediate(resolve))
function documentFixture(load = async () => [{status: 'loaded'}]) {
  const links = [], requests = [], faces = new Set()
  const doc = {
    head: {appendChild(link) {links.push(link); requests.push(link); return link}},
    createElement(tag) {
      assert.equal(tag, 'link')
      return {dataset: {}, onload: null, onerror: null, remove() {const index = links.indexOf(this); if (index >= 0) links.splice(index, 1)}}
    },
    fonts: {load, check: () => true, add:face=>faces.add(face),delete:face=>faces.delete(face)},
    defaultView:{FontFace:class {constructor(family,bytes){this.family=family;this.bytes=bytes;this.status='unloaded'}async load(){this.status='loaded';return this}}},
    documentElement: {style: {setProperty() {throw Error('resource prepare mutated root')}}},
  }
  return {doc, links, requests, faces}
}
const fonts = [{family: 'Noto Sans SC', role: 'sans'}]

{
  const fixture = documentFixture()
  const lease = acquireThemeFonts(fixture.doc, [])
  assert.deepEqual(await lease.ready, {ready: true, fonts: []})
  assert.equal(fixture.requests.length, 0)
  assert.equal(fontVars([])['font-sans'], DEFAULT_STACKS.sans)
  assert.match(fontVars(undefined)['font-sans'], /Noto Sans SC/)
  lease.release()
  console.log('通过：明确系统后备零网络；默认字体与系统栈清晰区分')
}
{
  const fixture = documentFixture()
  const lease = acquireThemeFonts(fixture.doc, undefined)
  assert.equal(fixture.requests.length, 4)
  for (const link of fixture.links) link.onload()
  assert.equal((await lease.ready).ready, true)
  assert.ok(fixture.links.every(link => link.href.startsWith('https://fonts.googleapis.com/')))
  lease.release()
  assert.equal(fixture.links.length, 0)
  console.log('通过：默认四字体也走受控lease并完整清理')
}
{
  const fixture = documentFixture(() => new Promise(() => {}))
  const lease = acquireThemeFonts(fixture.doc, fonts)
  let settled = false
  void lease.ready.then(() => {settled = true})
  await turn()
  assert.equal(settled, false)
  fixture.links[0].onload()
  await turn()
  assert.equal(settled, false)
  lease.release()
  assert.equal((await lease.ready).ready, false)
  console.log('通过：仅stylesheet onload不表示字体可用；取消等待立即结束')
}
{
  const resolvers = []
  const fixture = documentFixture(() => new Promise(resolve => resolvers.push(resolve)))
  const a = acquireThemeFonts(fixture.doc, fonts)
  const b = acquireThemeFonts(fixture.doc, [{family: 'noto sans sc'}])
  assert.equal(fixture.links.length, 1)
  fixture.links[0].onload()
  resolvers.forEach(resolve => resolve([{status: 'loaded'}]))
  assert.equal((await a.ready).ready, true)
  assert.equal((await b.ready).ready, true)
  a.release()
  assert.equal(fixture.links.length, 1)
  b.release()
  assert.equal(fixture.links.length, 0)
  console.log('通过：同family去重、实际FontFaceSet检查及消费者引用计数')
}
{
  const a = documentFixture(), b = documentFixture()
  const first = acquireThemeFonts(a.doc, fonts), second = acquireThemeFonts(b.doc, fonts)
  a.links[0].onerror()
  b.links[0].onload()
  assert.match((await first.ready).fonts[0].reason, /样式表/)
  assert.equal((await second.ready).ready, true)
  first.release()
  assert.equal(b.links.length, 1)
  second.release()
  console.log('通过：正式与preview文档独立；一个文档失败/释放不卸另一个字体')
}
{
  for (const load of [async () => [], async () => {throw Error('CSP')}, () => new Promise(() => {})]) {
    const fixture = documentFixture(load)
    const lease = acquireThemeFonts(fixture.doc, fonts, {timeoutMs: 12})
    fixture.links[0].onload()
    assert.equal((await lease.ready).ready, false)
    assert.equal(fixture.links.length, 0)
    lease.release()
  }
  console.log('通过：字体文件缺失、CSP/网络异常、超时均明确失败并移除link')
}
{
  const fixture = documentFixture()
  const first = acquireThemeFonts(fixture.doc, fonts)
  const lateError = fixture.links[0].onerror
  const lateLoad = fixture.links[0].onload
  first.release()
  const second = acquireThemeFonts(fixture.doc, fonts)
  lateError(); lateLoad()
  assert.equal(fixture.links.length, 1)
  fixture.links[0].onload()
  assert.equal((await second.ready).ready, true)
  second.release()
  console.log('通过：A→B→A迟到回调无法卸载新一代同名字体lease')
}
{
  const fixture = documentFixture()
  const first = acquireThemeFonts(fixture.doc, fonts)
  const lateError = fixture.links[0].onerror
  fixture.links[0].onerror()
  assert.equal((await first.ready).ready, false)
  const retry = acquireThemeFonts(fixture.doc, fonts)
  assert.equal(fixture.requests.length, 2)
  first.release(); lateError()
  assert.equal(fixture.links.length, 1)
  fixture.links[0].onload()
  assert.equal((await retry.ready).ready, true)
  retry.release()
  console.log('通过：正式主题保留系统后备时，临时prepare可重新请求失败字体并恢复')
}
{
  const fixture = documentFixture()
  const first = acquireThemeFonts(fixture.doc, [{family: 'Font A'}, {family: 'Font B'}, {family: 'Font C'}, {family: 'Font D'}])
  const abort = new AbortController()
  const second = acquireThemeFonts(fixture.doc, [{family: 'Font E'}, {family: 'Font F'}], {signal: abort.signal})
  assert.equal(fixture.requests.length, 4)
  abort.abort()
  assert.equal((await second.ready).ready, false)
  first.release()
  assert.equal(fixture.requests.length, 4)
  assert.equal(fixture.links.length, 0)
  const alreadyAborted = acquireThemeFonts(fixture.doc, fonts, {signal: abort.signal})
  assert.equal((await alreadyAborted.ready).ready, false)
  assert.equal(fixture.requests.length, 4)
  console.log('通过：每document最多四个并发，排队与预取消均无多余网络或迟到存活资源')
}
const resourceApi = load(new URL('../src/lib/fontResource.ts',import.meta.url))
const file=readFileSync(new URL('../node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2',import.meta.url))
const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)
const ref={packageId:'test.font',version:'1.0.0',digest:'a'.repeat(64),resourceId:'Main',sha256:await resourceApi.sha256Bytes(bytes)}
const local=[{family:'Same Family',role:'sans',resource:ref}]
{
  assert.equal(resourceApi.validateWoff2Bytes(bytes),bytes)
  for(const patch of [{resourceId:'../escape'},{version:'^1.0.0'},{sha256:'X'.repeat(64)},{digest:'a'.repeat(63)},{extra:true}])assert.throws(()=>resourceApi.cleanLocalThemeFontRef({...ref,...patch}))
  for(const mutate of [array=>array.setUint32(0,0),array=>array.setUint32(8,1),array=>array.setUint32(16,0xffffffff),array=>array.setUint16(12,0)]){
    const bad=bytes.slice(0);mutate(new DataView(bad));assert.throws(()=>resourceApi.validateWoff2Bytes(bad))
  }
  await assert.rejects(resourceApi.verifyLocalThemeFontBytes({...ref,sha256:'0'.repeat(64)},bytes),/摘要/)
  console.log('通过：真实WOFF2字节头/预算与sha严格验证，资源身份拒路径/版本范围/额外字段')
}
{
  const fixture=documentFixture()
  let reads=0
  const reader=async()=>{reads++;return bytes.slice(0)}
  const a=acquireThemeFonts(fixture.doc,local,{localResources:reader})
  assert.equal((await a.ready).ready,true)
  const b=acquireThemeFonts(fixture.doc,local,{localResources:reader})
  assert.equal((await b.ready).ready,true)
  assert.equal(reads,2)
  assert.equal(fixture.requests.length,0)
  assert.equal(fixture.faces.size,1)
  assert.match(fontVars(local)['font-sans'],new RegExp(`TadaLocal_${ref.sha256}`))
  a.release();assert.equal(fixture.faces.size,1)
  b.release();assert.equal(fixture.faces.size,0)
  console.log('通过：本地资源FontFace无URL/网络，按sha别名去重、每次新consumer重核门禁与引用计数')
}
{
  const a=documentFixture(),b=documentFixture()
  const reader=async()=>bytes.slice(0)
  const first=acquireThemeFonts(a.doc,local,{localResources:reader}),second=acquireThemeFonts(b.doc,local,{localResources:reader})
  assert.equal((await first.ready).ready,true);assert.equal((await second.ready).ready,true)
  first.release();assert.equal(a.faces.size,0);assert.equal(b.faces.size,1)
  const denied=acquireThemeFonts(b.doc,local,{localResources:async()=>{throw Error('disabled')}})
  assert.equal((await denied.ready).ready,false)
  denied.release();assert.equal(b.faces.size,1)
  second.release();assert.equal(b.faces.size,0)
  console.log('通过：正式/preview本地face独立；成功缓存不绕过停用权限，拒绝消费者不卸其他lease')
}
{
  const fixture=documentFixture()
  const pending=[]
  fixture.doc.defaultView.FontFace=class {constructor(family){this.family=family;this.status='loading'}load(){return new Promise(resolve=>pending.push(()=>{this.status='loaded';resolve(this)}))}}
  const first=acquireThemeFonts(fixture.doc,local,{localResources:async()=>bytes.slice(0)})
  while(!pending.length)await turn()
  first.release()
  const second=acquireThemeFonts(fixture.doc,local,{localResources:async()=>bytes.slice(0)})
  while(pending.length<2)await turn()
  pending[1]();assert.equal((await second.ready).ready,true)
  pending[0]();await turn()
  assert.equal(fixture.faces.size,1)
  second.release();assert.equal(fixture.faces.size,0)
  console.log('通过：取消后迟到本地FontFace.load不能重新add或卸载新generation')
}
{
  const {cleanFonts, readFonts} = load(new URL('../src/lib/fonts.ts',import.meta.url))
  const roles = ['sans', 'serif'].map(role => ({...local[0], role}))
  assert.deepEqual(cleanFonts([...roles, {...roles[0]}]), roles)
  assert.deepEqual(readFonts(JSON.parse(JSON.stringify(roles))), roles)
  const vars = fontVars(readFonts(roles))
  for (const role of ['sans', 'serif']) assert.match(vars[`font-${role}`], new RegExp(`TadaLocal_${ref.sha256}`))
  const fixture = documentFixture()
  let loads = 0, reads = 0
  fixture.doc.defaultView.FontFace = class {
    constructor() {this.status = 'unloaded'}
    async load() {loads++; this.status = 'loaded'; return this}
  }
  const reader = async () => {reads++; return bytes.slice(0)}
  const first = acquireThemeFonts(fixture.doc, roles, {localResources: reader})
  assert.equal((await first.ready).ready, true)
  assert.equal(loads, 1)
  assert.equal(reads, 1)
  assert.equal(fixture.faces.size, 1)
  const second = acquireThemeFonts(fixture.doc, roles, {localResources: reader})
  assert.equal((await second.ready).ready, true)
  assert.equal(loads, 1)
  assert.equal(reads, 2)
  assert.equal(fixture.faces.size, 1)
  first.release(); assert.equal(fixture.faces.size, 1)
  second.release(); assert.equal(fixture.faces.size, 0)
  assert.equal(fixture.requests.length, 0)
  console.log('通过：同资源多角色完整保留设计，物理FontFace只加载一次且跨lease引用计数独立')
}
console.log('主题字体资源回归全部通过：14/14')
