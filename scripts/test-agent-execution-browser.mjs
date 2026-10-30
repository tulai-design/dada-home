import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync} from 'node:fs'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://localhost:5173').replace(/\/$/, '')
const out = process.env.DADA_QA_OUTPUT || '/tmp/dada-agent-execution-browser'
mkdirSync(out, {recursive: true})
const browser = await chromium.launch({headless: true})
const results = []
const errors = []
let currentPage

async function test(protocol, name, run) {
  try {
    await run()
    results.push({protocol, name, ok: true})
    console.log(`通过：${protocol} ${name}`)
  } catch (error) {
    results.push({protocol, name, ok: false, error: error.message})
    await currentPage?.screenshot({path: `${out}/${protocol}-failure.png`, fullPage: true}).catch(() => {})
    throw error
  }
}

async function openApp(protocol) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'})
  await context.route('**/*', route => {
    const url = route.request().url()
    return url.startsWith(base + '/') && !new URL(url).pathname.startsWith('/__proxy') ? route.continue() : route.abort()
  })
  await context.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.modelRequests = []
    window.modelPlans = []
    window.popupAttempts = []
    window.open = (...args) => {window.popupAttempts.push(args); return null}
    window.fetch = async (input, init) => {
      if (!String(input).includes('/__execution_model__/')) return original(input, init)
      const body = JSON.parse(init.body)
      window.modelRequests.push(body)
      const plan = window.modelPlans.shift()
      if (!plan) throw new Error('合成模型没有剩余响应：出现额外请求')
      const anthropic = String(input).includes('/messages')
      const encoder = new TextEncoder()
      let controller, closed = false
      const stream = new ReadableStream({start(value) {controller = value}})
      const send = value => {if (!closed) controller.enqueue(encoder.encode('data: ' + JSON.stringify(value) + '\n\n'))}
      const abort = () => {
        if (closed) return
        closed = true
        controller.error(new DOMException('合成请求已取消', 'AbortError'))
      }
      init.signal?.addEventListener('abort', abort, {once: true})
      if (init.signal?.aborted) abort()
      const finish = () => {
        if (closed) return
        if (anthropic) {
          if (plan.hold) send({type: 'content_block_stop', index: 0})
          send({type: 'message_delta', delta: {stop_reason: plan.tools?.length ? 'tool_use' : 'end_turn'}})
          send({type: 'message_stop'})
        } else {
          send({choices: [{index: 0, delta: {}, finish_reason: plan.tools?.length ? 'tool_calls' : 'stop'}]})
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        }
        closed = true
        init.signal?.removeEventListener('abort', abort)
        controller.close()
      }
      window.releaseModel = (lateText = '') => {
        if (closed) return
        if (lateText) send(anthropic
          ? {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: lateText}}
          : {choices: [{index: 0, delta: {content: lateText}, finish_reason: null}]})
        finish()
      }
      if (anthropic) {
        send({type: 'message_start', message: {id: 'synthetic', type: 'message', role: 'assistant', content: [], model: 'test-model'}})
        if (plan.tools?.length) plan.tools.forEach((tool, index) => {
          send({type: 'content_block_start', index, content_block: {type: 'tool_use', id: tool.id, name: tool.name, input: tool.args}})
          send({type: 'content_block_stop', index})
        })
        else {
          send({type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}})
          send({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: plan.text || ''}})
          if (!plan.hold) send({type: 'content_block_stop', index: 0})
        }
      } else send({choices: [{index: 0, delta: plan.tools?.length
        ? {tool_calls: plan.tools.map((tool, index) => ({index, id: tool.id, type: 'function', function: {name: tool.name, arguments: JSON.stringify(tool.args)}}))}
        : {content: plan.text || ''}, finish_reason: null}]})
      if (!plan.hold) finish()
      return new Response(stream, {headers: {'content-type': 'text/event-stream'}})
    }
  })
  const page = await context.newPage()
  currentPage = page
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => errors.push({protocol, message: error.message}))
  await page.goto(base + '/')
  await page.locator('.widget').first().waitFor()
  await page.evaluate(async protocol => {
    const {defaultSettings} = await import('/src/lib/defaults.ts')
    const settings = defaultSettings()
    settings.ai = {baseUrl: location.origin + '/__execution_model__/v1', apiKey: 'isolated-fixture', model: 'test-model', protocol}
    localStorage.setItem('fp.settings', JSON.stringify(settings))
  }, protocol)
  await page.reload()
  await page.locator('.widget').first().waitFor()
  await page.waitForFunction(() => window.__tada)
  await page.keyboard.press('Meta+j')
  await page.locator('.chat-root').waitFor()
  return {context, page}
}

async function send(page, prompt, plans) {
  await page.evaluate(plans => {window.modelPlans = plans; window.modelRequests = []}, plans)
  await page.getByRole('textbox', {name: '消息内容', exact: true}).fill(prompt)
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await page.waitForFunction(() => window.modelRequests.length > 0)
}

async function finished(page) {
  await page.getByRole('button', {name: '发送', exact: true}).waitFor({timeout: 2500})
  await page.waitForFunction(async () => !(await import('/src/lib/chat.ts')).getChatState().activeTurnIds.length)
}

async function latest(page) {
  return page.evaluate(async () => {
    const chat = await import('/src/lib/chat.ts')
    await chat.flush()
    return chat.getChatState().turns.at(-1)
  })
}

try {
  for (const protocol of ['openai', 'anthropic']) {
    const {context, page} = await openApp(protocol)
    try {
      let oldApprovalButton
      const pageId = await page.evaluate(async () => {
        const ops = await import('/src/lib/ops.ts')
        const store = await import('/src/lib/workspaceStore.ts')
        const result = ops.addPage(store.getWorkspace(), {name: '取消审批夹具', label: '夹具'})
        store.commit(result.workspace)
        return result.page.id
      })
      await test(protocol, '待决删除审批停止，保留页面且不启动同批后续工具或模型请求', async () => {
        await send(page, '删除夹具，然后新建一个页面', [
          {tools: [{id: 'cancel-delete', name: 'remove_page', args: {pageId}}, {id: 'must-not-run', name: 'add_page', args: {name: '不应创建'}}]},
          {text: '不应请求这一轮'},
        ])
        await page.locator('.approval-card').waitFor()
        const stale = oldApprovalButton = await page.locator('.approval-card').getByRole('button', {name: '允许', exact: true}).elementHandle()
        await page.getByRole('button', {name: '停止', exact: true}).click()
        await finished(page)
        assert.equal(await page.locator('.approval-card').count(), 0)
        const turn = await latest(page)
        assert.equal(turn.aborted, true)
        assert.equal(turn.pending, undefined)
        assert.equal(turn.tools.length, 0)
        assert.ok(turn.endedAt)
        await page.locator('.turn').last().getByText('已停止', {exact: true}).waitFor()
        // 保留旧 DOM 引用只验证旧卡片不可再操作；任意迟到 callback 由隔离行为回归覆盖。
        await stale.evaluate(element => element.click())
        const state = await page.evaluate(() => ({ids: window.__tada.workspace().pages.map(page => page.id), names: window.__tada.workspace().pages.map(page => page.name), requests: window.modelRequests.length}))
        assert.ok(state.ids.includes(pageId))
        assert.equal(state.names.includes('不应创建'), false)
        assert.equal(state.requests, 1)
      })
      await test(protocol, '下一轮审批可正常允许，工具与模型续答成功', async () => {
        await send(page, '现在确认删除夹具', [{tools: [{id: 'approved-delete', name: 'remove_page', args: {pageId}}]}, {text: '已完成经确认的删除。'}])
        await page.locator('.approval-card').waitFor()
        await oldApprovalButton.evaluate(element => element.click())
        assert.equal(await page.locator('.approval-card').count(), 1)
        assert.ok((await latest(page)).pending)
        assert.equal(await page.evaluate(() => window.modelRequests.length), 1)
        await page.locator('.approval-card').getByRole('button', {name: '允许', exact: true}).click()
        await finished(page)
        assert.equal(await page.evaluate(pageId => window.__tada.workspace().pages.some(page => page.id === pageId), pageId), false)
        const turn = await latest(page)
        assert.equal(turn.tools.length, 1)
        assert.equal(turn.tools[0].ok, true)
        assert.equal(turn.answer, '已完成经确认的删除。')
        await page.locator('.turn').last().locator('.tool-row[data-ok="true"] .tool-ok').waitFor()
        assert.equal(await page.evaluate(() => window.modelRequests.length), 2)
      })
      await test(protocol, '搜索审批停止后旧总是允许不写永久授权、不打开标签页', async () => {
        await send(page, '在谷歌搜索取消验证', [{tools: [{id: 'cancel-search', name: 'open_search', args: {query: '取消验证', engine: 'google'}}]}, {text: '不应请求'}])
        const stale = await page.locator('.approval-card').getByRole('button', {name: '总是允许', exact: true}).elementHandle()
        await page.getByRole('button', {name: '停止', exact: true}).click()
        await finished(page)
        await stale.evaluate(element => element.click())
        assert.equal((await latest(page)).aborted, true)
        const state = await page.evaluate(() => ({allowed: JSON.parse(localStorage.getItem('fp.alwaysAllow') || '[]'), popups: window.popupAttempts.length, requests: window.modelRequests.length}))
        assert.deepEqual(state.allowed, [])
        assert.equal(state.popups, 0)
        assert.equal(state.requests, 1)
        await send(page, '重新询问搜索，但本次拒绝', [{tools: [{id: 'denied-search', name: 'open_search', args: {query: '拒绝验证', engine: 'google'}}]}, {text: '已取消搜索。'}])
        await page.locator('.approval-card').waitFor()
        await stale.evaluate(element => element.click())
        assert.equal(await page.locator('.approval-card').count(), 1)
        assert.ok((await latest(page)).pending)
        assert.equal(await page.evaluate(() => window.modelRequests.length), 1)
        await page.locator('.approval-card').getByRole('button', {name: '拒绝', exact: true}).click()
        await finished(page)
        const denied = await latest(page)
        assert.equal(denied.tools[0].ok, false)
        assert.equal(denied.answer, '已取消搜索。')
        assert.equal(denied.pending, undefined)
        assert.equal(await page.evaluate(() => window.popupAttempts.length), 0)
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('fp.alwaysAllow') || '[]')), [])
      })
      await test(protocol, '模型流停止后记录取消，迟到输出不污染回答', async () => {
        await send(page, '流式停止验证', [{text: '停止前片段', hold: true}])
        await page.locator('.turn').last().getByText('停止前片段', {exact: true}).waitFor()
        await page.getByRole('button', {name: '停止', exact: true}).click()
        await finished(page)
        await page.evaluate(() => window.releaseModel('不应出现的迟到片段'))
        const turn = await latest(page)
        assert.equal(turn.aborted, true)
        assert.equal(turn.answer, '停止前片段')
        assert.equal(turn.error, '')
      })
      await test(protocol, '真实领域错误进入失败工具、模型续答、历史与失败图标', async () => {
        await send(page, '重命名一个不存在的页面', [{tools: [{id: 'failed-rename', name: 'rename_page', args: {pageId: 'missing-browser-fixture', name: '不应成功'}}]}, {text: '该页面不存在，请先确认页面标识。'}])
        await finished(page)
        const turn = await latest(page)
        assert.equal(turn.tools.length, 1)
        assert.equal(turn.tools[0].ok, false)
        assert.equal(turn.answer, '该页面不存在，请先确认页面标识。')
        const detail = await page.evaluate(async id => (await import('/src/lib/chat.ts')).readToolDetail(id), turn.tools[0].detailId)
        assert.match(detail, /没有这个页面：missing-browser-fixture/)
        const requests = await page.evaluate(() => window.modelRequests)
        assert.equal(requests.length, 2)
        if (protocol === 'openai') assert.equal(requests[1].messages.find(message => message.role === 'tool').content, detail)
        else assert.equal(requests[1].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'tool_result').content, detail)
        const row = page.locator('.turn').last().locator('.tool-row[data-ok="false"]')
        await row.locator('.tool-fail').waitFor()
        await row.getByText('未完成', {exact: true}).waitFor()
        if (!(await row.locator('.tool-detail').count())) await row.locator('button').click()
        await row.locator('.tool-detail').waitFor()
        assert.equal(await row.locator('.tool-detail').innerText(), detail)
        await page.screenshot({path: `${out}/${protocol}-failed-tool.png`, fullPage: true})
        await page.reload()
        await page.locator('.widget').first().waitFor()
        await page.keyboard.press('Meta+j')
        await page.locator('.chat-root').waitFor()
        await page.locator('.ai-history-item').filter({hasText: '删除夹具，然后新建一个页面'}).click()
        await page.locator('.chat-log').waitFor()
        const restored = await latest(page)
        assert.equal(restored.id, turn.id)
        assert.equal(restored.tools[0].ok, false)
        assert.equal(await page.evaluate(async id => (await import('/src/lib/chat.ts')).readToolDetail(id), restored.tools[0].detailId), detail)
        await page.locator('.turn').last().locator('.tool-fail').waitFor()
      })
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
  console.log(`Agent 执行浏览器 ${results.length}/${results.length} 通过；${out}`)
} finally {
  writeFileSync(out + '/results.json', JSON.stringify({base, results, errors, limitations: ['独立 Chromium 上下文与合成 OpenAI/Anthropic 响应；未调用真实模型服务。', '旧 DOM 引用仅验证卸载后的卡片不可再操作，任意迟到回调由隔离行为测试验证。']}, null, 2))
  await browser.close()
}
