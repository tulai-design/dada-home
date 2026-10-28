import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// 执行真实搜索入口，只替换存储和网络；不读取用户配置或调用外部 API。
let stored, requests = []
const dependencies = {
  './store': {readStored: name => name === 'search' ? stored : {}},
  './rss': {proxied: url => url, plainText: text => text},
}
const fetch = async (url, init) => {
  requests.push({url, init})
  return {ok: true, json: async () => ({results: []}), text: async () => '网页正文'}
}
const module = {exports: {}}
const code = ts.transpileModule(readFileSync(new URL('../src/lib/webSearch.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
new Function('module', 'exports', 'require', 'fetch', code)(module, module.exports, id => {
  if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`)
  return dependencies[id]
}, fetch)
const {normalizeSearchConfig, readSearchConfig, searchReady, webSearch, webFetch} = module.exports
let passed = 0
async function test(name, run) {await run(); passed++; console.log(`通过：${name}`)}

await test('同步产生的部分搜索配置可读，摘要和搜索入口不抛 tavily TypeError', async () => {
  stored = {provider: 'tavily'}
  assert.deepEqual(readSearchConfig(), {provider: 'tavily', keys: {}, urls: {}})
  assert.equal(searchReady(stored), false)
  await assert.rejects(webSearch('test', {}, stored), /^Error: Tavily 还没配好$/)
  assert.equal(requests.length, 0)
})

await test('未知或损坏配置安全规整，不改写原始存储', async () => {
  for (const value of [undefined, null, false, [], 'bad', 4, {provider: 'missing'}, {provider: ['tavily']}]) {
    stored = value
    assert.deepEqual(readSearchConfig(), {provider: 'off', keys: {}, urls: {}})
    assert.equal(searchReady(value), false)
    assert.equal(stored, value)
    await assert.rejects(webSearch('test', {}, value), /还没有开启/)
  }
  for (const field of [undefined, null, [], true, 'secret', {tavily: 7}, {tavily: {}}, {tavily: '  '}]) {
    const config = {provider: 'tavily', keys: field, urls: field}
    assert.equal(searchReady(config), false)
    await assert.rejects(webSearch('test', {}, config), /还没配好/)
  }
})

await test('合法服务商密钥与自托管地址保留，非法嵌套字段不进入请求', async () => {
  const input = {provider: 'firecrawl', keys: {firecrawl: ' synthetic-key ', unknown: 'bad', tavily: 12}, urls: {firecrawl: 'https://search.example.test/', searxng: 42}}
  assert.deepEqual(normalizeSearchConfig(input), {provider: 'firecrawl', keys: {firecrawl: ' synthetic-key '}, urls: {firecrawl: 'https://search.example.test/'}})
  assert.equal(searchReady(input), true)
  await webSearch('test', {}, input)
  assert.equal(requests.at(-1).url, 'https://search.example.test/v2/search')
  assert.equal(requests.at(-1).init.headers.authorization, 'Bearer synthetic-key')
  assert.equal(searchReady({provider: 'searxng', urls: {searxng: 'https://search.example.test'}}), true)
  assert.equal(searchReady({provider: 'searxng', urls: {searxng: 12}}), false)
})

await test('网页读取显式传入部分配置时安全回落到普通网页读取', async () => {
  const start = requests.length
  assert.equal(await webFetch('https://page.example.test', 100, undefined, {provider: 'tavily', keys: null}), '网页正文')
  assert.equal(requests.length, start + 1)
  assert.equal(requests.at(-1).url, 'https://page.example.test')
})

console.log(`搜索配置回归通过：${passed} 组`)
