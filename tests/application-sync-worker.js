import {createApplicationSyncController} from '../src/lib/applicationSync'
import {replaceApplicationData, loadApplicationData, deleteApplicationData} from '../src/lib/applicationData'
import {db} from '../src/lib/db'
import {commitStorage, recoverStorage} from '../src/lib/storageCommit'
import {retryPersistence} from '../src/lib/persistence'

const config = await (await fetch('/__qa/config')).json()
let fault = {}, controller
const options = {...config.scope, endpoint: config.baseUrl, deviceId: config.deviceId, token: config.token, keyring: config.keyring, retries: 0, timeoutMs: 1500,
  fetchImpl: async (...args) => {
    const url = String(args[0]), method = args[1]?.method || 'GET'
    if (fault.offline) throw new TypeError('QA offline')
    if (fault.download && method === 'GET' && /\/objects\/[^/]+\/chunks\//.test(url)) {
      const current = fault.download; delete fault.download
      if (current.edit) await replaceApplicationData(current.edit.ref, current.edit.value)
      throw new TypeError('QA interrupted object')
    }
    const response = await fetch(...args)
    if (fault.dropCommit && method === 'POST' && url.endsWith('/commits')) {
      const current = fault.dropCommit; delete fault.dropCommit
      await response.arrayBuffer()
      if (current.edit) await replaceApplicationData(current.edit.ref, current.edit.value)
      throw new TypeError('QA dropped response after server commit')
    }
    return response
  }}
controller = createApplicationSyncController(options)
const ref = key => {const split = key.indexOf(':'); return {kind: key.slice(0, split), id: key.slice(split + 1)}}
const commands = {
  bind: () => controller.bind(),
  run: args => controller.run(args || {}),
  inspect: () => controller.inspect(),
  save: args => replaceApplicationData(ref(args.key), args.value),
  load: args => loadApplicationData(ref(args.key)),
  row: args => db.get('apps', args.key),
  delete: args => deleteApplicationData(ref(args.key)),
  resolve: args => controller.resolve(args.key, args.expected, args.choice),
  detach: () => controller.detach(),
  fault: args => {fault = args; return true},
  async abortSave(args) {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...values) {
      const req = Reflect.apply(put, this, values)
      if (this.name === 'applicationSync') req.addEventListener('success', () => {try {this.transaction.abort()} catch {}}, {once: true})
      return req
    }
    let rejected = false
    try {await replaceApplicationData(ref(args.key), args.value)} catch {rejected = true} finally {IDBObjectStore.prototype.put = put}
    const row = await db.get('apps', args.key)
    const state = await controller.inspect()
    await retryPersistence()
    return {rejected, row, state}
  },
  async recoveryWhileBound() {
    await db.put('kv', {k: 'qa-note', v: 'before'})
    localStorage.setItem('fp.qa-restore', 'before')
    const original = Storage.prototype.setItem
    let failures = 2
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fp.qa-restore' && failures-- > 0) throw new DOMException('QA quota', 'QuotaExceededError')
      return Reflect.apply(original, this, [key, value])
    }
    let rejected = false
    try {await commitStorage({local: {'fp.qa-restore': 'after'}, operations: [{store: 'kv', type: 'put', value: {k: 'qa-note', v: 'after'}}]})} catch {rejected = true} finally {Storage.prototype.setItem = original}
    const journal = await db.get('recovery', 'backup-restore')
    await recoverStorage()
    return {rejected, hadJournal: !!journal, pending: !!await db.get('recovery', 'backup-restore'), note: await db.get('kv', 'qa-note'), local: localStorage.getItem('fp.qa-restore'), state: await controller.inspect()}
  },
  async abortInbound() {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...values) {
      const req = Reflect.apply(put, this, values)
      if (this.name === 'apps') req.addEventListener('success', () => {try {this.transaction.abort()} catch {}}, {once: true})
      return req
    }
    let rejected = false
    try {await controller.run({maxPush: 0})} catch {rejected = true} finally {IDBObjectStore.prototype.put = put}
    return {rejected, state: await controller.inspect()}
  },
  async restoreAfterDetach() {await commitStorage({local: {}, operations: [{store: 'apps', type: 'put', value: {k: 'app:after-restore', v: {restored: true}}}]}); return true},
  async restoreGuard() {
    try {await commitStorage({local: {}, operations: [{store: 'apps', type: 'clear'}]}); return false} catch (error) {return error.message}
  },
}
window.addEventListener('message', async event => {
  if (event.source !== parent || ![config.origin, config.peerOrigin].includes(event.origin) || event.data?.channel !== config.runId) return
  const {id, command, args} = event.data
  try {
    if (!Object.hasOwn(commands, command)) throw new Error('Unknown QA command')
    const value = await commands[command](args)
    parent.postMessage({channel: config.runId, id, value}, event.origin)
  } catch (error) {parent.postMessage({channel: config.runId, id, error: error.message}, event.origin)}
})
document.querySelector('#status').textContent = `${config.deviceId}：真实 IndexedDB 已就绪`
for (const target of [config.origin, config.peerOrigin]) parent.postMessage({channel: config.runId, ready: config.deviceId}, target)
