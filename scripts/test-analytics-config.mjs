import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// 实际初始化逻辑；脚本只记录是否注入，不访问统计服务。
const source = readFileSync(new URL('../src/lib/analytics.ts', import.meta.url), 'utf8').replace('import.meta.env', '({})')
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
let preference = false, scripts = []
const entries = new Map([['umami.disabled', '1']])
const localStorage = {setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key)}
const document = {querySelector: () => scripts[0], createElement: () => ({dataset: {}}), head: {appendChild: script => scripts.push(script)}}
const window = {__DADA__: {umami: {websiteId: '00000000-0000-0000-0000-000000000001', src: 'https://analytics.example.test/script.js'}}}
const module = {exports: {}}
new Function('module', 'exports', 'require', 'document', 'window', 'localStorage', code)(module, module.exports, id => {
  assert.equal(id, './store')
  return {readStored: () => preference, writeStored: (_key, value) => {preference = value}}
}, document, window, localStorage)

module.exports.initAnalytics()
assert.equal(scripts.length, 0, '关闭偏好不能加载统计脚本')
assert.equal(entries.get('umami.disabled'), '1')
preference = true // 模拟恢复/同步后 fp.analytics 的值，不能依赖设置页 setter 副作用。
module.exports.initAnalytics()
assert.equal(entries.has('umami.disabled'), false, '恢复开启后必须清理本机遗留 disabled 标记')
assert.equal(scripts.length, 1)
assert.equal(scripts[0].dataset.doNotTrack, 'true')
module.exports.initAnalytics()
assert.equal(scripts.length, 1, '重复初始化不重复注入')
preference = false
scripts = [] // 新页面中的 DOM
module.exports.initAnalytics()
assert.equal(entries.get('umami.disabled'), '1')
assert.equal(scripts.length, 0, '同步关闭偏好后不能加载统计脚本')
module.exports.setAnalyticsEnabled(true)
assert.equal(preference, true)
assert.equal(entries.has('umami.disabled'), false)
console.log('统计偏好回归通过：恢复开启、恢复关闭、去重和本机开关')
