import {bindIncremental, defaultIncrementalConfig, readIncrementalConfig, runIncremental, writeIncrementalConfig} from '../src/lib/incrementalClient'
import {replaceApplicationData} from '../src/lib/applicationData'
import {commitWithSync} from '../src/lib/incrementalLocal'
import {db} from '../src/lib/db'
import {defaultSettings} from '../src/lib/defaults'
import {writeStored} from '../src/lib/store'
import {getPersistenceStatus} from '../src/lib/persistence'
import {splitTurn} from '../src/lib/chatStorageSchema'
import {canonical} from '../src/lib/syncProtocol'
import {APP_COUNT, FIXTURE, workspaceFixture} from './sync-completeness-fixture.js'

const config = await (await fetch('/__qa/config')).json()
const parentOrigin = new URL(document.referrer).origin
if (![config.origin, config.peerOrigin].includes(parentOrigin)) throw new Error('QA parent origin mismatch')
const setting = name => JSON.parse(localStorage.getItem(`fp.${name}`) ?? 'null')
const same = (a, b) => a !== undefined && b !== undefined && canonical(a) === canonical(b)
const own = (value, key) => Boolean(value) && Object.hasOwn(value, key)
const commands = {
  async seed() {
    const settings = {...defaultSettings(), name: '同步验收', wallpaper: 'off', ai: FIXTURE.ai, proxy: FIXTURE.proxy, monitor: FIXTURE.monitor}
    writeStored('settings', settings)
    writeStored('search', FIXTURE.search)
    writeStored('assistantSplitRatio', 0.63)
    writeStored('read', ['qa-read-1'])
    const split = splitTurn({id: 'qa-turn', convId: 'qa-conversation', prompt: '合成问题', answer: '合成回答', reasoning: '', error: '', startedAt: 1, endedAt: 2, tools: [{name: 'qa_tool', title: '合成工具', ok: true, text: '完整工具正文'}]})
    await db.batch([
      ...Array.from({length: APP_COUNT}, (_, i) => ({store: 'apps', type: 'put', value: {k: `app:qa-${String(i).padStart(3, '0')}`, v: i === 0 ? FIXTURE.app : {index: i}}})),
      {store: 'kv', type: 'put', value: {k: '@shared.icsSubs', v: FIXTURE.ics}},
      {store: 'convs', type: 'put', value: {id: 'qa-conversation', title: '合成会话', createdAt: 1, updatedAt: 2}},
      {store: 'turns', type: 'put', value: split.turn},
      ...split.details.map(value => ({store: 'toolDetails', type: 'put', value})),
    ])
    return true
  },
  async bind() {
    writeIncrementalConfig({...defaultIncrementalConfig(), ...config.scope, endpoint: config.baseUrl, deviceId: config.deviceId, token: config.token, keyring: config.keyring})
    await bindIncremental()
    return true
  },
  theme() {writeStored('workspace', workspaceFixture()); return true},
  sync: args => runIncremental(args ?? {pull: true}),
  async verify() {
    const settings = setting('settings'), search = setting('search'), workspace = setting('workspace')
    const apps = await db.all('apps'), app = apps.find(row => row.k === 'app:qa-000')?.v
    const ics = (await db.get('kv', '@shared.icsSubs'))?.v
    const storedConfig = readIncrementalConfig()
    const turn = await db.get('turns', 'qa-turn'), details = await db.byIndex('toolDetails', 'turnId', 'qa-turn')
    return {
      applicationCount: apps.length,
      applicationComplete: same(app, FIXTURE.app),
      searchComplete: same(search, FIXTURE.search),
      aiComplete: same(settings?.ai, FIXTURE.ai), proxyComplete: settings?.proxy === FIXTURE.proxy, monitorComplete: same(settings?.monitor, FIXTURE.monitor),
      subscriptionComplete: same(ics, FIXTURE.ics),
      themeComplete: same(workspace?.theme, workspaceFixture().theme) && same(workspace?.themes, workspaceFixture().themes),
      homepageComplete: same(workspace?.pages, workspaceFixture().pages),
      deviceIdentityPreserved: storedConfig.deviceId === config.deviceId && storedConfig.token === config.token && same(storedConfig.keyring, config.keyring),
      grantsLocal: !workspace?.network?.length,
      preferencesComplete: setting('assistantSplitRatio') === 0.63 && same(setting('read'), ['qa-read-1']),
      chatComplete: Boolean(await db.get('convs', 'qa-conversation')) && turn?.answer === '合成回答' && details.length === 1 && details[0].text === '完整工具正文',
    }
  },
  blockedEdit() {
    try {writeStored('qa-forbidden-write', true); return false} catch {return getPersistenceStatus().errors.some(item => item.source === 'sync-reload')}
  },
  async removeCredentials() {
    const settings = setting('settings'), ai = {...settings.ai}
    delete ai.apiKey
    writeStored('settings', {...settings, ai, monitor: settings.monitor.map(({token, password, ...rest}) => rest)})
    writeStored('search', {...setting('search'), keys: {}})
    await replaceApplicationData({kind: 'app', id: 'qa-000'}, {title: FIXTURE.app.title, nested: {keys: ['alpha', 'beta']}})
    await commitWithSync([{store: 'kv', type: 'put', value: {k: '@shared.icsSubs', v: [{id: 'qa-calendar', name: '已清除地址', enabled: false}]}}], [{collection: 'component', key: '@shared.icsSubs'}])
    return true
  },
  async verifyRemoved() {
    const settings = setting('settings'), search = setting('search'), app = (await db.get('apps', 'app:qa-000'))?.v, ics = (await db.get('kv', '@shared.icsSubs'))?.v
    return {
      aiRemoved: !own(settings?.ai, 'apiKey'), searchRemoved: same(search?.keys, {}), monitorRemoved: !own(settings?.monitor?.[0], 'token') && !own(settings?.monitor?.[0], 'password'),
      appRemoved: !own(app, 'token') && !own(app?.nested, 'secret') && same(app?.nested?.keys, ['alpha', 'beta']), subscriptionRemoved: !own(ics?.[0], 'url'),
    }
  },
  partialSearch() {writeStored('search', {provider: 'tavily'}); return true},
}
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== config.runId) return
  const {id, command, args} = event.data
  try {
    if (!Object.hasOwn(commands, command)) throw new Error('未知 QA 命令')
    const value = await commands[command](args)
    parent.postMessage({channel: config.runId, id, value}, parentOrigin)
  } catch (error) {parent.postMessage({channel: config.runId, id, error: error.message}, parentOrigin)}
})
document.querySelector('#status').textContent = `${config.deviceId}：真实 IndexedDB 就绪`
parent.postMessage({channel: config.runId, ready: config.deviceId}, parentOrigin)
