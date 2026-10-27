import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const storage = new Map()
let calls = []
let respond
const module = {exports: {}}
const source = readFileSync(new URL('../src/lib/models.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(compiled, {
  module, exports: module.exports, URL,
  localStorage: {getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value)},
  fetch: async (url, init) => {calls.push({url, ...init}); return respond(url, init)},
})
const {fetchModels, cachedModels, parseModelList, detectProvider} = module.exports
const plain = (value) => JSON.parse(JSON.stringify(value))
let count = 0
async function test(name, run) {
  calls = []
  storage.clear()
  respond = () => Response.json({data: [{id: 'claude-haiku-5-5'}, {id: 'gpt-6-luna'}]})
  await run()
  console.log(`通过：${name}`)
  count += 1
}

await test('OpenAI 模型列表保留 Bearer 鉴权、AbortSignal 和缓存', async () => {
  const controller = new AbortController()
  const list = await fetchModels('https://api.openai.com/v1/', ' fake-key ', '', controller.signal)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models')
  assert.equal(calls[0].headers.authorization, 'Bearer fake-key')
  assert.equal(calls[0].headers['x-api-key'], undefined)
  assert.equal(calls[0].signal, controller.signal)
  assert.deepEqual(plain(cachedModels('https://api.openai.com/v1')), plain(list))
})

await test('Anthropic 根地址、v1 和完整 Messages 地址统一发现模型', async () => {
  for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages']) {
    await fetchModels(base, 'native-key', '', undefined, 'anthropic')
  }
  for (const call of calls) {
    assert.equal(call.url, 'https://api.anthropic.com/v1/models')
    assert.equal(call.headers['x-api-key'], 'native-key')
    assert.equal(call.headers['anthropic-version'], '2023-06-01')
    assert.equal(call.headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(call.headers.authorization, undefined)
  }
})

await test('自定义 Messages 地址保留前缀，浏览器专用头仅发往 Anthropic 官方', async () => {
  await fetchModels('https://gateway.example/anthropic/v1/messages', 'native-key', '', undefined, 'anthropic')
  assert.equal(calls[0].url, 'https://gateway.example/anthropic/v1/models')
  assert.equal(calls[0].headers['x-api-key'], 'native-key')
  assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], undefined)
})

await test('AiHubMix 的 Messages 对话仍使用统一 Bearer 模型目录', async () => {
  await fetchModels('https://aihubmix.com/v1/messages', 'mix-key', '', undefined, 'anthropic')
  assert.equal(calls[0].url, 'https://aihubmix.com/v1/models')
  assert.equal(calls[0].headers.authorization, 'Bearer mix-key')
  assert.equal(calls[0].headers['x-api-key'], undefined)
  assert.equal(detectProvider('https://aihubmix.com/v1/').id, 'aihubmix')
  assert.equal(detectProvider('https://api.anthropic.com/v1').id, 'anthropic')
})

await test('OpenAI 网络失败时保留同源取数代理回退', async () => {
  respond = () => {
    if (calls.length === 1) throw new TypeError('Failed to fetch')
    return Response.json({data: [{id: 'gpt-6-luna'}]})
  }
  await fetchModels('https://aihubmix.com/v1', 'mix-key', '/__proxy?url={url}')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, '/__proxy?url=https%3A%2F%2Faihubmix.com%2Fv1%2Fmodels')
  assert.equal(calls[1].headers.authorization, 'Bearer mix-key')
})

await test('原生 Anthropic 密钥不交给不转发 x-api-key 的取数代理', async () => {
  respond = () => {throw new TypeError('Failed to fetch')}
  await assert.rejects(fetchModels('https://api.anthropic.com/v1', 'native-key', '/__proxy?url={url}', undefined, 'anthropic'), /可以手动输入模型名/)
  assert.equal(calls.length, 1)
})

await test('HTTP 鉴权失败不重试，含查询参数的接口地址在发送前拒绝', async () => {
  respond = () => new Response('invalid key', {status: 401})
  await assert.rejects(fetchModels('https://aihubmix.com/v1', 'mix-key', '/__proxy?url={url}'), /密钥不对或没有权限/)
  assert.equal(calls.length, 1)
  await assert.rejects(fetchModels('https://gateway.example/v1?token=private', 'key', ''), /不能包含/)
  assert.equal(calls.length, 1)
})

await test('各家模型列表格式继续去重、排序并去掉 Gemini 的 models 前缀', async () => {
  assert.deepEqual(plain(parseModelList({models: [{name: 'models/gemini-test'}, {id: 'z-model'}, {model: 'gemini-test'}]})), ['gemini-test', 'z-model'])
})

console.log(`模型发现回归通过：${count} 项`)
