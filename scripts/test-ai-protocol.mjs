import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import * as core from '@tulai-design/agent-core'

// 默认验证安装的 npm 产物；发布前可以显式指定刚构建的核心包，验证消费端契约。
const providers = await import(process.env.AI_PLATFORM_PROVIDERS_PATH || '@tulai-design/agent-providers')
function compile(relative, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText
  const module = {exports: {}}
  new Function('module', 'exports', 'require', code)(module, module.exports, (name) => {
    assert.ok(name in dependencies, `未隔离的依赖 ${name}`)
    return dependencies[name]
  })
  return module.exports
}
const protocol = compile('../src/lib/aiProtocol.ts', {})
let executions = []
const definitions = ['get_appearance', 'set_theme'].map((name) => ({
  name, title: name, effect: name === 'set_theme' ? 'write' : 'read',
  highRisk: () => false,
  parseArguments: (value) => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value))
    return value
  },
}))
const ai = compile('../src/lib/ai.ts', {
  '@tulai-design/agent-core': core,
  '@tulai-design/agent-providers': providers,
  './aiProtocol': protocol,
  './tools': {
    findTool: (name) => definitions.find((tool) => tool.name === name),
    toolSchemas: () => definitions.map(({name}) => ({type: 'function', function: {name, description: name, parameters: {type: 'object', properties: {}}}})),
    runTool: async (tool, args) => { executions.push({name: tool.name, args}); return '默认外观' },
  },
  './ops': {}, './registry': {}, './workspaceStore': {},
  './persona': {personaPrompt: () => ''}, './skills': {skillIndex: () => ''},
  './permissions': {REMEMBERABLE: {}, setAlwaysAllowed() {}}, './defaults': {OPEN_TARGETS: []},
})
const base = {baseUrl: 'https://aihubmix.com/v1', apiKey: 'test-key', model: 'claude-haiku-5-5'}
const nativeJson = (content, stop_reason = 'end_turn') => new Response(JSON.stringify({
  id: 'msg_test', type: 'message', role: 'assistant', content, stop_reason,
  usage: {input_tokens: 10, output_tokens: 3},
}), {headers: {'content-type': 'application/json'}})
const textResult = () => nativeJson([{type: 'text', text: '已完成'}])
function stream(events) {
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})
}
const toolEvents = (name = 'get_appearance') => [
  {type: 'message_start', message: {id: 'msg_test', type: 'message', role: 'assistant', content: [], stop_reason: null, usage: {input_tokens: 10, output_tokens: 0}}},
  {type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: '', signature: ''}},
  {type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: '先看默认外观'}},
  {type: 'content_block_delta', index: 0, delta: {type: 'signature_delta', signature: 'opaque-test-signature'}},
  {type: 'content_block_stop', index: 0},
  {type: 'content_block_start', index: 1, content_block: {type: 'tool_use', id: 'tool_1', name, input: {}}},
  {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: '{}'}},
  {type: 'content_block_stop', index: 1},
  {type: 'message_delta', delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 10}},
  {type: 'message_stop'},
]
const requests = []
let responses = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  requests.push({url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body)})
  assert.ok(responses.length, '发生了意外重试或多余模型请求')
  return responses.shift()()
}
let passed = 0
async function test(name, run) {
  requests.length = 0; executions = []; responses = []
  await run(); passed++; console.log(`通过：${name}`)
}
async function runAgent(config = base, extra = {}) {
  return ai.runAgent({config, messages: [{role: 'user', content: '帮我看看默认外观'}], host: {openPage() {}}, onDelta() {}, onTool() {}, ...extra})
}
try {
  await test('旧配置自动识别 AiHubMix Claude；GPT、自定义网关和手动覆盖保持可控', () => {
    assert.equal(protocol.resolveAiProtocol(base), 'anthropic')
    assert.equal(protocol.resolveAiProtocol({...base, model: 'gpt-6-luna'}), 'openai')
    assert.equal(protocol.resolveAiProtocol({...base, baseUrl: 'https://example.invalid/v1'}), 'openai')
    assert.equal(protocol.resolveAiProtocol({...base, baseUrl: 'https://aihubmix.com.example.invalid/v1'}), 'openai')
    assert.equal(protocol.resolveAiProtocol({...base, protocol: 'openai'}), 'openai')
    assert.equal(protocol.resolveAiProtocol({...base, baseUrl: 'https://api.anthropic.com'}), 'anthropic')
    assert.equal(protocol.resolveAiProtocol({...base, baseUrl: 'https://example.invalid/v1/messages'}), 'anthropic')
  })
  await test('Messages 文本摘要共用协议；默认不覆盖思考，长度有原生默认值', async () => {
    responses = [textResult]
    const result = await ai.streamText(base, [{role: 'user', content: '总结'}], () => {})
    assert.equal(result, '已完成')
    assert.equal(requests[0].url, 'https://aihubmix.com/v1/messages')
    assert.equal(requests[0].headers.get('x-api-key'), 'test-key')
    assert.equal(requests[0].headers.get('authorization'), null)
    assert.equal(requests[0].body.thinking, undefined)
    assert.equal(requests[0].body.output_config, undefined)
    assert.equal(requests[0].body.max_tokens, 16384)
  })
  await test('高级参数不会添加或替换系统消息、工具列表和协议字段', () => {
    assert.deepEqual(ai.requestExtras({...base, extraBody: JSON.stringify({model: 'bad', messages: [], system: 'bad', tools: [], stream: false, output_config: {effort: 'low'}})}), {output_config: {effort: 'low'}})
  })
  await test('Haiku 5.5 使用 adaptive 与 effort，忽略保存过的采样和惩罚项', async () => {
    responses = [textResult]
    await runAgent({...base, reasoningEffort: 'high', temperature: 0.3, topP: 0.8, presencePenalty: 1, frequencyPenalty: 1})
    const body = requests[0].body
    assert.deepEqual(body.thinking, {type: 'adaptive'})
    assert.equal(body.output_config.effort, 'high')
    for (const key of ['reasoning_effort', 'temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) assert.equal(body[key], undefined)
    assert.equal(body.tools[0].input_schema.type, 'object')
    assert.ok(body.system)
    assert.equal(body.messages.some((message) => message.role === 'system'), false)
  })
  await test('工具在 thinking 后的 index 1 正常执行，续聊保留签名与 tool_result', async () => {
    responses = [() => stream(toolEvents()), textResult]
    let reasoning = ''
    assert.equal(await runAgent(base, {onReasoning: (text) => {reasoning += text}}), '已完成')
    assert.deepEqual(executions, [{name: 'get_appearance', args: {}}])
    const continuation = requests[1].body.messages
    const assistant = continuation.find((message) => message.role === 'assistant')
    assert.deepEqual(assistant.content[0], {type: 'thinking', thinking: '先看默认外观', signature: 'opaque-test-signature'})
    assert.equal(assistant.content[1].id, 'tool_1')
    assert.deepEqual(continuation.at(-1).content, [{type: 'tool_result', tool_use_id: 'tool_1', content: '默认外观'}])
    assert.equal(reasoning, '先看默认外观')
    assert.ok(!reasoning.includes('opaque'))
  })
  await test('原生工具仍走已有审批；拒绝不执行，结果回传模型', async () => {
    responses = [() => stream(toolEvents('set_theme')), textResult]
    let approvals = 0
    await runAgent(base, {permissionMode: 'ask', onApproval: async () => {approvals++; return false}})
    assert.equal(approvals, 1)
    assert.equal(executions.length, 0)
    assert.match(requests[1].body.messages.at(-1).content[0].content, /用户拒绝/)
  })
  await test('已取消的 Agent 不发送模型请求', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => runAgent(base, {signal: controller.signal}), {name: 'AbortError'})
    assert.equal(requests.length, 0)
  })
  await test('取消待决审批立即结束，迟到总是允许不执行工具', async () => {
    responses = [() => stream(toolEvents('set_theme'))]
    const controller = new AbortController()
    let approve
    let ready
    const waiting = new Promise(resolve => {ready = resolve})
    const run = runAgent(base, {signal: controller.signal, permissionMode: 'ask', onApproval: () => new Promise(resolve => {approve = resolve; ready()})})
    const outcome = run.then(() => 'success', error => error.name)
    await waiting
    controller.abort()
    assert.equal(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('pending'), 100))]), 'AbortError')
    approve('always')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(executions.length, 0)
    assert.equal(requests.length, 1)
  })
  await test('截断的 Messages 不执行工具，也不自动换协议重试', async () => {
    responses = [() => stream(toolEvents().slice(0, -2))]
    await assert.rejects(() => runAgent(), /./)
    assert.equal(executions.length, 0)
    assert.equal(requests.length, 1)
  })
  await test('切回 GPT 仍用 Chat Completions、Bearer 和 reasoning_effort', async () => {
    responses = [() => new Response(JSON.stringify({choices: [{message: {role: 'assistant', content: '你好'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}})]
    assert.equal(await runAgent({...base, model: 'gpt-6-luna', reasoningEffort: 'low'}), '你好')
    const request = requests[0]
    assert.equal(request.url, 'https://aihubmix.com/v1/chat/completions')
    assert.equal(request.headers.get('authorization'), 'Bearer test-key')
    assert.equal(request.body.reasoning_effort, 'low')
    assert.equal(request.body.thinking, undefined)
  })
  await test('手动选择 OpenAI 时错误的工具索引失败且不执行、不重复请求', async () => {
    const deltas = [
      {tool_calls: [{index: 0, id: 'tool_1', type: 'function', function: {name: 'get_appearance', arguments: ''}}]},
      {tool_calls: [{index: 0, function: {arguments: ''}}]},
      {tool_calls: [{index: 1, function: {arguments: '{}'}}]},
    ]
    responses = [() => new Response(deltas.map((delta, i) => `data: ${JSON.stringify({choices: [{index: 0, delta, finish_reason: i === 2 ? 'tool_calls' : null}]})}\n\n`).join('') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}})]
    await assert.rejects(() => runAgent({...base, protocol: 'openai'}), /JSON|工具/)
    assert.equal(executions.length, 0)
    assert.equal(requests.length, 1)
  })
} finally {
  globalThis.fetch = realFetch
}
console.log(`AI 协议集成：${passed} 项通过`)
