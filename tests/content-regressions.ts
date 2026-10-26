import {fetchAllFeeds, fetchFeed, fetchSourceText} from '../src/lib/rss'
import {fetchBoards, fetchSources} from '../src/lib/hot'
import {articleContext, summaryUnavailableReason} from '../src/lib/articleContext'
import {contextTurns, turnContent, type Turn} from '../src/lib/chat'
import type {Article, Feed} from '../src/lib/types'

const output = document.querySelector<HTMLPreElement>('#results')!
const results: string[] = []
let failures = 0
const originalFetch = globalThis.fetch
const originalTimeout = globalThis.setTimeout
const feed: Feed = {id: 'test', title: '测试订阅', url: 'https://example.com/feed', enabled: true}
const rss = '<rss version="2.0"><channel><title>测试源</title><item><title>测试文章</title><link>https://example.com/article</link><description>这是一段完整订阅内容，足以判断文章不是只有链接和标题的元信息。</description></item></channel></rss>'
const response = (text: string) => { globalThis.fetch = async () => new Response(text) }
function assert(value: unknown, message = '断言失败'): asserts value { if (!value) throw new Error(message) }
async function rejects(run: () => Promise<unknown>, message: string) {
  try { await run() } catch (error) { assert(error instanceof Error && error.message.includes(message), String(error)); return }
  throw new Error(`应失败并提示「${message}」`)
}
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push(`通过：${name}`) } catch (error) { failures += 1; results.push(`失败：${name} — ${String(error)}`) }
  finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout }
  output.textContent = results.join('\n')
}

await test('RSS 2.0 解析标题、链接与内容', async () => {
  response(rss)
  const articles = await fetchFeed(feed, '')
  assert(articles.length === 1 && articles[0].source === '测试源' && articles[0].title === '测试文章' && !articles[0].linkOnly)
})
await test('Atom 默认命名空间与相对链接', async () => {
  response('<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 源</title><entry><title>Atom 文章</title><link href="/atom"/><content type="html">&lt;p&gt;正文&lt;/p&gt;</content></entry></feed>')
  const articles = await fetchFeed(feed, '')
  assert(articles.length === 1 && articles[0].title === 'Atom 文章' && articles[0].link === 'https://example.com/atom')
})
await test('Atom 带前缀命名空间', async () => {
  response('<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:title>带前缀</a:title><a:entry><a:title>前缀文章</a:title><a:link href="https://example.com/prefixed"/></a:entry></a:feed>')
  const articles = await fetchFeed(feed, '')
  assert(articles.length === 1 && articles[0].source === '带前缀' && articles[0].title === '前缀文章' && articles[0].link.endsWith('/prefixed'))
})
await test('RSS 1.0 / RDF', async () => {
  response('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><channel rdf:about="https://example.com"><title>RDF 源</title></channel><item rdf:about="https://example.com/rdf"><title>RDF 文章</title><link>https://example.com/rdf</link></item></rdf:RDF>')
  const articles = await fetchFeed(feed, '')
  assert(articles.length === 1 && articles[0].title === 'RDF 文章')
})
await test('合法空 RSS 作为成功空结果', async () => {
  response('<rss version="2.0"><channel><title>空源</title></channel></rss>')
  assert((await fetchFeed(feed, '')).length === 0)
})
await test('普通 XML 不被当作空订阅', async () => {
  response('<response><title>错误接口</title></response>')
  await rejects(() => fetchFeed(feed, ''), '不是 RSS / Atom')
})
await test('200 HTML 首页提示代理未部署', async () => {
  response('<!doctype html><html><head><title>搭搭</title></head><body><div id="root"></div></body></html>')
  await rejects(() => fetchFeed(feed, '/__proxy?url={url}'), '取数代理可能未部署')
})
await test('包装在 JSON 内的 HTML 同样识别', async () => {
  response(JSON.stringify({contents: '<html><body>首页</body></html>'}))
  await rejects(() => fetchSources('', '/__proxy?url={url}'), '取数代理可能未部署')
})
await test('AllOrigins 包装正常 RSS', async () => {
  response(JSON.stringify({contents: rss}))
  assert((await fetchFeed(feed, 'https://proxy.example/?url={url}')).length === 1)
})
await test('热榜错误 JSON 结构拒绝静默空', async () => {
  response('{"message":"upstream error"}')
  await rejects(() => fetchSources('', ''), '缺少 sources')
  await rejects(() => fetchBoards('', ['zhihu'], ''), '缺少 results')
})
await test('热榜正常包装和缺失榜单明确报错', async () => {
  response(JSON.stringify({contents: JSON.stringify({results: [{id: 'zhihu', name: '知乎', success: true, data: [{title: '热榜条目', score: 12000}]}]})}))
  const boards = await fetchBoards('', ['zhihu', 'weibo'], '')
  assert(boards[0].items[0].heat === '1.2万' && boards[1].error === '未返回这一榜')
})
await test('全部热榜格式错误作为失败保留旧数据', async () => {
  response('{"results":[{"id":"zhihu","success":true,"data":{"wrong":true}}]}')
  await rejects(() => fetchBoards('', ['zhihu'], ''), '格式不正确')
})
await test('部分订阅失败仍返回正常源文章和错误', async () => {
  globalThis.fetch = async (input) => new Response(String(input).includes('/bad') ? '<html>错误页</html>' : rss)
  const data = await fetchAllFeeds([feed, {...feed, id: 'bad', url: 'https://example.com/bad'}], '')
  assert(data.articles.length === 1 && data.errors.length === 1)
})
await test('所有订阅失败抛错交给缓存保留旧内容', async () => {
  response('<html>首页</html>')
  await rejects(() => fetchAllFeeds([feed], ''), '所有订阅源读取失败')
})
await test('未启用和空地址不会请求当前页面', async () => {
  globalThis.fetch = async () => { throw new Error('不应联网') }
  const data = await fetchAllFeeds([{...feed, enabled: false}, {...feed, url: ' '}], '')
  assert(!data.articles.length && !data.errors.length)
})
await test('15 秒超时中断请求并给出可操作提示', async () => {
  let configuredDelay = 0
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
    configuredDelay = timeout ?? 0
    return originalTimeout(handler, 1)
  }) as typeof setTimeout
  globalThis.fetch = async (_input, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  await rejects(() => fetchSourceText(feed.url, '', '*/*', '测试源'), '超时（15 秒）')
  assert(configuredDelay === 15_000)
})

const article: Article = {id: 'article', title: '上下文标题', source: '测试源', link: 'https://example.com/context', date: Date.now(), content: '<p>只有本段提供的内容才可以作为回答的文章依据。'.repeat(8) + '</p>', excerpt: ''}
await test('文章上下文包含标题、来源、链接与正文', () => {
  const context = articleContext(article)
  assert(context.includes(article.title) && context.includes(article.source) && context.includes(article.link) && context.includes('本段提供的内容'))
  assert(!summaryUnavailableReason(article))
})
await test('仅链接和短内容不会请求模型生成摘要', () => {
  const linkOnly = {...article, linkOnly: true}
  assert(summaryUnavailableReason(linkOnly).includes('没有可供摘要的正文'))
  assert(articleContext(linkOnly).includes('仅有标题和链接') && !articleContext(linkOnly).includes('本段提供的内容'))
  assert(summaryUnavailableReason({...article, content: '这是一段确实提供了内容但仍然很简短的正文，不能要求模型扩展成多句摘要。'}).includes('正文太短'))
  assert(articleContext({...article, content: '短正文也应保留。'}).includes('短正文也应保留。'))
})
await test('历史与当前发送合并文章资料且保留用户问题', () => {
  const prompt = '作者的核心依据是什么？'
  const context = articleContext(article)
  const content = turnContent({prompt, article: {title: article.title, link: article.link, context}})
  assert(content.includes(prompt) && content.includes(article.link) && content.includes('本段提供的内容'))
  assert(turnContent({prompt}) === prompt)
})
await test('文章附件计入 36k 历史预算', () => {
  const makeTurn = (id: string, context: string): Turn => ({id, prompt: '请分析', article: {title: article.title, link: article.link, context}, answer: '分析完成', reasoning: '', tools: [], error: '', startedAt: 1})
  const older = makeTurn('older', '旧文章'.repeat(7_000))
  const recent = makeTurn('recent', '新文章'.repeat(7_000))
  const turns = contextTurns([older, recent])
  assert(turns.length === 1 && turns[0].id === 'recent')
})

output.textContent = `${failures ? '失败' : '全部通过'}：${results.length - failures}/${results.length}\n\n${results.join('\n')}`
document.title = `${failures ? '失败' : '通过'} ${results.length - failures}/${results.length} · 内容取数回归`
