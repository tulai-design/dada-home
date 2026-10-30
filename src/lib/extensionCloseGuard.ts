import {hasPendingApplicationWrites} from './applicationData'
import {hasPendingChatWrites} from './chat'
import {hasPendingComponentWrites} from './componentData'
import {getPersistenceStatus} from './persistence'
import {isExtension} from './platform'
import {saveBarrier} from './storageCommit'

let installed = false

/** 浏览器可提示用户等待保存，但强制关闭/进程终止不保证异步保存完成。 */
export function installExtensionCloseGuard(): void {
  if (installed || !isExtension()) return
  installed = true
  window.addEventListener('beforeunload', event => {
    const unsaved = hasPendingApplicationWrites() || hasPendingChatWrites() || hasPendingComponentWrites()
    // 已提交入站数据后的重载门禁不是未保存错误，不应阻止必要的重新加载。
    const failed = getPersistenceStatus().errors.some(error => error.blocking && !['sync-reload', 'db-reload'].includes(error.source))
    if (!unsaved && !failed) return
    event.preventDefault()
    event.returnValue = ''
    // 这里只启动保存；beforeunload 不会等待 Promise，不在此提前释放工作空间锁。
    void saveBarrier().catch(() => undefined)
  })
}
