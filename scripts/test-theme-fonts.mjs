import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const module = {exports: {}}
const source = ts.transpileModule(readFileSync(new URL('../src/lib/fonts.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
vm.runInThisContext(`(function(module,exports,require){${source}\n})`)(module, module.exports, () => ({WorkspaceError: Error}))
const {acquireThemeFonts, fontVars, DEFAULT_STACKS} = module.exports
const turn = () => new Promise(resolve => setImmediate(resolve))
function documentFixture(load = async () => [{status: 'loaded'}]) {
  const links = [], requests = []
  const doc = {
    head: {appendChild(link) {links.push(link); requests.push(link); return link}},
    createElement(tag) {
      assert.equal(tag, 'link')
      return {dataset: {}, onload: null, onerror: null, remove() {const index = links.indexOf(this); if (index >= 0) links.splice(index, 1)}}
    },
    fonts: {load, check: () => true},
    documentElement: {style: {setProperty() {throw Error('resource prepare mutated root')}}},
  }
  return {doc, links, requests}
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
console.log('主题字体资源回归全部通过：9/9')
