const $ = (id) => document.getElementById(id)
const KEY = 'enabledOrigins'
const idOf = (origin) => `dada:${origin}`

const read = async () => (await chrome.storage.local.get(KEY))[KEY] ?? []
const write = (list) => chrome.storage.local.set({ [KEY]: list })

async function enable(origin, tabId) {
  // 必须在点击里直接申请，浏览器会弹出确认
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) throw new Error('你没有授权')
  const id = idOf(origin)
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] })
  if (!existing.length) {
    await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: ['content.js'], runAt: 'document_start', persistAcrossSessions: true }])
  }
  if (tabId !== undefined) await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  const list = await read()
  if (!list.includes(origin)) await write([...list, origin])
}

async function disable(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [idOf(origin)] })
  } catch {
    /* 没注册过 */
  }
  await chrome.permissions.remove({ origins: [`${origin}/*`] })
  await write((await read()).filter((o) => o !== origin))
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const list = await read()
  let origin = ''
  try {
    const url = new URL(tab?.url ?? '')
    if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin
  } catch {
    /* 不是网页 */
  }

  const toggle = $('toggle')
  // activeTab：点开弹窗那一刻浏览器才允许读当前标签的地址；读不到时 tab.url 是 undefined
  $('origin').textContent = origin || (tab?.url ? '当前页面不是网站（只支持 http / https）' : '读不到当前页面的地址，请关掉弹窗再点一次图标')
  toggle.disabled = !origin
  const on = origin && list.includes(origin)
  toggle.textContent = on ? '在此网站关闭' : '在此网站启用'
  toggle.className = on ? 'ghost' : ''
  toggle.onclick = async () => {
    $('msg').textContent = ''
    try {
      if (on) await disable(origin)
      else await enable(origin, tab.id)
      if (!on && tab?.id !== undefined) await chrome.tabs.reload(tab.id)
      await render()
    } catch (error) {
      $('msg').textContent = error instanceof Error ? error.message : String(error)
    }
  }

  const ul = $('list')
  ul.replaceChildren(
    ...list.map((o) => {
      const li = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = o
      const off = document.createElement('button')
      off.className = 'ghost'
      off.textContent = '关闭'
      off.onclick = async () => {
        await disable(o)
        await render()
      }
      li.append(name, off)
      return li
    }),
  )
}

render()
