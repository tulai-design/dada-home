import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const module = {exports: {}}
const source = readFileSync(new URL('../src/lib/applicationWindow.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
new Function('module', 'exports', code)(module, module.exports)
const {applicationWindowRect, clampApplicationWindow, moveApplicationWindow, resizeApplicationWindow, maximizeApplicationWindow, restoreApplicationWindow, reflowApplicationWindow} = module.exports

let passed = 0
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)
function test(name, run) {run(); passed += 1; console.log(`通过：${name}`)}
function visible(bounds, rect) {
  for (const value of Object.values(rect)) assert.ok(Number.isFinite(value) && value >= 0)
  const width = Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : 0
  const height = Number.isFinite(bounds.height) ? Math.max(0, bounds.height) : 0
  assert.ok(rect.x + rect.width <= width + 1e-6)
  assert.ok(rect.y + rect.height <= height + 1e-6)
}

test('普通窗口默认800×680居中，内容高度可由调用者指定', () => {
  assert.deepEqual(applicationWindowRect({width: 1440, height: 1000}), {x: 320, y: 160, width: 800, height: 680})
  assert.deepEqual(applicationWindowRect({width: 1200, height: 900}, {height: 360}), {x: 200, y: 270, width: 800, height: 360})
})
test('小画布等比例收窄，窗口及标题始终完整可见', () => {
  for (const bounds of [{width: 420, height: 900}, {width: 390, height: 844}, {width: 320, height: 480}, {width: 900, height: 300}]) {
    const rect = applicationWindowRect(bounds)
    visible(bounds, rect)
    close(rect.width / rect.height, 800 / 680)
    assert.ok(rect.x >= 16 && rect.y >= 16)
    assert.ok(rect.height <= 680)
  }
})
test('拖动四边夹限，极端指针和无效坐标不能把窗口拖丢', () => {
  const bounds = {width: 1440, height: 1000}
  const rect = applicationWindowRect(bounds)
  assert.deepEqual(moveApplicationWindow(bounds, rect, {x: -10000, y: -10000}), {...rect, x: 16, y: 16})
  assert.deepEqual(moveApplicationWindow(bounds, rect, {x: 10000, y: 10000}), {...rect, x: 624, y: 304})
  assert.deepEqual(moveApplicationWindow(bounds, rect, {x: NaN, y: Infinity}), rect)
})
test('最大化使用安全边界，恢复原位置且不改保存的窗口状态', () => {
  const bounds = {width: 1440, height: 1000}
  const saved = Object.freeze({x: 60, y: 80, width: 800, height: 600})
  assert.deepEqual(maximizeApplicationWindow(bounds), {x: 16, y: 16, width: 1408, height: 968})
  assert.deepEqual(restoreApplicationWindow(bounds, saved), saved)
  const smaller = restoreApplicationWindow({width: 480, height: 500}, saved)
  visible({width: 480, height: 500}, smaller)
  close(smaller.width / smaller.height, 800 / 600)
  assert.deepEqual(saved, {x: 60, y: 80, width: 800, height: 600})
})
test('容器缩放保持相对中心，触边时夹限，窗口不越过新容器', () => {
  const oldBounds = {width: 1440, height: 1000}
  const nextBounds = {width: 1000, height: 800}
  const rect = {x: 800, y: 500, width: 400, height: 300}
  const next = reflowApplicationWindow(oldBounds, nextBounds, rect)
  close((next.x + next.width / 2) / nextBounds.width, (rect.x + rect.width / 2) / oldBounds.width)
  close((next.y + next.height / 2) / nextBounds.height, (rect.y + rect.height / 2) / oldBounds.height)
  for (const bounds of [{width: 420, height: 700}, {width: 900, height: 260}, {width: 0, height: 0}]) visible(bounds, reflowApplicationWindow(oldBounds, bounds, rect))
})
test('resize保持左上锚点，超大尺寸按比例缩小并限制普通窗高度', () => {
  const bounds = {width: 1200, height: 900}
  const rect = {x: 80, y: 70, width: 600, height: 400}
  assert.deepEqual(resizeApplicationWindow(bounds, rect, {width: 700, height: 450}), {...rect, width: 700, height: 450})
  const large = resizeApplicationWindow(bounds, rect, {width: 2400, height: 1800})
  visible(bounds, large)
  close(large.width / large.height, 2400 / 1800)
  assert.ok(large.height <= 680)
  assert.deepEqual(resizeApplicationWindow(bounds, rect, {width: NaN, height: Infinity}), rect)
})
test('低于软最小尺寸后反复夹限和拖动仍幂等，不改变长宽比例', () => {
  const bounds = {width: 320, height: 220}
  const rect = applicationWindowRect(bounds)
  assert.ok(rect.width < 320)
  for (let i = 0; i < 10; i++) {
    const next = clampApplicationWindow(bounds, rect)
    close(next.width, rect.width)
    close(next.height, rect.height)
    close(next.width / next.height, 800 / 680)
    const moved = moveApplicationWindow(bounds, next, {x: 30, y: 20})
    close(moved.width, rect.width)
    close(moved.height, rect.height)
  }
  const reflowed = reflowApplicationWindow({width: 1200, height: 900}, bounds, applicationWindowRect({width: 1200, height: 900}))
  close(reflowed.width / reflowed.height, 800 / 680)
})
test('极小或无效容器、坏尺寸均返回有限非负结果，不产生NaN', () => {
  const invalidRects = [
    {x: NaN, y: Infinity, width: NaN, height: Infinity},
    {x: -100, y: -30, width: -400, height: -200},
    {x: Number.MAX_VALUE, y: Number.MAX_VALUE, width: Number.MAX_VALUE, height: Number.MAX_VALUE},
  ]
  for (const width of [0, 1, 16, 32, 320, 390, NaN, Infinity, -1]) for (const height of [0, 1, 20, 240, 680, NaN, -20]) {
    const bounds = {width, height}
    visible(bounds, applicationWindowRect(bounds))
    visible(bounds, maximizeApplicationWindow(bounds))
    for (const rect of invalidRects) visible(bounds, clampApplicationWindow(bounds, rect))
    visible(bounds, reflowApplicationWindow({width: NaN, height: 0}, bounds, invalidRects[0]))
  }
})
console.log(`应用窗口几何回归全部通过：${passed}/${passed}`)
