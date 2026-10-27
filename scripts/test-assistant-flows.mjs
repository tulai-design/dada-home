import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const ts = require('typescript')
// 用项目编译器载入真实校验逻辑，不要求运行测试的 Node 原生支持 TypeScript。
const widgetModule = {exports: {}}
const widgetJs = ts.transpileModule(fs.readFileSync('src/lib/customWidget.ts', 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText
new Function('module', 'exports', widgetJs)(widgetModule, widgetModule.exports)
const {normalizeHost} = widgetModule.exports
const source = fs.readFileSync('src/App.tsx', 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
const visit = node => {if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node); ts.forEachChild(node, visit)}
visit(ast)
const callbackJs = name => ts.transpileModule(`const ${name} = ${declarations.get(name).initializer.arguments[0].getText(ast)}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText
const askJs = callbackJs('ask')
const makeAsk = ({initChat = async () => {}, newConv = async () => {}, configured = true} = {}) => {
  let rows = []
  let busy = false
  const abortRef = {current: null}
  const agents = []
  const errors = []
  const dependencies = {abortRef, initChat, newConv, beginTurn: prompt => ({id: prompt, prompt, tools: [], answer: '', reasoning: '', error: ''}), articleContext: article => `REFERENCE:${article.title}`, aiConfigured: configured, setTurns: next => {rows = next(rows)}, contextTurns: turns => turns, turns: [], settings: {ai: {contextTurns: 24}, name: 'test'}, turnContent: turn => turn.article ? `${turn.article.context}\n\n用户的问题：\n${turn.prompt}` : turn.prompt, setBusy: value => {busy = value}, settleRef: {current: null}, openSettings() {}, openApplication() {}, inspectPage: async () => ({status: 'unavailable', issues: [], unknown: [{code: 'fixture-without-page'}]}), runAgent: options => new Promise(resolve => {agents.push({options, resolve})}), toast: {error: error => errors.push(error)}}
  return {ask: new Function(...Object.keys(dependencies), `${askJs}; return ask`)(...Object.values(dependencies)), abortRef, agents, errors, rows: () => rows, busy: () => busy}
}
let releaseInit
const gate = new Promise(resolve => {releaseInit = resolve})
const concurrent = makeAsk({initChat: () => gate})
const first = concurrent.ask('one')
const firstController = concurrent.abortRef.current
const second = concurrent.ask('two')
await second
assert.equal(concurrent.busy(), true)
assert.ok(firstController instanceof AbortController)
assert.equal(concurrent.abortRef.current, firstController)
releaseInit()
await Promise.resolve()
await Promise.resolve()
assert.equal(concurrent.agents.length, 1, 'only one request enters agent while init is pending')
assert.equal(concurrent.busy(), true)
concurrent.agents[0].resolve()
await first
assert.equal(concurrent.busy(), false)
assert.equal(concurrent.abortRef.current, null)
const setupFailure = makeAsk({initChat: async () => {throw new Error('Storage unavailable')}})
await setupFailure.ask('one')
assert.equal(setupFailure.busy(), false)
assert.equal(setupFailure.abortRef.current, null)
assert.equal(setupFailure.agents.length, 0)
assert.deepEqual(setupFailure.errors, ['Storage unavailable'])
const newConvFailure = makeAsk({newConv: async () => {throw new Error('Flush unavailable')}})
await newConvFailure.ask('one', {fresh: true})
assert.equal(newConvFailure.busy(), false)
assert.equal(newConvFailure.abortRef.current, null)
assert.equal(newConvFailure.agents.length, 0)
const unconfigured = makeAsk({configured: false})
await unconfigured.ask('one')
assert.equal(unconfigured.rows().length, 1)
assert.equal(unconfigured.busy(), false)
assert.equal(unconfigured.abortRef.current, null)
const article = makeAsk()
const askingArticle = article.ask('我的问题', {fresh: true, article: {title: '文章标题', link: 'https://example.com/a'}})
await Promise.resolve()
await Promise.resolve()
assert.equal(article.rows()[0].prompt, '我的问题')
assert.equal(article.rows()[0].article.context, 'REFERENCE:文章标题')
assert.ok(article.agents[0].options.messages.at(-1).content.includes('REFERENCE:文章标题'))
assert.ok(article.agents[0].options.messages.at(-1).content.endsWith('我的问题'))
article.agents[0].resolve()
await askingArticle
let workspace = {network: []}
let prompt = null
const grantQueue = {current: []}
const grantHost = (ws, host) => ws.network.some(grant => grant.host === host) ? ws : {...ws, network: [...ws.network, {host}]}
const grantDependencies = {normalizeHost, getWorkspace: () => workspace, grantQueue, setGrantPrompt: value => {prompt = value}, edit: fn => {workspace = fn(workspace)}, grantHost}
const grantJs = callbackJs('requestNetworkGrant') + callbackJs('answerNetworkGrant')
const {requestNetworkGrant, answerNetworkGrant} = new Function(...Object.keys(grantDependencies), `${grantJs}; return {requestNetworkGrant, answerNetworkGrant}`)(...Object.values(grantDependencies))
const a = requestNetworkGrant('A.example')
assert.equal(requestNetworkGrant('a.example'), a, 'same host shares one confirmation promise')
const b = requestNetworkGrant('b.example')
assert.equal(prompt, 'a.example')
let bSettled = false
b.then(() => {bSettled = true})
answerNetworkGrant('a.example', true)
answerNetworkGrant('a.example', true)
answerNetworkGrant('a.example', false)
assert.equal(await a, true)
await Promise.resolve()
assert.equal(bSettled, false, 'repeated old modal callbacks cannot settle next domain')
assert.equal(prompt, 'b.example')
assert.deepEqual(workspace.network.map(grant => grant.host), ['a.example'])
answerNetworkGrant('b.example', false)
assert.equal(await b, false)
assert.equal(prompt, null)
assert.deepEqual(workspace.network.map(grant => grant.host), ['a.example'])
const retry = requestNetworkGrant('b.example')
assert.notEqual(retry, b)
answerNetworkGrant('b.example', true)
assert.equal(await retry, true)
assert.equal(await requestNetworkGrant('b.example'), true)
assert.equal(prompt, null)
console.log('PASS: ask concurrency lock, init/flush/unconfigured cleanup, article attachment, same-host grant dedupe, stale modal callback isolation, denial and explicit retry')
