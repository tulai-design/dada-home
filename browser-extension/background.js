import {handle} from './handlers.js'

const WORKSPACE_TAB = 'dada-workspace-tab'
const ownPage = (sender) => sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''))
const workspacePage = url => {
  try {
    const value = new URL(url)
    const expected = new URL(chrome.runtime.getURL('index.html'))
    return value.protocol === expected.protocol && value.host === expected.host && value.pathname === expected.pathname
  } catch {return false}
}
async function registeredWorkspace() {
  // service worker 会休眠；页面所有权不能只保存在它的全局变量里。
  const stored = await chrome.storage.session.get(WORKSPACE_TAB)
  const tabId = stored[WORKSPACE_TAB]
  if (!Number.isInteger(tabId)) return undefined
  try {
    const tab = await chrome.tabs.get(tabId)
    if (workspacePage(tab.url)) return tab
  } catch { /* 标签页已经关闭，不根据页面排列猜测哪个等待页持锁。 */ }
  await chrome.storage.session.remove(WORKSPACE_TAB)
  return undefined
}
async function focus(tab) {
  await chrome.tabs.update(tab.id, {active: true})
  await chrome.windows.update(tab.windowId, {focused: true})
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!ownPage(sender)) return false
  ;(async () => {
    try {
      if (message?.op === 'register-workspace') {
        const tabId = sender.tab?.id ?? message.tabId
        if (!Number.isInteger(tabId)) throw new Error('无法识别当前工作空间标签页')
        const tab = await chrome.tabs.get(tabId)
        if (!workspacePage(tab.url)) throw new Error('工作空间标签页地址无效')
        await chrome.storage.session.set({[WORKSPACE_TAB]: tabId})
        reply({ok: true})
        return
      }
      if (message?.op === 'focus-workspace') {
        const target = await registeredWorkspace()
        if (target?.id === undefined) throw new Error('工作空间已关闭，可在当前页面继续')
        await focus(target)
        reply({ok: true})
        return
      }
      if (message?.source !== 'dada-extension') throw new Error('不支持的扩展消息')
      reply({ok: true, data: await handle(chrome.bookmarks, message.op, message.args)})
    } catch (error) {
      reply({ok: false, error: error instanceof Error ? error.message : String(error)})
    }
  })()
  return true
})

chrome.action.onClicked.addListener(async () => {
  try {
    const target = await registeredWorkspace()
    if (target?.id !== undefined) await focus(target)
    else await chrome.tabs.create({url: chrome.runtime.getURL('index.html')})
  } catch (error) {console.warn('暂时无法打开搭搭', error)}
})
