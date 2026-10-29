import {useSyncExternalStore} from 'react'

export type PersistenceError = {source: string; message: string; retryable: boolean; blocking: boolean}
export type PersistenceStatus = {errors: PersistenceError[]; busy: boolean; holding: boolean}
type Failure = {message: string; retry?: () => void | Promise<void>; blocking: boolean}
const failures = new Map<string, Failure>()
const listeners = new Set<() => void>()
let exclusive = false
let conceal = false
let status: PersistenceStatus = {errors: [], busy: false, holding: false}

function emit() {
  status = {errors: [...failures].map(([source, failure]) => ({source, message: failure.message, retryable: Boolean(failure.retry), blocking: failure.blocking})), busy: exclusive && !conceal, holding: exclusive}
  listeners.forEach(listener => listener())
}

/** source 只标识本机保存区域，不把数据正文或密钥放进错误状态。 */
export function reportPersistenceError(source: string, error: unknown, retry?: () => void | Promise<void>, blocking = true) {
  const message = error instanceof Error ? error.message : String(error)
  const previous = failures.get(source)
  failures.set(source, {message, retry, blocking})
  if (!previous || previous.message !== message || Boolean(previous.retry) !== Boolean(retry) || previous.blocking !== blocking) emit()
}

export function clearPersistenceError(source: string) {
  if (failures.delete(source)) emit()
}

export const getPersistenceStatus = (): PersistenceStatus => status
export function usePersistenceStatus(): PersistenceStatus {
  return useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener)}}, getPersistenceStatus, getPersistenceStatus)
}

export function assertPersistenceHealthy() {
  const failure = [...failures.values()].find(item => item.blocking)
  if (failure) throw new Error(`本机仍有未保存或无法读取的数据：${failure.message}`)
}

/** 重试函数写的是当前最新值；不以旧错误创建时的快照覆盖后来编辑。 */
export async function retryPersistence(): Promise<void> {
  const errors: unknown[] = []
  for (const [source, failure] of [...failures]) {
    if (failures.get(source) !== failure || !failure.retry) continue
    try {await failure.retry()} catch (error) {errors.push(error)}
  }
  if (errors.length) throw errors[0]
  assertPersistenceHealthy()
}

/** 恢复期间阻止新的同步业务写入；排队 flush 不经过此门禁。 */
export function assertPersistenceWritable() {
  if (failures.has('db-reload')) throw new Error('本地数据库已变化，请重新加载后继续编辑。')
  if (failures.has('sync-reload')) throw new Error('已拉取新的数据，请重新加载后继续编辑。')
  if (failures.has('backup-restore')) throw new Error('数据恢复尚未完成，请重新加载后继续。')
  if (exclusive) throw new Error(conceal ? '同步正在写入，请稍后再试。' : '正在恢复数据，请完成后再编辑。')
}

/** `quiet` 只用于同步写入：仍然暂停其它保存，但不盖住页面。备份恢复保持全屏提示。 */
export async function withPersistenceExclusive<T>(work: () => Promise<T>, options: {recovering?: boolean; quiet?: boolean} = {}): Promise<T> {
  if (exclusive) throw new Error('正在恢复数据，请完成后再编辑。')
  if (!options.recovering) assertPersistenceWritable()
  exclusive = true
  conceal = options.quiet === true
  emit()
  try {return await work()} finally {exclusive = false; conceal = false; emit()}
}
