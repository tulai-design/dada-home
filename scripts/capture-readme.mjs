import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

// 只写入临时浏览器上下文；不连接个人浏览器或真实 AI 服务。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://localhost:5173').replace(/\/$/, '')
const output = fileURLToPath(new URL('../docs/images/readme/', import.meta.url))
await mkdir(output, {recursive: true})
const browser = await chromium.launch({headless: true})
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce'})
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    const local = url.origin === base && !url.pathname.startsWith('/__proxy')
    return local || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({time: new Date('2026-10-30T09:41:00+08:00')})
  await page.clock.setFixedTime(new Date('2026-10-30T09:41:00+08:00'))
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await page.locator('.widget').first().waitFor()
  await page.waitForFunction(() => typeof window.__tada?.call === 'function')
  await page.evaluate(async () => {
    const {defaultWorkspace} = await import('/src/lib/ops.ts')
    const {commit} = await import('/src/lib/workspaceStore.ts')
    const {writeData, flush} = await import('/src/lib/componentData.ts')
    const workspace = defaultWorkspace()
    workspace.layout.maxWidth = 1120
    workspace.pages[0].layers = []
    workspace.pages[0].components[0].config.showWeather = false
    workspace.pages[0].components[0].config.showSeconds = false
    workspace.pages[0].components[2].config = {links: 'GitHub https://github.com\n少数派 https://sspai.com\nFigma https://figma.com\nNotion https://notion.so\n哔哩哔哩 https://bilibili.com', showFavicons: false}
    const cards = [
      {id: 'showcase-note', type: 'note', title: '灵感便笺', span: 'half', config: {heading: '灵感便笺', rows: 5}, look: {variant: 'card', tone: 'neutral'}},
      {id: 'showcase-todos', type: 'todos', title: '今天的三件事', span: 'half', config: {heading: '今天的三件事', limit: 0, hideDone: false, allowAdd: true}, look: {variant: 'card', tone: 'blue'}},
    ]
    workspace.pages[0].components.push(...cards)
    workspace.pages.push({id: 'desk', name: '工作台', label: '工作台', icon: 'notebook-pen', align: 'start', layers: [], components: [
      ...cards,
      {id: 'showcase-calendar', type: 'calendar', span: 'half', config: {weekStart: 'mon', showLunar: true, showEvents: true}, look: {variant: 'card', tone: 'neutral'}},
      {id: 'showcase-quote', type: 'quote', span: 'half', config: {source: 'builtin', text: '慢慢来，比较快。', rotate: false, hitokotoKind: 'all'}, look: {variant: 'card', tone: 'neutral'}},
    ]})
    workspace.pages.push({id: 'apps', name: '我的应用', label: '我的应用', icon: 'dashboard', align: 'start', layers: [], components: []})
    commit(workspace)
    writeData('showcase-note', '把日常，搭成喜欢的样子。\n\n一个安静的首页，一些顺手的工具。\n让想法有地方落下，让行动轻一点。\n\n本周灵感：做一个自己的阅读角。')
    writeData('showcase-todos', [
      {id: 'one', text: '整理本周阅读清单', done: true, createdAt: Date.now()},
      {id: 'two', text: '留出 25 分钟专注时间', done: false, createdAt: Date.now()},
      {id: 'three', text: '把新想法搭成一个小工具', done: false, createdAt: Date.now()},
    ])
    await flush()
    localStorage.setItem('fp.settings', JSON.stringify({name: '朋友', theme: 'light', showFavicons: false, showSeconds: false, wallpaper: 'none', ai: {baseUrl: 'https://model.example/v1', apiKey: 'readme-demo-not-a-real-key', model: '演示模型'}}))
    localStorage.setItem('fp.assistantPanelMode', JSON.stringify('split'))
    localStorage.setItem('fp.sidebarAi', JSON.stringify('split'))
  })
  const settle = async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('link[data-theme-font]')].every(link => link.sheet), undefined, {timeout: 15000})
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
  }
  const capture = async name => {
    await settle()
    await page.mouse.click(page.viewportSize().width / 2, 40)
    await page.screenshot({path: output + name + '.png', animations: 'disabled'})
    console.log('已截图：' + name)
  }
  const go = async id => {
    await page.evaluate(id => localStorage.setItem('fp.page', JSON.stringify(id)), id)
    await page.reload({waitUntil: 'domcontentloaded'})
    await page.locator('.widget').first().waitFor()
  }
  await go('home')
  await capture('hero')
  // 示例源码与产品/回归测试共用；数据只用于 README 展示。
  await page.evaluate(async () => {
    const {TREND_APPLET_EXAMPLE} = await import('/src/lib/applet/chartExample.ts')
    const {RECORD_APPLET_EXAMPLE} = await import('/src/lib/applet/dataTableExample.ts')
    const {replaceApplicationData} = await import('/src/lib/applicationData.ts')
    for (const example of [TREND_APPLET_EXAMPLE, RECORD_APPLET_EXAMPLE]) {
      const result = await window.__tada.call('create_applet', example)
      if (!result.startsWith('已安装')) throw new Error(result)
      const [entry] = JSON.parse(await window.__tada.call('list_applications', {ref: example.title}))
      await window.__tada.call('mount_application', {ref: entry.id, pageId: 'apps', span: 'half'})
      const data = example.title === '专注趋势' ? {records: [45, 70, 55, 90, 75, 110, 95].map((minutes, index) => ({label: '周' + ['一', '二', '三', '四', '五', '六', '日'][index], minutes}))} : {
        nextId: 6,
        records: [
          {id: 'record-1', title: '一杯咖啡', amount: 28, category: '生活', note: '给早晨一点灵感'},
          {id: 'record-2', title: '设计书刊', amount: 68, category: '学习', note: '本月阅读计划'},
          {id: 'record-3', title: '地铁出行', amount: 6, category: '交通', note: '周五通勤'},
          {id: 'record-4', title: '午间简餐', amount: 32, category: '生活', note: '好好吃饭'},
          {id: 'record-5', title: '云端空间', amount: 12, category: '工具', note: '个人数字生活'},
        ],
      }
      await replaceApplicationData({kind: 'applet', id: entry.id}, data)
    }
  })
  await go('apps')
  await page.getByText('共 5 条', {exact: true}).waitFor()
  await capture('applications')
  await go('home')
  await page.evaluate(async () => {
    const {db} = await import('/src/lib/db.ts')
    const time = Date.now()
    await db.put('convs', {id: 'readme-demo', title: '我的日常工作台', createdAt: time, updatedAt: time})
    await db.put('turns', {id: 'readme-demo-turn', convId: 'readme-demo', prompt: '我想要一个安静的工作台，有便笺、待办和专注记录。你能帮我一起搭吗？', answer: '可以，我们从每天最常用的三件事开始。\n\n- **记下想法**：用便笺留住灵感。\n- **安排今天**：把待办控制在三件事。\n- **看见积累**：用专注趋势记录投入的时间。\n\n你可以先看看左侧的示例，再告诉我想调整什么。配色、布局和小工具，都能慢慢搭成你喜欢的样子。\n\n> 这是 README 的演示对话；页面使用预先配置的示例内容。', reasoning: '', tools: [], error: '', startedAt: time, endedAt: time + 1000})
    localStorage.setItem('fp.conv', JSON.stringify('readme-demo'))
  })
  await page.reload({waitUntil: 'domcontentloaded'})
  await page.locator('.widget').first().waitFor()
  await page.keyboard.press('Meta+j')
  await page.getByRole('textbox', {name: '消息内容', exact: true}).waitFor()
  await capture('ai-workspace')
  await page.keyboard.press('Escape')
  for (const [id, name] of [['ios', 'ios'], ['default', 'paper'], ['pixel', 'pixel'], ['switch', 'switch'], ['win98', 'win98']]) {
    await page.evaluate(async id => {
      const {getWorkspace, commit} = await import('/src/lib/workspaceStore.ts')
      const {applyTheme} = await import('/src/lib/themes.ts')
      commit(applyTheme(getWorkspace(), id).workspace)
      localStorage.setItem('fp.page', JSON.stringify('home'))
    }, id)
    await page.reload({waitUntil: 'domcontentloaded'})
    // 桌面/主机主题展示其真实入口，而非用 CSS 模拟皮肤。
    await page.waitForFunction(() => (document.querySelector('#root')?.innerText.length ?? 0) > 10)
    if (id === 'win98') {
      await page.getByRole('button', {name: '我的主页', exact: true}).dblclick()
    }
    await capture('theme-' + name)
  }
  await page.evaluate(async () => {
    const {getWorkspace, commit} = await import('/src/lib/workspaceStore.ts')
    const {applyTheme} = await import('/src/lib/themes.ts')
    commit(applyTheme(getWorkspace(), 'ios').workspace)
  })
  await page.setViewportSize({width: 390, height: 1180})
  await go('home')
  await capture('mobile')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '移动端页面无横向溢出')
  assert.deepEqual(errors, [], '截图过程中无未捕获异常')
  await context.close()
} finally {
  await browser.close()
}
