/**
 * 扩展内只有持锁页面启动存储、AI 应用与自动同步。
 * 等待页面不建立业务缓存；获得锁后才启动，避免旧快照覆盖新的编辑。
 * 锁属于文档寿命，关闭/重载后由浏览器释放，不用会过期的心跳租约抢写。
 */
export async function runExtensionWorkspace(start: () => Promise<void>, waiting: () => void): Promise<void> {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全的新标签页运行，请使用新版 Chrome 或 Edge。')
  await navigator.locks.request('dada-extension-workspace', {mode: 'exclusive', ifAvailable: true}, async lock => {
    if (lock) {
      await start()
      await new Promise<void>(() => undefined)
      return
    }
    waiting()
  })
  await navigator.locks.request('dada-extension-workspace', {mode: 'exclusive'}, async () => {
    await start()
    await new Promise<void>(() => undefined)
  })
}
