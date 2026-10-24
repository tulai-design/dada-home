import { handle } from './handlers.js'

/**
 * 内容脚本把网页的请求转到这里。
 * 双重把关：请求必须来自用户手动启用过的网站（已授予该网站的主机权限）。
 */
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  ;(async () => {
    try {
      const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '')
      if (!origin || !(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
        throw new Error('这个网站没有启用搭搭书签桥')
      }
      reply({ ok: true, data: await handle(chrome.bookmarks, message.op, message.args) })
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
  return true
})
