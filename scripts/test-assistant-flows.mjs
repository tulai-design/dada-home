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
const tick = () => new Promise(resolve => setImmediate(resolve))
const makeAsk = ({initChat = async () => {}, newConv = async () => 'fresh', configured = true, loadContextTurns = async () => []} = {}) => {
  const rows = new Map()
  let currentConv = 'original'
  let busy = false
  const abortRef = {current: null}
  const agents = []
  const errors = []
  const contextCalls = []
  const dependencies = {
    abortRef, initChat, newConv, getChatState: () => ({convId: currentConv}),
    beginTurn: prompt => ({id: prompt, prompt, tools: [], answer: '', reasoning: '', error: ''}),
    articleContext: article => `REFERENCE:${article.title}`, aiConfigured: configured,
    appendTurn: (convId, turn) => rows.set(convId + ':' + turn.id, {...turn, convId}),
    patchTurn: (convId, id, part) => {const key=convId+':'+id;assert.ok(rows.has(key));rows.set(key,{...rows.get(key),...part})},
    appendTool: (convId, id, tool) => {const key=convId+':'+id;const turn=rows.get(key);assert.ok(turn);rows.set(key,{...turn,tools:[...turn.tools,tool]})},
    loadContextTurns: async (convId, limit) => {contextCalls.push({convId, limit});return loadContextTurns(convId,limit)},
    settings: {ai: {contextTurns: 100}, name: 'test'},
    turnContent: turn => turn.article ? `${turn.article.context}\n\n用户的问题：\n${turn.prompt}` : turn.prompt,
    setBusy: value => {busy = value}, settleRef: {current: null}, openSettings() {}, openApplication() {},
    inspectHomepageDraft: async () => ({status: 'unavailable', issues: [], unknown: [{code: 'fixture-without-draft'}]}),
    inspectPage: async () => ({status: 'unavailable', issues: [], unknown: [{code: 'fixture-without-page'}]}),
    runAgent: options => new Promise(resolve => {agents.push({options, resolve})}), toast: {error: error => errors.push(error)},
  }
  return {ask: new Function(...Object.keys(dependencies), `${askJs}; return ask`)(...Object.values(dependencies)), abortRef, agents, errors, contextCalls, rows: () => [...rows.values()], busy: () => busy, navigate: id => {currentConv=id}}
}
let releaseInit
const gate = new Promise(resolve => {releaseInit = resolve})
const concurrent = makeAsk({initChat: () => gate})
const first = concurrent.ask('one')
const firstController = concurrent.abortRef.current
await concurrent.ask('two')
assert.equal(concurrent.busy(), true)
assert.ok(firstController instanceof AbortController)
assert.equal(concurrent.abortRef.current, firstController)
releaseInit();await tick()
assert.equal(concurrent.agents.length, 1, 'only one request enters agent while init is pending')
concurrent.agents[0].resolve();await first
assert.equal(concurrent.busy(), false)
assert.equal(concurrent.abortRef.current, null)
for(const options of [
  {initChat: async () => {throw new Error('Storage unavailable')}},
  {newConv: async () => {throw new Error('Flush unavailable')}},
  {loadContextTurns: async () => {throw new Error('History unavailable')}},
]) {
  const failure=makeAsk(options)
  await failure.ask('one', options.newConv ? {fresh:true} : undefined)
  assert.equal(failure.busy(),false);assert.equal(failure.abortRef.current,null);assert.equal(failure.agents.length,0)
  assert.equal(failure.errors.length,1);assert.equal(failure.rows().length,0,'failed history never falls back to visible UI or appends a partial turn')
}
const unconfigured = makeAsk({configured: false})
await unconfigured.ask('one')
assert.equal(unconfigured.rows().length, 1)
assert.equal(unconfigured.busy(), false)
assert.equal(unconfigured.abortRef.current, null)
const article = makeAsk()
const askingArticle = article.ask('我的问题', {fresh: true, article: {title: '文章标题', link: 'https://example.com/a'}})
await tick()
assert.equal(article.rows()[0].prompt, '我的问题')
assert.equal(article.rows()[0].convId, 'fresh')
assert.equal(article.rows()[0].article.context, 'REFERENCE:文章标题')
assert.ok(article.agents[0].options.messages.at(-1).content.includes('REFERENCE:文章标题'))
assert.ok(article.agents[0].options.messages.at(-1).content.endsWith('我的问题'))
assert.equal(article.contextCalls.length,0,'fresh conversations carry no old history')
article.agents[0].resolve();await askingArticle

// UI may have any number of loaded pages; ask gets the repository history independently.
const history=[{prompt:'仅仓库中的历史',answer:'旧回答',reasoning:'不带思考',tools:[{text:'不带工具'}]}, {prompt:'文章追问',answer:'',article:{context:'原文'}}]
let releaseHistory
const historyGate=new Promise(resolve=>{releaseHistory=resolve})
const navigation=makeAsk({loadContextTurns:async()=>{await historyGate;return history}})
const sending=navigation.ask('继续')
await tick();navigation.navigate('other')
assert.deepEqual(navigation.contextCalls,[{convId:'original',limit:100}])
await navigation.ask('重复发送');assert.equal(navigation.agents.length,0)
releaseHistory();await tick()
assert.deepEqual(navigation.agents[0].options.messages,[
 {role:'user',content:'仅仓库中的历史'}, {role:'assistant',content:'旧回答'},
 {role:'user',content:'原文\n\n用户的问题：\n文章追问'}, {role:'user',content:'继续'},
])
const agent=navigation.agents[0]
agent.options.onDelta('第一段');agent.options.onReasoning('推理');agent.options.onTool({name:'read',title:'读取',ok:true,text:'完整工具正文'})
navigation.navigate('third');agent.options.onDelta('第二段')
assert.equal(navigation.rows().length,1);assert.equal(navigation.rows()[0].convId,'original')
assert.equal(navigation.rows()[0].answer,'第一段第二段');assert.equal(navigation.rows()[0].tools[0].text,'完整工具正文')
agent.resolve();await sending;assert.ok(navigation.rows()[0].endedAt)

let releaseCancel
const cancelled=makeAsk({loadContextTurns:()=>new Promise(resolve=>{releaseCancel=resolve})})
const waiting=cancelled.ask('等待期间中止');await tick();cancelled.abortRef.current.abort();releaseCancel([]);await waiting
assert.equal(cancelled.agents.length,0);assert.equal(cancelled.rows().length,0);assert.equal(cancelled.busy(),false)
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
console.log('PASS: ask target binding, independent paged history, abort/context-failure cleanup, cross-conversation streaming, article attachment, same-host grant dedupe, stale modal callback isolation, denial and explicit retry')
