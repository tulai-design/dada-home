import {db} from './db'
import {applicationDataKey, validateApplicationData, validateApplicationDataRecord, type ApplicationData, type ApplicationDataRef} from './applicationDataSchema'
import {assertPersistenceWritable, clearPersistenceError, reportPersistenceError} from './persistence'

type Revision = {version: number; value: ApplicationData}
type Waiter = {version: number; resolve: () => void; reject: (error: unknown) => void}
type Entry = {
  key: string
  value?: ApplicationData
  loading?: Promise<void>
  version: number
  pending?: Revision
  flushing?: Promise<void>
  waiters: Waiter[]
}
const entries = new Map<string, Entry>()
// 包括尚在等待首次读取的保存调用，恢复/导出不能绕过这些已接收请求。
const writes = new Set<Promise<void>>()
const readSource = (entry: Entry) => `application-read:${entry.key}`
const writeSource = (entry: Entry) => `application-write:${entry.key}`

function entryFor(ref: ApplicationDataRef): Entry {
  const key = applicationDataKey(ref)
  let entry = entries.get(key)
  if (!entry) {entry = {key, version: 0, waiters: []}; entries.set(key, entry)}
  return entry
}

function load(entry: Entry): Promise<void> {
  if (entry.value) return Promise.resolve()
  if (entry.loading) return entry.loading
  const work = async () => {
    try {
      const row = await db.get<unknown>('apps', entry.key)
      if (row === undefined) entry.value = Object.create(null) as ApplicationData
      else {
        const record = validateApplicationDataRecord(row)
        if (record.k !== entry.key) throw new Error('应用存储记录身份不匹配。')
        entry.value = record.v
      }
      clearPersistenceError(readSource(entry))
    } catch (error) {
      reportPersistenceError(readSource(entry), error, () => load(entry))
      throw error
    }
  }
  const run = work().finally(() => {if (entry.loading === run) entry.loading = undefined})
  entry.loading = run
  return run
}

function flushEntry(entry: Entry): Promise<void> {
  if (entry.flushing) return entry.flushing
  const work = async () => {
    try {
      while (entry.pending) {
        const revision = entry.pending
        await db.put('apps', {k: entry.key, v: revision.value})
        if (entry.pending === revision) entry.pending = undefined
        const confirmed = entry.waiters.filter(waiter => waiter.version <= revision.version)
        entry.waiters = entry.waiters.filter(waiter => waiter.version > revision.version)
        confirmed.forEach(waiter => waiter.resolve())
      }
      clearPersistenceError(writeSource(entry))
    } catch (error) {
      // 待写快照保留最新值；失败请求明确 reject，不伪装成已落盘。
      const waiting = entry.waiters
      entry.waiters = []
      waiting.forEach(waiter => waiter.reject(error))
      reportPersistenceError(writeSource(entry), error, () => flushEntry(entry))
      throw error
    }
  }
  const run = work().finally(() => {
    if (entry.flushing === run) entry.flushing = undefined
    // 清除错误的同步订阅可能刚好触发下一次保存；不能让它挂在已结束的 drain 上。
    if (entry.pending && entry.waiters.length) void flushEntry(entry).catch(() => undefined)
  })
  entry.flushing = run
  return run
}

function accept(entry: Entry, value: ApplicationData): Promise<void> {
  const version = ++entry.version
  entry.value = value
  entry.pending = {version, value}
  const confirmed = new Promise<void>((resolve, reject) => entry.waiters.push({version, resolve, reject}))
  void flushEntry(entry).catch(() => undefined)
  return confirmed
}

function track(work: Promise<void>): Promise<void> {
  writes.add(work)
  void work.then(() => writes.delete(work), () => writes.delete(work))
  return work
}

/** 当前已接收快照；尚未提交的值可读，但不因此把保存标成成功。 */
export async function loadApplicationData(ref: ApplicationDataRef): Promise<ApplicationData> {
  const entry = entryFor(ref)
  await load(entry)
  return validateApplicationData(entry.value)
}

export function replaceApplicationData(ref: ApplicationDataRef, value: unknown): Promise<void> {
  try {
    assertPersistenceWritable()
    const snapshot = validateApplicationData(value)
    const entry = entryFor(ref)
    return track(load(entry).then(() => accept(entry, snapshot)))
  } catch (error) {return Promise.reject(error)}
}

/** 单键合并在仓库内部执行，不让宿主 read→await→write 丢掉并发键。 */
export function setApplicationValue(ref: ApplicationDataRef, key: string, value: unknown): Promise<void> {
  try {
    assertPersistenceWritable()
    if (typeof key !== 'string') throw new Error('应用数据字段必须是字符串。')
    const field = validateApplicationData({[key]: value})
    const entry = entryFor(ref)
    return track(load(entry).then(() => accept(entry, validateApplicationData({...entry.value, ...field}))))
  } catch (error) {return Promise.reject(error)}
}

/** 只排空已经接收的请求；恢复门禁内也可调用，不接收任何新编辑。 */
export async function flushApplicationData(): Promise<void> {
  do {
    const results = await Promise.allSettled([
      ...writes,
      ...[...entries.values()].filter(entry => entry.pending).map(flushEntry),
    ])
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
  } while (writes.size || [...entries.values()].some(entry => entry.pending))
}
