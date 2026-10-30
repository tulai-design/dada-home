import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import ts from 'typescript'

// 真实记录codec，隔离物理存储；协议/网络协调另由公开runSync回归覆盖。
function runtime(seed = {}) {
  const entries = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]))
  const modules = new Map(), data = {kv: [], apps: [], convs: [], turns: [], toolDetails: []}
  let reads = 0
  const localStorage = {get length() {return entries.size}, key: index => [...entries.keys()][index] ?? null, getItem: key => entries.get(key) ?? null}
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    if (path === 'src/lib/db.ts') return {openDb: async () => true, db: {snapshot: async () => {reads++; return structuredClone(data)}}}
    const module = {exports: {}}; modules.set(path, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText
    const require = id => {if (!id.startsWith('.')) throw new Error('Unexpected dependency ' + id); return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))}
    new Function('module', 'exports', 'require', 'localStorage', 'crypto', code)(module, module.exports, require, localStorage, webcrypto)
    return module.exports
  }
  const api = load('src/lib/syncData.ts')
  return {api, themes:load('src/lib/themes.ts'), model:load('src/lib/workspace.ts'), schema:load('src/lib/chatStorageSchema.ts'), data, entries, get reads() {return reads}, apply(patch) {for (const [key, value] of Object.entries(patch)) value === null ? entries.delete(key) : entries.set(key, value)}}
}
const clone = value => JSON.parse(JSON.stringify(value))
const workspace = () => ({version: 7, pages: [{id: 'home', name: '首页', label: '首页', components: [{id: 'clock', type: 'clock', config: {}}]}], theme: {active: 'default', mode: 'light', base: 'light'}, themes: [{skin: 'paper', shell: 'standard', id: 'default', name: '默认', description: '', overrides: {}}], layout: {columns: 12, maxWidth: 1480}, widgets: [], statusbar: [], addons: [], templates: [], applications: [], network: [{host: 'local.example', grantedAt: 1}]})
const persona = () => ({soul: {name: '搭搭', text: '性格', aiCanEdit: true, history: [{at: 1, by: 'user', text: '旧性格'}]}, memory: {enabled: true, items: [{id: 'm1', text: '累积记忆', kind: 'fact', by: 'user', at: 1}]}, profile: {role: '个人资料', interests: '', preferences: '', notes: ''}})
const tombstone = {revision: {counter: 3, device: 'remote'}, hash: 'unused', deleted: true}
let passed = 0
async function test(name, work) {await work(); passed++; console.log('通过：' + name)}

await test('Gist配置采样不读数据库，排除业务、隐私、授权与连接，保留设计', async () => {
  const h = runtime({'fp.workspace': workspace(), 'fp.persona': persona(), 'fp.app.a': {count: 3}, 'fp.settings': {name: '用户', proxy: 'local', ai: {model: 'm', baseUrl: 'local-url', extraBody: '{"token":"local"}', apiKey: 'key'}}, 'fp.alwaysAllow': true, 'fp.sync.config': {token: 'private'}})
  const local = await h.api.collect('configuration', false)
  assert.equal(h.reads, 0)
  assert.deepEqual([...local.values.keys()].sort(), ['config:persona', 'config:settings', 'config:workspace'])
  const payload = JSON.stringify([...local.values])
  for (const excluded of ['network', 'profile', 'history', 'items', 'baseUrl', 'extraBody', 'apiKey', 'proxy', 'alwaysAllow', 'private', 'count']) assert.equal(payload.includes('"' + excluded + '"'), false, excluded)
  assert.equal(local.values.get('config:workspace').pages[0].label, '首页')
})
await test('配置墓碑保留本机连接、授权和画像记忆，再次采样不会复活', async () => {
  for (const secrets of [false, true]) {
    const h = runtime({'fp.workspace': workspace(), 'fp.settings': {name: '用户', proxy: 'proxy', monitor: [{id: 'local'}], ai: {model: 'm', baseUrl: 'url', apiKey: 'local-key', extraBody: '{}'}}, 'fp.search': {provider: 'tavily', urls: {searxng: 'url'}, keys: {tavily: 'search-key'}}, 'fp.persona': persona()})
    const local = await h.api.collect('configuration', secrets)
    const update = h.api.changes([...local.values.keys()].map(id => [id, tombstone]), local, 'configuration', secrets)
    h.apply(update.local)
    assert.deepEqual(JSON.parse(h.entries.get('fp.workspace')), {network: workspace().network})
    const settings = JSON.parse(h.entries.get('fp.settings'))
    assert.equal(settings.name, undefined); assert.equal(settings.proxy, 'proxy'); assert.equal(settings.ai.apiKey, 'local-key'); assert.equal(settings.ai.baseUrl, 'url'); assert.equal(settings.ai.model, undefined)
    const savedPersona = JSON.parse(h.entries.get('fp.persona'))
    assert.deepEqual(savedPersona.profile, persona().profile); assert.deepEqual(savedPersona.soul.history, persona().soul.history); assert.deepEqual(savedPersona.memory.items, persona().memory.items); assert.equal(savedPersona.soul.text, undefined)
    assert.equal((await h.api.collect('configuration', secrets)).values.size, 0)
    const full = await h.api.collect('full', secrets)
    assert.equal(full.values.has('config:persona'), true)
    assert.deepEqual(clone(full.values.get('config:persona').profile), persona().profile)
    assert.deepEqual(clone(full.values.get('config:persona').memory.items), persona().memory.items)
    h.api.validateRecord('config:persona', full.values.get('config:persona'), false, 'full')
    assert.equal((await h.api.collect('configuration', secrets)).values.size, 0)
  }
})
await test('配置拉取保留接收设备的凭据、连接、权限与私有画像', async () => {
  const h = runtime({'fp.workspace': workspace(), 'fp.settings': {name: 'old', proxy: 'local-proxy', ai: {model: 'old', baseUrl: 'local', apiKey: 'local-key', extraBody: '{}'}}, 'fp.persona': persona()})
  const local = await h.api.collect('configuration', false), incoming = clone(workspace()); delete incoming.network
  const record = value => ({revision: {counter: 2, device: 'remote'}, hash: 'unused', value})
  h.apply(h.api.changes([['config:workspace', record(incoming)], ['config:settings', record({name: 'new', ai: {model: 'new'}})], ['config:persona', record({soul: {name: '新名', text: '新性格', aiCanEdit: false}, memory: {enabled: false}})]], local, 'configuration', false).local)
  const settings = JSON.parse(h.entries.get('fp.settings'))
  assert.equal(settings.ai.baseUrl, 'local'); assert.equal(settings.ai.apiKey, 'local-key'); assert.equal(settings.ai.model, 'new')
  assert.deepEqual(JSON.parse(h.entries.get('fp.workspace')).network, workspace().network)
  const p = JSON.parse(h.entries.get('fp.persona')); assert.equal(p.soul.text, '新性格'); assert.deepEqual(p.profile, persona().profile); assert.deepEqual(p.memory.items, persona().memory.items)
})
await test('随机头像种子随个人配置往返，拒绝损坏种子', async () => {
  const h = runtime({'fp.settings': {name: '用户', avatarSeed: 'avatar-original'}})
  for (const scope of ['configuration', 'full']) {
    const local = await h.api.collect(scope, false)
    assert.equal(local.values.get('config:settings').avatarSeed, 'avatar-original')
    const incoming = {name: '用户', avatarSeed: 'avatar-new'}
    h.api.validateRecord('config:settings', incoming, false, scope)
    const restored = h.api.applyConfig('settings', incoming, {proxy: 'local'}, scope, false)
    assert.equal(restored.avatarSeed, 'avatar-new')
    assert.equal(restored.proxy, 'local')
    for (const avatarSeed of ['', 42, {}, 'x'.repeat(101)]) {
      assert.throws(() => h.api.validateRecord('config:settings', {avatarSeed}, false, scope))
    }
  }
})
await test('坏空配置不能伪装成删除残留，合法空settings仍保留为记录', async () => {
  for (const key of ['fp.workspace', 'fp.persona', 'fp.focusSettings', 'fp.search']) {
    const h = runtime({[key]: {}})
    await assert.rejects(h.api.collect('configuration', false))
  }
  const h = runtime({'fp.settings': {}})
  const local = await h.api.collect('configuration', false)
  assert.equal(local.values.has('config:settings'), true)
  h.apply(h.api.changes([['config:settings', tombstone]], local, 'configuration', false).local)
  assert.equal(h.entries.has('fp.settings'), false)
})
await test('当前工作空间与persona基本模型严格拒绝坏值，未知版本不静默规整', async () => {
  const h = runtime(), projected = h.api.project('config:workspace', workspace(), 'full', false)
  h.api.validateRecord('config:workspace', projected, false, 'full')
  h.api.validateRecord('config:persona', persona(), false, 'full')
  for (const mutate of [w => w.version = 999, w => w.pages[0].name = {}, w => w.pages[0].components[0].config = null, w => w.layout.columns = -1, w => w.theme.mode = 'broken', w => w.themes[0].overrides = {main: 42}, w => w.applications = [{id: 'a'}], w => w.pages.push(clone(w.pages[0]))]) {
    const w = clone(projected); mutate(w); assert.throws(() => h.api.validateRecord('config:workspace', w, false, 'full'))
  }
  for (const mutate of [p => p.profile.role = {}, p => p.soul.history = [null], p => p.memory.items[0].by = 'remote', p => p.memory.items.push(clone(p.memory.items[0]))]) {
    const p = persona(); mutate(p); assert.throws(() => h.api.validateRecord('config:persona', p, false, 'full'))
  }
})
await test('未知写入目标、配置越权、坏会话关联在codec拒绝', async () => {
  const h = runtime()
  for (const id of ['config:sync.config', 'config:alwaysAllow', 'database:recovery', 'component:a', 'turn:t', 'app:app:a']) assert.throws(() => h.api.validateRecord(id, {}, false, 'configuration'))
  const w = workspace(); assert.throws(() => h.api.validateRecord('config:workspace', w, false, 'configuration'))
  assert.throws(() => h.api.validateAssociations({'turn:t': {value: {convId: 'missing'}}}))
  for (const range of ['1h', '12h', '24h', '1w']) h.api.validateRecord('config:range', range, false, 'full')
  assert.throws(() => h.api.validateRecord('config:range', '30d', false, 'full'))
  for (const [id, value] of [['config:range', ['1h']], ['config:sidebarAi', ['full']], ['config:settings', {theme: ['dark']}], ['config:search', {provider: ['off']}]]) assert.throws(() => h.api.validateRecord(id, value, false, 'full'))
})
await test('完整范围区分App和Applet同名状态、保留嵌套JSON与稳定ID凭据', async () => {
  const h = runtime({'fp.app.same': {value: '旧值不参与'}, 'fp.applet.same': {value: '旧值不参与'}, 'fp.app.legacyOnly': {value: '不迁移'}})
  h.data.apps.push({k: 'app:same', v: {value: 1}}, {k: 'applet:same', v: {value: 2}})
  h.data.kv.push({k: 'same', v: {value: 3}})
  h.data.kv.push({k: 'private', v: [{id: 'a', text: 'A', token: 'A-key'}, {id: 'b', text: 'B', token: 'B-key'}]})
  const local = await h.api.collect('full', false)
  assert.equal(local.values.get('app:app:same').value, 1); assert.equal(local.values.get('app:applet:same').value, 2)
  assert.equal(local.values.get('component:same').value, 3); assert.equal(local.values.has('app:app:legacyOnly'), false)
  const deletion = h.api.changes([['app:app:same', tombstone]], local, 'full', false)
  assert.deepEqual(clone(deletion), {local: {}, operations: [{store: 'apps', type: 'delete', key: 'app:same'}]})
  const saving = h.api.changes([['app:applet:same', {value: {value: 4}}]], local, 'full', false)
  assert.deepEqual(clone(saving), {local: {}, operations: [{store: 'apps', type: 'put', value: {k: 'applet:same', v: {value: 4}}}]})
  const update = h.api.changes([['component:private', {value: [{id: 'b', text: 'new B'}, {id: 'c', text: 'new C'}, {id: 'a', text: 'new A'}]}]], local, 'full', false)
  const rows = clone(update.operations[0].value.v)
  assert.deepEqual(rows.map(row => row.token), ['B-key', undefined, 'A-key'])
})
await test('应用codec双向校验对象与UTF8预算，合回本机凭据仍不能超额', async () => {
  const h = runtime(), big = {text: '中'.repeat(3 * 1024 * 1024)}
  for (const value of [[], null, 1, big]) assert.throws(() => h.api.validateRecord('app:app:a', value, false, 'full'))
  h.data.apps.push({k: 'app:a', v: big})
  await assert.rejects(h.api.collect('full', true))
  const local = {full: new Map([['app:app:a', {token: 'x'.repeat(8 * 1024 * 1024 - 20)}]])}
  assert.throws(() => h.api.changes([['app:app:a', {value: {text: '新'.repeat(20)}}]], local, 'full', false))
})
const conversation={id:'history',title:'完整历史',createdAt:1,updatedAt:10}
const completeTurn=(id='old',convId='history')=>({id,convId,prompt:'完整提问',answer:'完整回答',reasoning:'完整推理',article:{title:'文章',link:'https://example.invalid/article',context:'文章正文'},tools:[{name:'inspect',title:'读取',ok:true,text:'工具正文中文🙂'.repeat(30000)},{name:'verify',title:'核验',ok:false,text:''}],error:'',startedAt:1,endedAt:2})
function seedTurn(h,turn){const split=h.schema.splitTurn(turn);h.data.turns.push(split.turn);h.data.toolDetails.push(...split.details)}
function applyOperations(h,operations){for(const op of operations){const rows=h.data[op.store],key=op.value?.id??op.key,index=rows.findIndex(row=>row.id===key);if(index>=0)rows.splice(index,1);if(op.type==='put')rows.push(op.value)}}
await test('完整聊天采样join所有正文且不暴露本地引用；缺正文阻止采样',async()=>{
  const h=runtime();h.data.convs.push(conversation);const original=completeTurn();seedTurn(h,original)
  const local=await h.api.collect('full',false)
  assert.deepEqual(local.values.get('turn:old'),original)
  assert.equal([...local.values.keys()].some(id=>id.includes('toolDetail')),false)
  assert.equal(JSON.stringify(local.values.get('turn:old')).includes('detailId'),false)
  h.data.toolDetails.pop();await assert.rejects(h.api.collect('full',false),/正文缺失/)
})
await test('同步替换完整轮次原子生成头与正文，旧正文清除且墓碑仅清关联记录',async()=>{
  const h=runtime();h.data.convs.push(conversation,{...conversation,id:'other'});seedTurn(h,completeTurn());seedTurn(h,completeTurn('keep','other'))
  let local=await h.api.collect('full',false)
  const next={...completeTurn(),tools:[{name:'new',title:'新工具',ok:true,text:'新正文'}]}
  const record={revision:{counter:3,device:'remote'},hash:'unused',value:next}
  const update=h.api.changes([['turn:old',record]],local,'full',false);applyOperations(h,update.operations)
  h.schema.validateStoredChat(h.data.convs,h.data.turns,h.data.toolDetails)
  assert.equal(h.data.toolDetails.filter(row=>row.turnId==='old').length,1)
  assert.deepEqual((await h.api.collect('full',false)).values.get('turn:old'),next)
  local=await h.api.collect('full',false);applyOperations(h,h.api.changes([['conversation:history',tombstone]],local,'full',false).operations)
  h.schema.validateStoredChat(h.data.convs,h.data.turns,h.data.toolDetails)
  assert.deepEqual(h.data.turns.map(row=>row.id),['keep']);assert.equal(h.data.toolDetails.length,2)
})
await test('轮次换会话与原会话墓碑不受入站顺序影响，不能删除新正文',async()=>{
  for(const reverse of [false,true]){
    const h=runtime();h.data.convs.push(conversation,{...conversation,id:'other'});seedTurn(h,completeTurn())
    const local=await h.api.collect('full',false),next={...completeTurn(),convId:'other'}
    const records=[['turn:old',{revision:{counter:3,device:'remote'},hash:'unused',value:next}],['conversation:history',tombstone]]
    applyOperations(h,h.api.changes(reverse?records.reverse():records,local,'full',false).operations)
    h.schema.validateStoredChat(h.data.convs,h.data.turns,h.data.toolDetails)
    assert.deepEqual((await h.api.collect('full',false)).values.get('turn:old'),next)
  }
})

await test('派生主题与模板经快照配置双向往返保留完整身份，非法模板整次拒绝', async () => {
  const h = runtime()
  for (const id of ['default', 'ios', 'pixel', 'switch', 'win98']) {
    const source = workspace(); source.theme.active = id; source.themes = h.themes.readThemes([])
    const changed = h.themes.tweakTheme(source, {overrides: {main: '#663399'}, fonts: [{family: 'Noto Sans SC', role: 'sans'}]}).workspace
    const theme = h.model.activeTheme(changed)
    changed.templates = [{id: 'snapshot', name: '快照', description: '', createdAt: 1, updatedAt: 1, snapshot: {pages: changed.pages, statusbar: [], layout: changed.layout, widgets: [], addons: [], applications: [], theme}}]
    for (const scope of ['configuration', 'full']) {
      const projected = h.api.project('config:workspace', changed, scope, false)
      h.api.validateRecord('config:workspace', projected, false, scope)
      const restored = h.api.applyConfig('workspace', clone(projected), workspace(), scope, false)
      assert.deepEqual(clone(restored.themes), clone(changed.themes))
      assert.deepEqual(clone(restored.templates[0].snapshot.theme), clone(theme))
      assert.equal(h.model.activeTheme(restored).shell, theme.shell)
      for (const invalid of [{...theme, shell: 'invalid'}, {...theme, fonts: [{family: 'bad;'}]}, {...theme, origin: {definitionId: 'ios', version: 0}}]) {
        const bad = clone(projected); bad.templates[0].snapshot.theme = invalid
        assert.throws(() => h.api.validateRecord('config:workspace', bad, false, scope))
      }
    }
  }
})
console.log(`同步记录codec回归全部通过：${passed}/${passed}`)
