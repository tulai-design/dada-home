import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as phosphor from '@phosphor-icons/react'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const cache = new Map()
function load(file) {
  if (file.endsWith('.css')) return {}
  if (cache.has(file)) return cache.get(file)
  const module = {exports: {}}
  cache.set(file, module.exports)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, id => {
    if (id === '@phosphor-icons/react') return phosphor
    if (!id.startsWith('.')) return require(id)
    const absolute = path.resolve(path.dirname(file), id)
    const resolved = [absolute, absolute + '.ts', absolute + '.tsx'].find(existsSync)
    assert.ok(resolved, `找不到模块 ${id}`)
    return load(resolved)
  })
  return module.exports
}
const {UiTree} = load(path.join(root, 'src/lib/applet/render.tsx'))
const render = (type, props) => renderToStaticMarkup(React.createElement(UiTree, {node: {t: type, p: props, c: []}, fire() {throw Error('图表展示不应调用业务事件')}}))
let passed = 0
function test(name, run) {run();passed++;console.log(`通过：${name}`)}

test('UiTree接受LineChart并提供可读图形、摘要和精确数据表', () => {
  const html = render('LineChart', {title: '每日专注', labels: ['周一', '周二', '周三'], series: [{name: '分钟', values: [15, 0, 35]}], unit: '分钟'})
  assert.ok(!html.includes('不支持的积木'))
  assert.match(html, /<svg[^>]*role="img"/)
  assert.match(html, /每日专注/)
  assert.match(html, /查看数据/)
  assert.match(html, /<caption>每日专注数据/)
  assert.match(html, /<th[^>]*scope="col"[^>]*>分钟/)
  assert.match(html, /<td[^>]*>0/)
  assert.match(html, /周三[^<]*35|35[^<]*分钟/)
})

test('零和负数保持精确数据，缺失值不补零且折线不跨缺口', () => {
  const html = render('LineChart', {labels: ['第一天', '第二天', '第三天', '第四天'], series: [{name: '余额', values: [0, null, -5, 10]}], unit: '元'})
  assert.match(html, /<td>0<\/td>/)
  assert.match(html, /<td>缺失<\/td>/)
  assert.match(html, /<td>-5<\/td>/)
  assert.match(html, /<td>10<\/td>/)
  assert.equal((html.match(/<circle\b/g) || []).length, 3, '三个有效数值绘成三个点，null没有数据点')
  assert.equal((html.match(/<polyline\b/g) || []).length, 1, '只有第三与第四天相邻成线，第一天不跨缺口')
  assert.ok(!/NaN|Infinity/.test(html))
})

test('空数据和全缺失不给出假趋势，已有标签仍有缺失明细', () => {
  const empty = render('LineChart', {labels: [], series: [{name: '记录', values: []}]})
  assert.match(empty, /暂无趋势数据/)
  assert.ok(!empty.includes('ap-line-chart-series'))
  assert.ok(!empty.includes('<table'))
  const missing = render('LineChart', {labels: ['周一', '周二'], series: [{name: '记录', values: [null, null]}]})
  assert.match(missing, /暂无趋势数据/)
  assert.ok(!missing.includes('ap-line-chart-series'))
  assert.equal((missing.match(/<td>缺失<\/td>/g) || []).length, 2)
  assert.match(missing, /<summary>查看数据<\/summary>/)
})

test('非法和超量数据局部报错，不丢失同一应用的其他积木', () => {
  for (const props of [
    {},
    {labels: ['周一'], series: [{name: '数据', values: [NaN]}]},
    {labels: ['周一'], series: [{name: '数据', values: []}]},
    {labels: Array.from({length: 121}, (_, i) => String(i)), series: [{name: '数据', values: Array(121).fill(1)}]},
  ]) {
    const html = render('LineChart', props)
    assert.match(html, /role="alert"/)
    assert.ok(!html.includes('ap-line-chart-series'))
  }
  const html = renderToStaticMarkup(React.createElement(UiTree, {node: {t: 'Stack', p: {}, c: [
    {t: 'Text', p: {text: '已有输入保持'}, c: []}, {t: 'LineChart', p: {}, c: []},
  ]}, fire() {}}))
  assert.match(html, /已有输入保持/)
  assert.match(html, /role="alert"/)
})

test('单点、常数和极小数保留可见点与有限坐标', () => {
  for (const values of [[0], [15, 15, 15], [-8], [Number.MIN_VALUE, 0]]) {
    const html = render('LineChart', {labels: values.map((_, i) => String(i + 1)), series: [{name: '记录', values}]})
    assert.equal((html.match(/<circle\b/g) || []).length, values.length)
    assert.ok(!/NaN|Infinity/.test(html))
    assert.match(html, /<table/)
  }
})

test('原Bars的公开渲染和高亮行为保持', () => {
  const html = render('Bars', {values: [5, 10], labels: ['甲', '乙'], highlight: 1, height: 80})
  assert.match(html, /role="img" aria-label="柱状图"/)
  assert.equal((html.match(/class="ap-bar"/g) || []).length, 2)
  assert.match(html, /data-hot="true" title="乙：10"/)
  assert.match(html, /height:80px/)
})

console.log(`Applet图表宿主渲染回归：${passed}/${passed}`)
