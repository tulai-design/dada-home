import {APP_COUNT} from './sync-completeness-fixture.js'
const config = await (await fetch('/__qa/config')).json()
const pending = new Map(), frames = new Map(), waiting = new Map()
const status = document.querySelector('#status'), detail = document.querySelector('#detail')
let sequence = 0
const assert = (value, message) => {if (!value) throw new Error(message)}
const all = (checks, label) => {for (const [name, value] of Object.entries(checks)) assert(value === true, `${label}：${name}`)}
const originOf = device => device === 'a' ? config.origin : config.peerOrigin
window.addEventListener('message', event => {
  if (![config.origin, config.peerOrigin].includes(event.origin) || event.data?.channel !== config.runId || ![...frames.values()].some(frame => frame.contentWindow === event.source)) return
  if (event.data.ready) {waiting.get(event.data.ready)?.(event.data); waiting.delete(event.data.ready); return}
  const request = pending.get(event.data.id)
  if (request) {pending.delete(event.data.id); clearTimeout(request.timer); event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.value)}
})
function waitReady(name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {waiting.delete(name); reject(new Error(`设备未就绪：${name}`))}, 45000)
    waiting.set(name, data => {clearTimeout(timer); data.error ? reject(new Error(data.error)) : resolve(data.value)})
  })
}
async function mount(device) {
  const ready = waitReady(`device-${device}`), frame = document.createElement('iframe'), old = frames.get(device)
  frame.src = `${originOf(device)}/tests/sync-completeness-worker.html?reload=${++sequence}`
  frames.set(device, frame)
  old ? old.replaceWith(frame) : document.querySelector('#frames').append(frame)
  await ready
}
function call(device, command, args) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); reject(new Error(`命令超时：${command}`))}, 180000)
    pending.set(id, {resolve, reject, timer})
    frames.get(device).contentWindow.postMessage({channel: config.runId, id, command, args}, originOf(device))
  })
}
async function sync(device, args = {pull: true}) {
  const result = await call(device, 'sync', args)
  assert(result.phase === 'ok', `同步未完成：${result.message ?? result.phase}`)
  assert(!result.conflicts, '出现意外冲突')
  return result
}
async function app(partial = false) {
  const ready = waitReady('app'), frame = document.createElement('iframe')
  frame.src = `${config.peerOrigin}/tests/sync-completeness-app.html?reload=${++sequence}${partial ? '&partial' : ''}`
  frames.get('app')?.remove(); frames.set('app', frame); document.querySelector('#app-frame').append(frame)
  return ready
}
async function check(name, work) {
  const item = document.createElement('li'); item.textContent = `运行中：${name}`; document.querySelector('#results').append(item)
  try {await work(); item.textContent = `通过：${name}`; item.className = 'pass'}
  catch (error) {item.textContent = `失败：${name} — ${error.message}`; item.className = 'fail'; throw error}
}
try {await Promise.all([mount('a'), mount('b')]); status.textContent = '两台隔离设备已就绪'; document.querySelector('#run').disabled = false}
catch (error) {status.textContent = '初始化失败'; detail.textContent = error.message}
document.querySelector('#run').addEventListener('click', async event => {
  event.target.disabled = true; status.textContent = '完整同步回归运行中'
  try {
    await check('源设备上传 55 个应用及配置、组件和聊天，主题最后上传', async () => {
      await call('a', 'seed'); await Promise.all([call('a', 'bind'), call('b', 'bind')])
      const first = await sync('a', {pull: false}); assert(first.pushed > 50, '没有覆盖超过 50 条记录')
      await call('a', 'theme'); const theme = await sync('a', {pull: false}); assert(theme.pushed === 1, '主题没有单独最后提交')
      detail.textContent += `源设备提交 ${first.pushed + theme.pushed} 条记录（只报告数量）。\n`
    })
    await check('目标设备一次手动同步拉完多页，主题、密钥、端点和业务正文完整', async () => {
      const result = await sync('b'); assert(result.pulled > 50, '手动同步没有拉完超过 50 条记录'); assert(result.needsReload, '缺少刷新提示')
      const {applicationCount, ...checks} = await call('b', 'verify'); assert(applicationCount === APP_COUNT, '应用数据不完整'); all(checks, '数据缺失')
      assert(await call('b', 'blockedEdit'), '旧内存仍能写入覆盖远端')
      detail.textContent += `目标设备单次拉取 ${result.pulled} 条记录；写入保护生效。\n`
    })
    await check('刷新后第二次手动同步为空操作，没有崩溃或回传旧值', async () => {
      await mount('b'); const second = await sync('b')
      assert(second.pushed === 0 && second.pulled === 0 && !second.needsReload, '第二次同步不是空操作')
      const {applicationCount, ...checks} = await call('b', 'verify'); assert(applicationCount === APP_COUNT, '刷新后丢失数据'); all(checks, '刷新后数据缺失')
    })
    await check('凭据显式删除可传播，不会恢复目标设备旧密钥', async () => {
      await call('a', 'removeCredentials'); await sync('a', {pull: false}); await sync('b'); await mount('b')
      all(await call('b', 'verifyRemoved'), '凭据删除失败')
    })
    await check('同步后刷新进入真实 App，设置页面与自定义深色主题正常', async () => {all(await app(), '真实应用失败')})
    await check('缺少 keys/urls 的 Tavily 配置刷新后仍能打开设置', async () => {
      frames.get('app').remove(); frames.delete('app')
      await call('b', 'partialSearch'); all(await app(true), '部分搜索配置渲染失败')
    })
    status.textContent = '全部通过'
    const stats = await (await fetch('/__qa/stats')).json()
    detail.textContent += `HTTP 提交 ${stats.commits} 次，对象上传 ${stats.objectCompletes} 个；未输出任何数据正文或凭据。\n`
  } catch (error) {status.textContent = '回归失败'; detail.textContent += error.stack ?? error.message}
})
