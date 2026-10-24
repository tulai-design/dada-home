// 运行在网页里的桥：网页 postMessage → 扩展后台 → 回传结果。
// 只接受本页面自己发来的消息，不接受 iframe 或其他窗口的。
const FROM_APP = 'dada-app'
const FROM_EXT = 'dada-ext'

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const msg = event.data
  if (!msg || msg.source !== FROM_APP || typeof msg.id !== 'string') return
  let result
  try {
    result = await chrome.runtime.sendMessage({ op: msg.op, args: msg.args })
  } catch (error) {
    result = { ok: false, error: String(error) }
  }
  window.postMessage({ source: FROM_EXT, id: msg.id, ...result }, location.origin)
})
