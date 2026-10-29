// 内置内容页的隔离浏览器夹具，网络仅返回明确样例；不接触用户浏览器或真实远端。
const boardNames = {zhihu: '知乎', weibo: '微博', ithome: 'IT之家'}
const headlines = [
  '人们为什么越来越愿意花时间记录生活中的小事？',
  '城市公共空间的新变化：从一条步行道开始，重新发现身边的日常风景',
  '开源社区发布新一代开发工具，开发者讨论使用体验',
  '周末去哪里：博物馆、书店与公园里的秋日活动',
  '如何在繁忙的工作中留出一段不被打扰的专注时间？',
  '从信息收集到真正理解：整理个人知识库的几个实践',
]
const rss = (source, key) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${source}</title>${Array.from({length: 12}, (_, i) => `<item><title>${i + 1}. ${headlines[i % headlines.length]}</title><link>https://fixture.invalid/${key}/article-${i}</link><guid>${key}-${i}</guid><pubDate>${new Date(Date.now() - i * 3600000).toUTCString()}</pubDate><description><![CDATA[<p>这是隔离浏览器中的界面验收样例。我们用完整标题、来源与摘要检查内容密度和阅读体验，确保在明暗模式和不同宽度下，都能清楚地读到信息。</p>]]></description></item>`).join('')}</channel></rss>`

export async function routeBuiltinFixtures(context, base) {
  await context.route('**/*', route => {
    const address = new URL(route.request().url())
    const source = address.searchParams.get('url') || address.href
    if (source.includes('/api/v1/batch')) return route.fulfill({json: {results: Object.entries(boardNames).map(([id, name]) => ({id, name, success: true, data: Array.from({length: 18}, (_, i) => ({title: `${headlines[(i + Object.keys(boardNames).indexOf(id)) % headlines.length]}${i > 5 ? ` · ${i + 1}` : ''}`, score: 1630000 - i * 71341, url: `https://fixture.invalid/hot/${id}/${i}`}))}))}})
    if (source.includes('/api/v1/sources')) return route.fulfill({json: {sources: Object.entries(boardNames).map(([id, name]) => ({id, name, enabled: true, column: 'china'}))}})
    if (source.includes('fixture.invalid/design.xml')) return route.fulfill({contentType: 'application/rss+xml', body: rss('设计周刊', 'design')})
    if (source.includes('fixture.invalid/tech.xml')) return route.fulfill({contentType: 'application/rss+xml', body: rss('技术札记', 'tech')})
    if (source.includes('api.open-meteo.com/v1/forecast')) return route.fulfill({json: {current: {temperature_2m: 22, relative_humidity_2m: 61, weather_code: 2, wind_speed_10m: 8}, daily: {temperature_2m_max: [25], temperature_2m_min: [17]}}})
    if (address.origin === base && !address.pathname.startsWith('/__proxy')) return route.continue()
    // 链接点击也由fixture接管，不访问任何真实外网。
    if (address.hostname === 'fixture.invalid') return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>验收链接</title><p>独立测试页面</p>'})
    return route.abort()
  })
}

export async function seedBuiltinFixtures(page, call) {
  // 仅新context内的测试夹具；移除内置订阅/书签，随后用产品工具添加内容。
  await page.evaluate(async () => {const {writeData, SHARED} = await import('/src/lib/componentData.ts'); writeData(SHARED.feeds, []); writeData(SHARED.bookmarks, [])})
  for (const id of ['hot', 'feeds', 'desk', 'bookmarks', 'calendar', 'focus', 'music', 'monitor']) await call('install_addon', {id})
  await call('add_feed', {title: '设计周刊', url: 'https://fixture.invalid/design.xml'})
  await call('add_feed', {title: '技术札记', url: 'https://fixture.invalid/tech.xml'})
  await call('add_bookmarks', {items: ['工作', '设计', '阅读'].flatMap((group, g) => Array.from({length: 12}, (_, i) => ({name: `${['项目看板', '资料中心', '灵感画廊', '长期阅读与研究笔记'][i % 4]} ${i + 1}`, url: `https://fixture.invalid/bookmark/${g}/${i}`, group})))})
  await call('add_todos', {texts: ['整理本周项目计划', '给新的主页主题做一次完整的视觉检查', '阅读并摘录两篇文章', '回复团队的设计讨论', '安排周末的短途旅行', '把新想到的点子记下来']})
  await call('write_note', {text: '今天的备忘\n\n把复杂的事情拆成可以开始的一小步。\n界面留白不是空着，而是让内容有呼吸的空间。\n\n下午：完成主页的视觉检查\n晚上：整理本周的阅读笔记', mode: 'replace'})
  const today = await page.evaluate(() => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`})
  for (const [title, time] of [['晨间规划', '09:00'], ['产品设计评审与下一阶段工作安排', '14:00'], ['散步与阅读', '18:30']]) await call('add_event', {title, date: today, time})
  await call('add_countdown', {title: '周末旅行', date: today, repeat: 'yearly'})
  await call('add_countdown', {title: '新的创作计划', date: '2027-01-01'})
  await call('add_music', {title: '雨后森林 · 阅读时间', url: 'noise:pink'})
  await call('add_music', {title: '静谧书房 · 专注时间', url: 'noise:brown'})
  await call('add_page', {name: '天气', label: '天气', icon: 'sun'})
  const weatherId = await page.evaluate(() => window.__tada.workspace().pages.find(p => p.name === '天气').id)
  await call('add_component', {pageId: weatherId, type: 'weather', span: 'full', config: {showDetail: true}})
}
