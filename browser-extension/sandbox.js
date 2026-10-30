// 此页由 manifest 的 sandbox.pages 隔离，不拥有扩展 API。
// 一次引导后替换自身文档，用户程序仍只通过原有 App/Applet 消息协议与宿主通信。
(() => {
  const initialize = event => {
    const message = event.data
    if (event.source !== parent || !message || message.dadaSandbox !== 1 || typeof message.session !== 'string' || !message.session || typeof message.document !== 'string') return
    removeEventListener('message', initialize)
    document.open()
    document.write(message.document)
    document.close()
  }
  addEventListener('message', initialize)
})()
