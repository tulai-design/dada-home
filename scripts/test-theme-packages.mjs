import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import vm from 'node:vm'

// 执行真实codec/主题/安装事务边界，只替换物理DB和宿主工作空间，不触碰用户数据。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map(), mocks = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}; cache.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === 'react') return {useCallback: fn => fn, useSyncExternalStore() {}}
    assert.ok(id.startsWith('.'), id)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', 'localStorage', compiled)(module, module.exports, require, {getItem: () => null, setItem() {}})
  return module.exports
}
const model = load('src/lib/workspace.ts'), themes = load('src/lib/themes.ts')
const identity = {packageId: 'test.future', version: '1.0.0', digest: 'a'.repeat(64)}
const unknown = {id: 'future-theme', name: '未来主题', description: '保留依赖', skin: 'future-skin', shell: 'future-shell', overrides: {radius: '8px'}, fonts: [], packageRef: {...identity, themeId: 'future'}, rendererContract: {schemaVersion: 1, skinVersion: 2, shellVersion: 2}}
// Red：7fa143a在assertThemeEntry抛“主题身份、名称或造型/外壳引用无效”。
themes.assertThemeEntry(unknown)
assert.deepEqual(themes.readThemes([unknown]).find(theme => theme.id === unknown.id), unknown)
assert.equal(themes.resolveTheme(unknown, 'light').skin, 'paper')
console.log('通过：未知renderer保留合法设计与包引用，实际安全回退')

const codec = load('src/lib/themePackages/codec.ts')
const state = load('src/lib/themePackages/state.ts')
const boundary = load('src/lib/themePackages/boundary.ts')
const fontResource = load('src/lib/fontResource.ts')
const fontFile = readFileSync(path.join(root, 'node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'))
const bytes = Uint8Array.from(fontFile).buffer
const sha = await fontResource.sha256Bytes(bytes)
const definition = (() => {const {id, builtin, fonts, ...design} = structuredClone(model.IOS_THEME); return {...design, fonts: [{family: 'Local Test', role: 'sans', resourceId: 'main'}]}})()
async function fixture(packageId = 'test.local', version = '1.0.0', design = definition) {
  const manifest = {packageId, version, digest: '', kind: 'declarative-theme', schemaVersion: 1, name: '本地字体包', description: '隔离测试', requiredRenderers: [{skin: design.skin, shell: design.shell, skinVersion: 1, shellVersion: 1}], contributions: [{id: 'main', kind: 'theme', design: structuredClone(design)}], resources: [{id: 'main', mime: 'font/woff2', bytes: bytes.byteLength, sha256: sha}]}
  manifest.digest = await codec.themePackageDigest(manifest)
  return {manifest, resources: [{id: 'main', bytes: bytes.slice(0)}]}
}
let count = 0
async function test(name, run) {await run(); count += 1; console.log(`通过：${name}`)}
const input = await fixture()
await test('公开unknown入口拒绝非JSON对象、Symbol/数组额外属性，跨realm普通JSON保留', async () => {
  for (const bad of [new Date(), new Map(), new Uint8Array([1]), Object.assign([], {extra: 1}), {[Symbol('lost')]: 1}, Object.defineProperty({}, 'hidden', {value: 1}), Object.defineProperty({}, 'getter', {get: () => 1, enumerable: true})]) {
    const theme = {...unknown, opaqueDesign: {schemaVersion: 7, payload: {bad}}}
    assert.throws(() => themes.assertThemeEntry(theme), /JSON|Symbol|额外|隐藏|访问器|普通/)
    const invalid = structuredClone(input)
    invalid.manifest.extra = bad
    assert.throws(() => codec.cloneThemePackageImport(invalid), /JSON|Symbol|额外|隐藏|访问器|普通/)
  }
  boundary.assertBoundedJson(vm.runInNewContext('({plain: [1, "ok", null]})'))
})
await test('真实WOFF2文件解析、摘要、内部ref hydrate与本地alias实际解析', async () => {
  const parsed = await codec.parseThemePackage(codec.serializeThemePackage(input))
  const theme = codec.hydrateThemePackage(parsed.manifest, 'main', 'local-instance')
  assert.equal(theme.fonts[0].resource.digest, input.manifest.digest)
  assert.equal(theme.fonts[0].resource.sha256, sha)
  assert.match(load('src/lib/fonts.ts').fontVars(theme.fonts)['font-sans'], new RegExp(`TadaLocal_${sha}`))
  assert.equal(parsed.resources[0].bytes.byteLength, bytes.byteLength)
})
await test('坏摘要、坏字体、重复资源、路径、未知字段、无themeId与默认联网明确拒绝', async () => {
  const raw = JSON.parse(codec.serializeThemePackage(input))
  for (const mutate of [r => {r.manifest.name = '篡改'}, r => {r.resources[0].base64 = 'AAAA'}, r => {r.resources.push(r.resources[0])}, r => {r.manifest.resources[0].id = '../font'}, r => {r.manifest.extra = 1}, r => {delete r.manifest.contributions[0].design.fonts}]) {
    const modified = structuredClone(raw); mutate(modified)
    await assert.rejects(codec.parseThemePackage(JSON.stringify(modified)))
  }
  assert.throws(() => themes.assertThemeEntry({...unknown, packageRef: identity}), /贡献|引用|无效/)
  assert.throws(() => themes.assertThemeEntry({...model.IOS_THEME, packageRef: {...identity, themeId: 'main'}, rendererContract: unknown.rendererContract, fonts: []}), /内置主题ID|冒用|内置/)
})
await test('未知schema envelope往返、不执行及即时编辑拒绝', async () => {
  const opaque = {...unknown, rendererContract: {...unknown.rendererContract, schemaVersion: 7}, opaqueDesign: {schemaVersion: 7, payload: {future: {a: ['保留', 2]}}}}
  themes.assertThemeEntry(opaque)
  assert.deepEqual(themes.readThemes([opaque]).find(theme => theme.id === opaque.id).opaqueDesign, opaque.opaqueDesign)
  assert.equal(themes.resolveTheme(opaque, 'light').availability.status, 'unsupported')
  const workspace = {themes: themes.readThemes([opaque]), theme: {active: opaque.id, mode: 'light', base: 'light'}}
  assert.throws(() => themes.tweakTheme(workspace, {overrides: {main: '#112233'}}), /不可编辑|未知/)
  assert.throws(() => themes.saveTheme(workspace, {name: '不能猜', from: opaque.id}), /不可编辑|未知/)
})
await test('包备份含字节且恢复disabled，运行验证不改变原启用状态', async () => {
  const stored = {...input, k: 'test.local@1.0.0', enabled: true, generation: 3, installedAt: 1, state: 'installed'}
  const serialized = codec.serializeStoredThemePackage(stored)
  assert.equal(serialized.enabled, false)
  const restored = codec.deserializeStoredThemePackage(serialized)
  assert.equal(restored.enabled, false)
  assert.equal((await codec.validateStoredThemePackage(restored)).resources[0].bytes.byteLength, bytes.byteLength)
  assert.equal((await codec.validateStoredThemePackage(stored)).enabled, true)
  const tampered = structuredClone(restored); new Uint8Array(tampered.resources[0].bytes)[60] ^= 1
  await assert.rejects(codec.validateStoredThemePackage(tampered), /摘要|字体|WOFF2/)
})
await test('未知包只保留完整无资源metadata，原文导出且不能吞资源假安装', async () => {
  const manifest = {packageId: 'test.unknown', version: '1.0.0', digest: '', kind: 'future-kind', schemaVersion: 9, name: '新类型', description: '', extra: {future: 1}, resources: []}
  manifest.digest = await codec.themePackageDigest(manifest)
  const raw = {manifest, resources: []}
  const parsed = await codec.parseThemePackage(JSON.stringify(raw))
  assert.deepEqual(JSON.parse(codec.serializeThemePackage(parsed)), raw)
  await assert.rejects(codec.parseThemePackage(JSON.stringify({...raw, resources: [{id: 'lost', base64: 'AAAA'}]})), /未知|资源|不支持/)
  const malformed = structuredClone(raw); delete malformed.manifest.kind
  await assert.rejects(codec.parseThemePackage(JSON.stringify(malformed)))
})
await test('全仓预算与精确版本数量保护，目录排序固定字典序', () => {
  const row = {...input, k: 'test.local@1.0.0', enabled: false, generation: 1, installedAt: 1, state: 'installed'}
  assert.throws(() => codec.assertThemePackageRepositoryBudget(Array.from({length: 17}, (_, i) => ({...row, k: `p-${i}`}))), /版本|数量|预算/)
  assert.equal(boundary.canonicalJson({a: 1, Z: 2, A: 3}), '{"A":3,"Z":2,"a":1}')
})

const database = new Map(), persistenceFailures = []
let dbWrites = 0, gate = null
const persistence = {assertPersistenceWritable() {}, clearPersistenceError() {}, reportPersistenceError: (...args) => persistenceFailures.push(args)}
mocks.set(path.resolve(root, 'src/lib/persistence.ts'), persistence)
mocks.set(path.resolve(root, 'src/lib/db.ts'), {db: {
  async all() {return [...database.values()].map(row => structuredClone(row))},
  async atomic(_stores, reads, decide) {
    if (gate) await gate
    const values = reads.map(read => read.all ? [...database.values()].map(row => structuredClone(row)) : structuredClone(database.get(read.key)))
    const plan = decide(values)
    for (const operation of plan.operations) {
      dbWrites += 1
      if (operation.type === 'put') database.set(operation.value.k, structuredClone(operation.value))
      else if (operation.type === 'delete') database.delete(operation.key)
    }
    return plan.result
  },
}})
let current = {version: model.WORKSPACE_VERSION, pages: [{id: 'home', name: '首页', label: '首页', components: []}], statusbar: [], layout: {columns: 12, maxWidth: 1440}, widgets: [], applications: [], templates: [], addons: [], themes: themes.readThemes([]), theme: {active: 'ios', mode: 'light', base: 'light'}}
let commits = 0
const workspaceListeners = new Set()
const host = {getWorkspace: () => current, commit: next => {current = next; commits += 1; workspaceListeners.forEach(listener => listener())}, subscribeWorkspace: listener => {workspaceListeners.add(listener); return () => workspaceListeners.delete(listener)}}
mocks.set(path.resolve(root, 'src/lib/workspaceStore.ts'), host)
const repository = load('src/lib/themePackages/repository.ts')
const store = load('src/lib/themePackages/store.ts')
let prepare = async () => ({ready: true, release() {}})
store.registerThemePackageRuntime({prepare: (theme, options) => prepare(theme, options)})
await test('安装disabled不改工作空间，同版本重复幂等/摘要冲突拒绝且不污染保存屏障', async () => {
  const first = await repository.installThemePackage(input)
  assert.equal(first.enabled, false); assert.equal(commits, 0); assert.equal(dbWrites, 1)
  await repository.installThemePackage(input)
  assert.equal(dbWrites, 1)
  const conflict = await fixture(); conflict.manifest.name = '不同内容'; conflict.manifest.digest = await codec.themePackageDigest(conflict.manifest)
  await assert.rejects(repository.installThemePackage(conflict), /不可变|摘要|覆盖/)
  await repository.flushThemePackages()
  assert.equal(persistenceFailures.length, 0)
})
await test('saveBarrier式flush追踪调用后仍在hash中的安装，非法包不留下dirty', async () => {
  const second = await fixture('test.second')
  let release
  gate = new Promise(resolve => {release = resolve})
  const installing = repository.installThemePackage(second)
  let done = false
  const flushing = repository.flushThemePackages().then(() => {done = true})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(done, false)
  gate = null; release(); await installing; await flushing
  const broken = structuredClone(second); broken.manifest.name = 'hash错'
  await assert.rejects(repository.installThemePackage(broken))
  await repository.flushThemePackages()
})
await test('排队等待期间取消不迟到启用，后续保存屏障仍成功且无持久化故障', async () => {
  const third = await fixture('test.third')
  let release
  gate = new Promise(resolve => {release = resolve})
  const installing = repository.installThemePackage(third)
  const controller = new AbortController()
  const enabling = store.setThemePackageEnabled((await fixture('test.second')).manifest, true, {signal: controller.signal})
  await new Promise(resolve => setTimeout(resolve, 0))
  controller.abort()
  gate = null; release()
  await installing
  await assert.rejects(enabling, error => error.name === 'AbortError')
  await repository.flushThemePackages()
  assert.equal(persistenceFailures.length, 0)
  assert.equal(repository.listThemePackages().find(row => row.packageId === 'test.second').enabled, false)
})
await test('启用资源预备读取真实bytes，激活合并最新业务且保留精确依赖', async () => {
  prepare = async (theme, options) => {
    const local = await options.localResources(theme.fonts[0].resource)
    assert.equal(local.byteLength, bytes.byteLength)
    current = {...current, pages: [...current.pages, {id: 'during-prepare', name: '新页面', components: []}]}
    return {ready: true, release() {}}
  }
  await store.setThemePackageEnabled(input.manifest, true)
  const theme = await store.activateThemePackage(input.manifest, 'main')
  assert.equal(current.theme.active, theme.id); assert.ok(current.pages.some(page => page.id === 'during-prepare'))
  assert.equal(themes.resolveTheme(theme, 'light').skin, 'ios')
  assert.equal(themes.resolveTheme(theme, 'light').availability.status, 'available')
  const read = await repository.readLocalThemeFont(theme.fonts[0].resource)
  new Uint8Array(read)[0] = 0
  assert.equal(new Uint8Array(await repository.readLocalThemeFont(theme.fonts[0].resource))[0], 0x77)
})
await test('停用回退不改请求，普通个人主题字体引用同样检查且保护卸载', async () => {
  const requested = current.themes.find(theme => theme.id === current.theme.active)
  const saved = structuredClone(requested)
  await store.setThemePackageEnabled(input.manifest, false)
  const resolved = themes.resolveTheme(requested, 'light')
  assert.equal(resolved.skin, 'paper'); assert.equal(resolved.shell, 'standard'); assert.deepEqual(resolved.effectiveFonts, [])
  assert.deepEqual(requested, saved)
  const personal = {...requested, id: 'personal'}; delete personal.packageRef; delete personal.rendererContract
  assert.equal(themes.resolveTheme(personal, 'light').availability.status, 'disabled')
  current = {...current, themes: [...themes.readThemes([]), personal], theme: {...current.theme, active: personal.id}}
  await assert.rejects(store.uninstallThemePackage(input.manifest), /引用|依赖|卸载/)
  assert.equal(persistenceFailures.length, 0)
  await repository.flushThemePackages()
})
await test('取消在init/排队/prepare后都不迟到启用，ABA状态废弃旧作者检查', async () => {
  const controller = new AbortController()
  prepare = async () => {controller.abort(); return {ready: true, release() {}}}
  await assert.rejects(store.setThemePackageEnabled(input.manifest, true, {signal: controller.signal}), error => error.name === 'AbortError')
  assert.equal(repository.listThemePackages().find(row => row.packageId === input.manifest.packageId).enabled, false)
  prepare = async () => ({ready: true, release() {}})
  await store.setThemePackageEnabled(input.manifest, true)
  const domain = load('src/lib/themeAuthoring/draft.ts')
  const draft = domain.createDraft(current, {intent: 'derive'}, 0)
  await store.setThemePackageEnabled(input.manifest, false)
  await store.setThemePackageEnabled(input.manifest, true)
  assert.match(domain.draftConflict(current, draft, 0), /能力|主题|目录|变化/)
  const ordinary = {...current, theme: {...current.theme, active: 'ios'}}
  const plain = domain.createDraft(ordinary, {intent: 'derive'}, 0)
  await store.setThemePackageEnabled((await fixture('test.second')).manifest, true)
  assert.equal(domain.draftConflict(ordinary, plain, 0), null)
})
await test('未保存草稿保护独占本地字体引用，取消后可卸载', async () => {
  const author = load('src/lib/themeAuthoring/store.ts')
  current = {...current, themes: themes.readThemes([]), theme: {...current.theme, active: 'ios'}}
  const draft = author.createThemeDraft({intent: 'derive'})
  author.updateThemeDraft({draftId: draft.id, expectedRevision: draft.revision, operations: [{path: 'fonts', scope: 'resource', value: [{family: 'Local Test', role: 'sans', resource: {...input.manifest, resourceId: 'main', sha256: sha}}].map(font => ({...font, resource: {packageId: input.manifest.packageId, version: input.manifest.version, digest: input.manifest.digest, resourceId: 'main', sha256: sha}}))}]})
  assert.equal(store.getThemePackageDependents(input.manifest).some(item => item.kind === 'draft'), true)
  await assert.rejects(store.uninstallThemePackage(input.manifest), /草稿|引用/)
  author.discardThemeDraft({draftId: draft.id, expectedRevision: draft.revision + 1})
  await store.uninstallThemePackage(input.manifest)
  assert.equal(repository.listThemePackages().some(row => row.packageId === input.manifest.packageId), false)
})
await test('完整变体导出拒绝远端字体，系统字体包可重新导入且源对象不变', async () => {
  await assert.rejects(store.exportThemeWithDependencies(model.IOS_THEME), /远端|字体|系统/)
  const theme = {...structuredClone(model.IOS_THEME), id: 'system-theme', fonts: []}; delete theme.builtin
  const original = structuredClone(theme)
  const exported = await store.exportThemeWithDependencies(theme)
  const parsed = await codec.parseThemePackage(exported)
  assert.equal(parsed.manifest.contributions[0].design.name, theme.name)
  assert.deepEqual(theme, original)
})
await test('启用预备期间卸载并重装同版本，旧请求不得启用新的安装', async () => {
  const fresh = await fixture('test.reinstall')
  await repository.installThemePackage(fresh)
  let ready, release
  const waiting = new Promise(resolve => {ready = resolve})
  const gate = new Promise(resolve => {release = resolve})
  prepare = async () => {ready(); await gate; return {ready:true,release(){}}}
  const enabling = store.setThemePackageEnabled(fresh.manifest, true)
  const rejected = assert.rejects(enabling, /安装|状态|变化/)
  await waiting
  await store.uninstallThemePackage(fresh.manifest)
  await repository.installThemePackage(fresh)
  release()
  await rejected
  assert.equal(repository.listThemePackages().find(row => row.packageId === fresh.manifest.packageId).enabled, false)
  await repository.flushThemePackages()
  assert.equal(persistenceFailures.length, 0)
  prepare = async () => ({ready:true,release(){}})
})
await test('已有renderer名称的未来合同版本保留新字段与精确依赖，不误用当前目录丢设计', async () => {
  const future = await fixture('test.future-version')
  future.manifest.requiredRenderers[0].skinVersion = 2
  future.manifest.contributions[0].design.overrides['future-token'] = 'future-value'
  future.manifest.digest = await codec.themePackageDigest(future.manifest)
  const parsed = await codec.parseThemePackage(codec.serializeThemePackage(future))
  const theme = codec.hydrateThemePackage(parsed.manifest, 'main', 'future-contract')
  themes.assertThemeEntry(theme)
  assert.deepEqual(themes.readThemes([theme]).find(item => item.id === theme.id), theme)
  assert.equal(themes.resolveTheme(theme, 'light').skin, 'paper')
  assert.equal(themes.resolveTheme(theme, 'light').availability.status, 'incompatible')
  const stored = await repository.installThemePackage(parsed)
  await assert.rejects(store.setThemePackageEnabled(stored, true), /合同|支持/)
  const exported = await codec.parseThemePackage(await store.exportThemePackage(stored))
  assert.equal(exported.manifest.requiredRenderers[0].skinVersion, 2)
  assert.equal(exported.manifest.contributions[0].design.overrides['future-token'], 'future-value')
})
console.log(`主题包领域/事务回归：${count} 项通过`)
