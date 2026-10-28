const config = await (await fetch('/__qa/config')).json()
const pending = new Map(), frames = new Map(), waiting = new Map()
let sequence = 0
const output = document.querySelector('#detail'), status = document.querySelector('#status')
function assert(value, message) {if (!value) throw new Error(message)}
function equal(a, b, message) {assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)}
window.addEventListener('message', event => {
  if (![config.origin, config.peerOrigin].includes(event.origin) || event.data?.channel !== config.runId) return
  if (![...frames.values()].some(frame => event.source === frame.contentWindow)) return
  if (event.data.ready) {waiting.get(event.data.ready)?.(); waiting.delete(event.data.ready); return}
  const request = pending.get(event.data.id)
  if (request) {pending.delete(event.data.id); clearTimeout(request.timer); event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.value)}
})
async function mount(device, originDevice = device) {
  const old = frames.get(device), frame = document.createElement('iframe')
  const ready = new Promise(resolve => waiting.set('device-' + originDevice, resolve))
  frame.src = (device.startsWith('a') ? config.origin : config.peerOrigin) + '/tests/application-sync-worker.html?reload=' + (++sequence)
  frames.set(device, frame)
  old ? old.replaceWith(frame) : document.querySelector('#frames').append(frame)
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('设备未就绪 ' + device)), 20000))])
}
function call(device, command, args) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); reject(new Error('命令超时 ' + command))}, 60000)
    pending.set(id, {resolve, reject, timer})
    frames.get(device).contentWindow.postMessage({channel: config.runId, id, command, args}, device.startsWith('a') ? config.origin : config.peerOrigin)
  })
}
async function run(device, args) {const result = await call(device, 'run', args); if (result.needsReload) await mount(device); return result}
async function drain(device) {let result; for (let i = 0; i < 60; i++) {result = await run(device); if (!result.hasMore) return result} throw new Error('分页未收敛')}
const save = (device, key, value) => call(device, 'save', {key, value})
const load = (device, key) => call(device, 'load', {key})
const stats = async () => (await fetch('/__qa/stats')).json()
async function check(name, work) {
  const li = document.createElement('li'); li.textContent = '运行中：' + name; document.querySelector('#results').append(li)
  try {const detail = await work(); li.className = 'pass'; li.textContent = '通过：' + name; if (detail) output.textContent += name + '\n' + JSON.stringify(detail) + '\n'}
  catch (error) {li.className = 'fail'; li.textContent = '失败：' + name + ' — ' + error.message; throw error}
}
await Promise.all([mount('a'), mount('b')]); status.textContent = '两台隔离设备已就绪'
document.querySelector('#run').addEventListener('click', async event => {
  event.target.disabled = true; status.textContent = '验收运行中'
  try {
    await save('a', 'app:before-bind', {seed: true}); await Promise.all([call('a', 'bind'), call('b', 'bind')])
    await check('大对象、深层 JSON、长 ID 与已知凭据过滤', async () => {
      const key = 'app:长🙂'.repeat(140) + '\ud800', data = {body: '中'.repeat(710000), token: 'local-only', nested: {}}
      let level = data.nested; for (let i = 0; i < 90; i++) {level.next = {}; level = level.next} level.value = 42
      await save('a', key, data); const before = await stats(); await drain('a'); await drain('b')
      const copy = await load('b', key); assert(copy.body.length === 710000, '大对象内容损坏'); assert(!('token' in copy), '凭据泄露')
      let levelCopy = copy.nested; for (let i = 0; i < 90; i++) levelCopy = levelCopy.next
      equal(levelCopy.value, 42, '深层值'); const after = await stats(); assert(after.objectChunkPuts - before.objectChunkPuts >= 3, '没有真实分块')
      return {commits: after.commits - before.commits, uploadBytes: after.objectChunkBytes - before.objectChunkBytes}
    })
    await check('第二次只发送新增记录，离线保存和重建客户端恢复队列', async () => {
      const before = await stats(); await save('a', 'app:shared', {count: 1}); await drain('a'); const after = await stats()
      equal(after.commits - before.commits, 1, '非增量提交'); assert(after.objectChunkBytes - before.objectChunkBytes < 1000, '重复上传历史大对象')
      await drain('b'); await call('a', 'fault', {offline: true}); await save('a', 'app:offline', {value: 'offline'})
      let failed = false; try {await call('a', 'run')} catch {failed = true} assert(failed, '离线未失败')
      await mount('a'); await drain('a'); await drain('b'); equal((await load('b', 'app:offline')).value, 'offline', '队列未恢复')
      return {incrementalCommits: after.commits - before.commits, incrementalUploadBytes: after.objectChunkBytes - before.objectChunkBytes}
    })
    await check('丢响应后使用原操作，新编辑不被旧确认清除', async () => {
      await save('a', 'app:shared', {count: 2})
      await call('a', 'fault', {dropCommit: {edit: {ref: {kind: 'app', id: 'shared'}, value: {count: 3}}}})
      let failed = false; try {await call('a', 'run', {maxPush: 1})} catch {failed = true} assert(failed, '丢响应未失败')
      const before = await stats(); await mount('a'); await drain('a'); await drain('b')
      equal((await load('b', 'app:shared')).count, 3, '新编辑被丢弃')
      const after = await stats(); equal(after.commits - before.commits, 1, '已确认操作被重复提交')
    })
    await check('同记录冲突保留双方，显式选择本地后收敛', async () => {
      await save('a', 'app:shared', {count: 4}); await save('b', 'app:shared', {count: 5}); await drain('a'); await drain('b')
      const state = await call('b', 'inspect'); output.textContent += '冲突候选已持久保存。\n'
      const records = state.records || []; const record = records.find(item => item.applicationKey === 'app:shared')
      assert(record?.conflict?.remoteReady, '缺少可恢复的远端冲突候选')
      equal(record.conflict.localValue.count, 5, '本地候选'); equal(record.conflict.remoteValue.count, 4, '远端候选')
      const resolved = await call('b', 'resolve', {key: 'app:shared', expected: {localGeneration: record.conflict.localGeneration, remoteRevision: record.conflict.remoteRevision}, choice: 'local'}); if (resolved.needsReload) await mount('b'); await drain('b'); await drain('a')
      equal((await load('a', 'app:shared')).count, 5, '选择后未收敛')
    })
    await check('删除/修改冲突与空对象区别', async () => {
      await call('a', 'delete', {key: 'app:shared'}); await save('b', 'app:shared', {count: 6}); await drain('a'); await drain('b')
      const state = await call('b', 'inspect'), record = state.records.find(item => item.applicationKey === 'app:shared')
      assert(record.conflict.remoteReady && record.conflict.remoteValue === null, '远端删除未保留')
      equal(record.conflict.localValue.count, 6, '修改候选丢失')
      await call('b', 'resolve', {key: 'app:shared', expected: {localGeneration: record.conflict.localGeneration, remoteRevision: record.conflict.remoteRevision}, choice: 'remote'}); await mount('b')
      assert(await call('b', 'row', {key: 'app:shared'}) === undefined, '删除仍保留apps行')
      await save('a', 'app:empty', {}); await drain('a'); await drain('b'); equal((await call('b', 'row', {key: 'app:empty'})).v, {}, '空对象被误删')
    })
    await check('下载中断不跳游标，期间本地编辑保留为冲突', async () => {
      await save('a', 'app:download-race', {text: 'remote'}); await drain('a')
      const before = await call('b', 'inspect')
      await call('b', 'fault', {download: {edit: {ref: {kind: 'app', id: 'download-race'}, value: {text: 'local-during-download'}}}})
      let failed = false; try {await call('b', 'run')} catch {failed = true} assert(failed, '中断未失败')
      const after = await call('b', 'inspect'); equal(after.binding.cursor, before.binding.cursor, '失败推进游标')
      equal((await load('b', 'app:download-race')).text, 'local-during-download', '并发编辑丢失')
      await drain('b'); const result = await call('b', 'inspect'), record = result.records.find(item => item.applicationKey === 'app:download-race')
      assert(record.conflict?.remoteReady, '并发候选未保留'); equal(record.conflict.remoteValue.text, 'remote', '远端候选错误')
    })
    await check('入站事务中断同时回滚业务、版本和游标', async () => {
      await save('a', 'app:inbound-atomic', {value: 'remote'}); await drain('a')
      const before = await call('b', 'inspect'); const result = await call('b', 'abortInbound')
      assert(result.rejected, '入站中断未拒绝'); equal(result.state.binding.cursor, before.binding.cursor, '中断推进游标')
      assert(await call('b', 'row', {key: 'app:inbound-atomic'}) === undefined, '入站事务部分写入')
      await drain('b'); equal((await load('b', 'app:inbound-atomic')).value, 'remote', '失败后无法重新接收')
    })
    await check('同源旧缓存的保存被拒绝，不能覆盖其他标签的新值', async () => {
      await save('a', 'app:cross-tab', {value: 1}); await mount('a2', 'a'); await load('a2', 'app:cross-tab')
      await save('a', 'app:cross-tab', {value: 2}); let failed = false
      try {await save('a2', 'app:cross-tab', {value: 3})} catch {failed = true}
      assert(failed, '旧缓存CAS未拒绝'); equal((await call('a', 'row', {key: 'app:cross-tab'})).v.value, 2, '新值被覆盖')
      frames.get('a2').remove(); frames.delete('a2')
    })
    await check('活动同步绑定下，配置恢复失败能从日志重试且不触碰应用', async () => {
      const before = await call('a', 'row', {key: 'app:cross-tab'})
      const result = await call('a', 'recoveryWhileBound')
      assert(result.rejected && result.hadJournal && !result.pending, '恢复日志未完成重试')
      equal(result.note.v, 'before', '非应用记录未回滚'); equal(result.local, 'before', '配置未回滚')
      equal(await call('a', 'row', {key: 'app:cross-tab'}), before, '回滚误改应用')
      assert(result.state.binding, '绑定丢失')
    })
    await check('事务中断回滚业务与意图，活动绑定阻止整包恢复', async () => {
      const result = await call('a', 'abortSave', {key: 'app:atomic', value: {safe: true}})
      assert(result.rejected && result.row === undefined, '事务未原子回滚')
      assert(!result.state.records.some(item => item.applicationKey === 'app:atomic'), '失败仍产生待发意图')
      const rejected = await call('a', 'restoreGuard'); assert(typeof rejected === 'string' && rejected.length, '整包替换绕开绑定')
      await call('a', 'detach'); await call('a', 'restoreAfterDetach'); await mount('a'); await save('a', 'app:local-after-detach', {local: true})
      equal((await load('a', 'app:local-after-detach')).local, true, '解绑后无法本地使用')
    })
    status.textContent = '全部通过'; output.textContent += '\n最终请求统计（不含凭据/正文）：\n' + JSON.stringify(await stats(), null, 2)
  } catch (error) {status.textContent = '验收失败'; output.textContent += error.stack}
})
