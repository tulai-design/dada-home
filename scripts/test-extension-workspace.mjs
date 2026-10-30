import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/extensionWorkspace.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
function manager() {
  let owner
  const queue = []
  const enter = entry => {
    owner = entry.document
    Promise.resolve().then(() => entry.work({name: entry.name})).then(entry.resolve, entry.reject).finally(() => {
      if (owner === entry.document) release(entry.document)
    })
  }
  const release = document => {
    if (owner !== document) return
    owner = undefined
    const next = queue.shift()
    if (next) enter(next)
  }
  return {
    release,
    locks(document) {
      return {request(name, options, work) {
        if (owner && options.ifAvailable) return Promise.resolve().then(() => work(null))
        return new Promise((resolve, reject) => {
          const entry = {document, name, work, resolve, reject}
          if (!owner) enter(entry)
          else queue.push(entry)
        })
      }}
    },
  }
}
function runtime(locks) {
  const module = {exports: {}}
  vm.runInNewContext(source, {module, exports: module.exports, navigator: {locks}})
  return module.exports.runExtensionWorkspace
}
let count = 0
async function test(name, work) {await work(); count++; console.log(`通过：${name}`)}

await test('两等待页在持锁页关闭前不初始化，释放后仅下一页读取最新持久化', async () => {
  const locks = manager(), events = [], persisted = {value: 1}
  void runtime(locks.locks('first'))(async () => {events.push(['start-first', persisted.value])}, () => events.push(['wait-first']))
  await tick()
  void runtime(locks.locks('second'))(async () => {events.push(['start-second', persisted.value])}, () => events.push(['wait-second']))
  void runtime(locks.locks('third'))(async () => {events.push(['start-third', persisted.value])}, () => events.push(['wait-third']))
  await tick()
  assert.deepEqual(events, [['start-first', 1], ['wait-second'], ['wait-third']])
  persisted.value = 2
  locks.release('first') // 模拟浏览器销毁首个文档并释放它持有的锁。
  await tick()
  assert.deepEqual(events, [['start-first', 1], ['wait-second'], ['wait-third'], ['start-second', 2]])
  persisted.value = 3
  locks.release('second')
  await tick()
  assert.deepEqual(events.at(-1), ['start-third', 3])
  assert.equal(events.filter(event => event[0] === 'start-first').length, 1)
})
await test('启动失败释放所有权，下一实例仍能初始化', async () => {
  const locks = manager()
  await assert.rejects(runtime(locks.locks('failed'))(async () => {throw new Error('初始化失败')}, () => {}), /初始化失败/)
  await tick()
  let started = false
  void runtime(locks.locks('next'))(async () => {started = true}, () => assert.fail('失败实例不应永久持锁'))
  await tick()
  assert.equal(started, true)
})
await test('没有Web Locks时明确拒绝，不能退化到无保护编辑', async () => {
  let started = false
  await assert.rejects(runtime(undefined)(async () => {started = true}, () => {}), /不支持安全的新标签页运行/)
  assert.equal(started, false)
})
console.log(`扩展工作空间回归全部通过：${count}/${count}`)
