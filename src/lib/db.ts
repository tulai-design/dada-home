import {reportPersistenceError} from './persistence'

/**
 * IndexedDB 事务边界。业务数据保存在 kv/apps/convs/turns/toolDetails；recovery 仅用于本机恢复日志。
 * 读写失败必须 reject，不能把数据库故障当成空表或成功保存。
 */
const NAME = 'dada'
const VERSION = 6
export type StoreName = 'kv' | 'apps' | 'convs' | 'turns' | 'toolDetails' | 'recovery' | 'incrementalSync'
export type DbOperation =
  | {store: StoreName; type: 'put'; value: unknown}
  | {store: StoreName; type: 'delete'; key: string}
  | {store: StoreName; type: 'clear'}
export type DbSnapshot = {kv: {k: string; v: unknown}[]; apps: {k: string; v: unknown}[]; convs: unknown[]; turns: unknown[]; toolDetails: unknown[]}

let opened: Promise<IDBDatabase | null> | null = null
let connection: IDBDatabase | null = null
let invalidated: Error | null = null

export function dbReady(): boolean {
  return connection !== null
}

export function openDb(): Promise<IDBDatabase | null> {
  if (invalidated) return Promise.reject(invalidated)
  if (opened) return opened
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error('无法打开本地数据库。'))
    }
    try {
      const request = indexedDB.open(NAME, VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv', {keyPath: 'k'})
        if (!database.objectStoreNames.contains('apps')) database.createObjectStore('apps', {keyPath: 'k'})
        if (!database.objectStoreNames.contains('convs')) database.createObjectStore('convs', {keyPath: 'id'})
        if (!database.objectStoreNames.contains('turns')) database.createObjectStore('turns', {keyPath: 'id'}).createIndex('convId', 'convId')
        if (!database.objectStoreNames.contains('toolDetails')) {
          const details = database.createObjectStore('toolDetails', {keyPath: 'id'})
          details.createIndex('turnId', 'turnId')
          details.createIndex('convId', 'convId')
        }
        const upgrade = request.transaction!
        const convs = upgrade.objectStore('convs'), turns = upgrade.objectStore('turns')
        if (!convs.indexNames.contains('recent')) convs.createIndex('recent', ['updatedAt', 'id'])
        if (!turns.indexNames.contains('chronological')) turns.createIndex('chronological', ['convId', 'startedAt', 'id'])
        if (!database.objectStoreNames.contains('recovery')) database.createObjectStore('recovery', {keyPath: 'k'})
        // 早期仅程序入口的应用同步仓没有产品入口；新方案使用独立仓，旧协调数据不迁移。业务五仓不受影响。
        if (database.objectStoreNames.contains('applicationSync')) database.deleteObjectStore('applicationSync')
        if (!database.objectStoreNames.contains('incrementalSync')) {
          const sync = database.createObjectStore('incrementalSync', {keyPath: 'k'})
          sync.createIndex('epoch', 'epoch'); sync.createIndex('type', 'type')
          sync.createIndex('inflight', 'qInflight'); sync.createIndex('draft', 'qDraft'); sync.createIndex('conflict', 'qConflict')
        }
      }
      request.onerror = () => fail(request.error)
      request.onblocked = () => fail(new Error('本地数据库升级被其他标签页阻挡，请关闭旧标签页后重试。'))
      request.onsuccess = () => {
        const database = request.result
        // 被阻挡的打开已报告失败；之后才到达的连接不能偷偷变成可用状态。
        if (settled) {database.close(); return}
        settled = true
        connection = database
        const disconnected = () => {
          database.close()
          if (connection === database) {connection = null; opened = null}
        }
        database.onversionchange = () => {
          invalidated = new Error('本地数据库已在其他页面更新，请重新加载后继续。')
          disconnected()
          reportPersistenceError('db-reload', invalidated)
        }
        database.onclose = disconnected
        resolve(database)
      }
    } catch (error) {fail(error)}
  })
  const tracked = attempt.catch(error => {
    if (opened === tracked) opened = null
    throw error
  })
  opened = tracked
  return tracked
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  const result = new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库请求失败。'))
  })
  // 同一批的后续请求可能同步抛错；先观察每个请求，事务仍由调用边界 reject。
  void result.catch(() => undefined)
  return result
}

async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const handle = await openDb()
  if (!handle) throw new Error('当前浏览器无法使用本地数据库，请使用支持 IndexedDB 的浏览器。')
  const tx = handle.transaction(stores, mode)
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('本地数据库事务失败。'))
    tx.onabort = () => reject(tx.error ?? new Error('本地数据库事务已中止，数据尚未保存。'))
  })
  // 同时观察 request 和事务结果，避免请求先失败时留下未处理的 abort rejection。
  try {
    const [result] = await Promise.all([work(tx), done])
    return result
  } catch (error) {
    try {tx.abort()} catch { /* 事务可能已经结束 */ }
    await done.catch(() => undefined)
    throw error
  }
}

function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  return transaction([store], mode, tx => work(tx.objectStore(store)))
}

async function batch(operations: DbOperation[]): Promise<void> {
  if (!operations.length) return
  const stores = [...new Set(operations.map(operation => operation.store))]
  await transaction(stores, 'readwrite', tx => {
    const requests = operations.map(operation => {
      const store = tx.objectStore(operation.store)
      if (operation.type === 'put') return wrap(store.put(operation.value))
      if (operation.type === 'delete') return wrap(store.delete(operation.key))
      return wrap(store.clear())
    })
    return Promise.all(requests).then(() => undefined)
  })
}

export type DbRead =
  | {store: StoreName; key: string}
  | {store: StoreName; all: true; index?: string; key?: string; limit?: number}
  | {store: StoreName; keys: true; index?: string; key?: string; limit?: number}
/** 最后一个读取的事件内同步决策和排入写入，不允许跨网络/crypto await 维持事务。 */
function atomic<T>(stores: StoreName[], reads: DbRead[], decide: (values: unknown[]) => {operations: DbOperation[]; result: T}): Promise<T> {
  return transaction(stores, 'readwrite', tx => new Promise<T>((resolve, reject) => {
    const values: unknown[] = new Array(reads.length)
    let remaining = reads.length, failed = false
    const fail = (error: unknown) => {if (failed) return; failed = true; try {tx.abort()} catch { /* 事务可能已结束。 */ } reject(error)}
    const apply = () => {
      if (failed) return
      try {
        const plan = decide(values)
        if (!plan || typeof plan !== 'object' || 'then' in plan || !Array.isArray(plan.operations)) throw new Error('数据库事务计划必须同步返回。')
        const requests = plan.operations.map(operation => {
          const store = tx.objectStore(operation.store)
          if (operation.type === 'put') return wrap(store.put(operation.value))
          if (operation.type === 'delete') return wrap(store.delete(operation.key))
          return wrap(store.clear())
        })
        void Promise.all(requests).then(() => resolve(plan.result), fail)
      } catch (error) {fail(error)}
    }
    if (!remaining) {apply(); return}
    try {
      reads.forEach((read, index) => {
        const store = tx.objectStore(read.store)
        const request: IDBRequest = 'all' in read ? (read.index ? store.index(read.index).getAll(read.key, read.limit) : store.getAll(undefined, read.limit))
          : 'keys' in read ? (read.index ? store.index(read.index).getAllKeys(read.key, read.limit) : store.getAllKeys(undefined, read.limit))
            : store.get(read.key)
        request.onerror = () => fail(request.error ?? new Error('本地事务读取失败。'))
        request.onsuccess = () => {if (failed) return; values[index] = request.result; if (--remaining === 0) apply()}
      })
    } catch (error) {fail(error)}
  }))
}

export type DbPageOptions = {
  lower?: IDBValidKey; upper?: IDBValidKey; lowerOpen?: boolean; upperOpen?: boolean
  direction?: 'next' | 'prev'; limit: number
}
/** 有界索引游标；到达 limit 就停止继续读取，不能用 getAll 后再 slice。 */
function page<T>(store: StoreName, index: string, options: DbPageOptions): Promise<T[]> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) return Promise.reject(new Error('分页条数无效。'))
  let range: IDBKeyRange | undefined
  if (options.lower !== undefined && options.upper !== undefined) range = IDBKeyRange.bound(options.lower, options.upper, options.lowerOpen, options.upperOpen)
  else if (options.lower !== undefined) range = IDBKeyRange.lowerBound(options.lower, options.lowerOpen)
  else if (options.upper !== undefined) range = IDBKeyRange.upperBound(options.upper, options.upperOpen)
  return run<T[]>(store, 'readonly', s => new Promise((resolve, reject) => {
    const rows: T[] = []
    const request = s.index(index).openCursor(range, options.direction ?? 'next')
    request.onerror = () => reject(request.error ?? new Error('无法读取聊天分页。'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {resolve(rows); return}
      rows.push(cursor.value as T)
      if (rows.length >= options.limit) resolve(rows)
      else cursor.continue()
    }
  }))
}

export const db = {
  atomic,
  page,
  keysByIndex: (store: StoreName, index: string, key: string) => run<string[]>(store, 'readonly', s => wrap(s.index(index).getAllKeys(key)) as Promise<string[]>),
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', s => wrap(s.get(key)) as Promise<T | undefined>),
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', s => wrap(s.getAll()) as Promise<T[]>),
  keys: (store: StoreName) => run<string[]>(store, 'readonly', s => wrap(s.getAllKeys()) as Promise<string[]>),
  byIndex: <T>(store: StoreName, index: string, key: string) =>
    run<T[]>(store, 'readonly', s => wrap(s.index(index).getAll(key)) as Promise<T[]>),
  put: (store: StoreName, value: unknown) => batch([{store, type: 'put', value}]),
  putMany: (store: StoreName, values: unknown[]) => batch(values.map(value => ({store, type: 'put', value}))),
  del: (store: StoreName, key: string) => batch([{store, type: 'delete', key}]),
  delMany: (store: StoreName, keys: string[]) => batch(keys.map(key => ({store, type: 'delete', key}))),
  clear: (store: StoreName) => batch([{store, type: 'clear'}]),
  batch,
  snapshot: (): Promise<DbSnapshot> => transaction(['kv', 'apps', 'convs', 'turns', 'toolDetails'], 'readonly', async tx => {
    const [kv, apps, convs, turns, toolDetails] = await Promise.all([
      wrap(tx.objectStore('kv').getAll()) as Promise<DbSnapshot['kv']>,
      wrap(tx.objectStore('apps').getAll()) as Promise<DbSnapshot['apps']>,
      wrap(tx.objectStore('convs').getAll()) as Promise<unknown[]>,
      wrap(tx.objectStore('turns').getAll()) as Promise<unknown[]>,
      wrap(tx.objectStore('toolDetails').getAll()) as Promise<unknown[]>,
    ])
    return {kv, apps, convs, turns, toolDetails}
  }),
}
