import {useState} from 'react'
import {Button} from '@lobehub/ui'
import {retryPersistence, usePersistenceStatus} from '../lib/persistence'
import '../persistence.css'

/** 只在保存失败时出现，直到真正重试成功；不能以当前内存可读代替落盘。 */
export function PersistenceNotice() {
  const {errors, busy} = usePersistenceStatus()
  const [retrying, setRetrying] = useState(false)
  const unsaved = errors.some(error => error.blocking)
  const interruptedRestore = errors.some(error => error.source === 'backup-restore')
  const syncReload = errors.some(error => error.source === 'sync-reload')
  const currentError = errors.find(error => error.source === 'backup-restore') ?? errors.find(error => error.source === 'sync-reload') ?? errors.find(error => error.blocking) ?? errors[0]
  if (!errors.length && !busy) return null
  if (busy) return (
    <div className="persistence-restoring" role="status" aria-live="polite">
      <span>正在恢复数据，请稍候…</span>
    </div>
  )
  return (
    <aside className="persistence-notice" role="alert" aria-label={syncReload && !interruptedRestore ? '同步数据待加载' : '本地保存失败'}>
      <div className="persistence-notice-copy">
        <strong>{interruptedRestore ? '数据恢复尚未完成' : syncReload ? '已拉取新的数据' : unsaved ? '部分更改尚未保存' : '部分旧数据未能读取'}</strong>
        <span>{currentError.message}</span>
        <span>{interruptedRestore ? '恢复日志已保留，请重新加载以恢复原数据。' : syncReload ? '当前页面暂停保存，重新加载后可继续编辑。' : unsaved ? '请保留当前页面，重试成功后再关闭。' : '原始数据仍保留，可先导出备份再处理。'}</span>
      </div>
      {(interruptedRestore || syncReload) && <Button size="small" onClick={() => location.reload()}>重新加载</Button>}
      {errors.some(error => error.retryable) && <Button size="small" loading={retrying} onClick={async () => {
        setRetrying(true)
        try { await retryPersistence() } catch { /* 失败原因继续由持久化状态显示。 */ }
        finally { setRetrying(false) }
      }}>重试保存</Button>}
    </aside>
  )
}

/** 初始化失败时不启动业务编辑或自动同步，允许用户在恢复存储后重试。 */
export function StorageStartupError({error, onRetry}: {error: unknown; onRetry: () => Promise<void>}) {
  const [retrying, setRetrying] = useState(false)
  const [exportError, setExportError] = useState('')
  function exportOriginalConfig() {
    try {
      const local: Record<string, string> = Object.create(null)
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (!key?.startsWith('fp.')) continue
        const value = localStorage.getItem(key)
        if (value !== null) local[key] = value
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({app: 'dada-local-rescue', version: 1, local}, null, 2)], {type: 'application/json'}))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dada-local-rescue-${Date.now()}.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportError('')
    } catch {
      setExportError('浏览器暂时不允许读取配置，请保留当前页面和浏览器数据。')
    }
  }
  return (
    <main className="storage-startup-error" role="alert">
      <h1>暂时无法读取本地数据</h1>
      <p>{error instanceof Error ? error.message : '请检查浏览器是否允许保存数据，然后重试。'}</p>
      <Button loading={retrying} onClick={async () => {
        setRetrying(true)
        try { await onRetry() } finally { setRetrying(false) }
      }}>重新读取</Button>
      <Button onClick={exportOriginalConfig}>导出原始配置</Button>
      <p>原始配置包含浏览器配置和未迁移的旧版数据，供排查恢复；不包含数据库中的聊天记录，不能直接作为完整备份导入。</p>
      {exportError && <p>{exportError}</p>}
    </main>
  )
}
