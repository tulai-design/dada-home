import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const DAY = 86_400_000, now = Date.now()
const data = {
  kv: [{k: 'a', v: 1}], apps: [{k: 'b', v: {x: 1}}],
  convs: [{id: 'old', updatedAt: now - 200 * DAY}, {id: 'new', updatedAt: now - DAY}],
  turns: [{id: 't1', convId: 'old'}, {id: 't2', convId: 'old'}, {id: 't3', convId: 'new'}],
  themePackages: [{manifest:{name:'本机字体'},resources:[{bytes:new ArrayBuffer(123)}]}],
  toolDetails: [{convId: 'old', bytes: 1000}, {convId: 'new', bytes: 50}],
}
const deleted = []
globalThis.localStorage = {length: 2, key: i => ['fp.x', 'other'][i], getItem: key => key === 'fp.x' ? 'abc' : 'zzzz'}
const mocks = {
  './db': {db: {all: async store => data[store]}},
  './chat': {flush: async () => undefined, exportChat: async () => ({}), deleteConv: async id => {if (id === 'busy') throw new Error('请先停止生成'); deleted.push(id)}},
  './bookmarks': {download: () => undefined},
  './themePackages/repository': {flushThemePackages:async()=>{}},
  './themePackages/codec': {validateStoredThemePackage:async row=>row},
}
const code = ts.transpileModule(readFileSync(new URL('../src/lib/storageUsage.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const module = {exports: {}}
vm.runInThisContext('(function(module, exports, require) {' + code + '\n})')(module, module.exports, id => mocks[id])
const usage = module.exports
let passed = 0
async function test(name, work) {await work(); passed++; console.log('通过：' + name)}

await test('占用统计按类别汇总，工具明细使用记录的字节数', async () => {
  const result = await usage.measureUsage()
  const by = Object.fromEntries(result.items.map(item => [item.id, item]))
  assert.equal(by.config.count, 1)
  assert.equal(by.turn.count, 3)
  assert.equal(by.tool.bytes, 1050)
  assert.equal(by['theme-package'].count,1)
  assert.ok(by['theme-package'].bytes>=123)
  assert.equal(result.total, result.items.reduce((sum, item) => sum + item.bytes, 0))
})

await test('清理预览只包含过期会话及其内容', async () => {
  const preview = await usage.previewCleanup(180)
  assert.deepEqual(preview.convIds, ['old'])
  assert.equal(preview.turns, 2)
  assert.ok(preview.bytes >= 1000)
  assert.deepEqual((await usage.previewCleanup(365)).convIds, [])
})

await test('清理逐个删除，单个失败不影响其余并如实报告', async () => {
  const result = await usage.cleanupConversations(['a', 'busy', 'b'])
  assert.deepEqual(deleted, ['a', 'b'])
  assert.deepEqual(result, {deleted: 2, failed: 1, firstError: '请先停止生成'})
})
console.log(`共 ${passed} 项通过`)
