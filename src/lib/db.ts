/**
 * IndexedDB 事务边界。业务数据保存在 kv/convs/turns；recovery 仅用于本机恢复日志。
 * 读写失败必须 reject，不能把数据库故障当成空表或成功保存。
 */
const NAME = 'dada'
const VERSION = 2
export type StoreName = 'kv' | 'convs' | 'turns' | 'recovery'
export type DbOperation =
  | {store: StoreName; type: 'put'; value: unknown}
  | {store: StoreName; type: 'delete'; key: string}
  | {store: StoreName; type: 'clear'}
export type DbSnapshot = {kv: {k: string; v: unknown}[]; convs: unknown[]; turns: unknown[]}

let opened: Promise<IDBDatabase | null> | null = null
let connection: IDBDatabase | null = null

export function dbReady(): boolean {
  return connection !== null
}

export function openDb(): Promise<IDBDatabase | null> {
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
        if (!database.objectStoreNames.contains('convs')) database.createObjectStore('convs', {keyPath: 'id'})
        if (!database.objectStoreNames.contains('turns')) database.createObjectStore('turns', {keyPath: 'id'}).createIndex('convId', 'convId')
        if (!database.objectStoreNames.contains('recovery')) database.createObjectStore('recovery', {keyPath: 'k'})
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
        database.onversionchange = disconnected
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

export const db = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', s => wrap(s.get(key)) as Promise<T | undefined>),
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', s => wrap(s.getAll()) as Promise<T[]>),
  byIndex: <T>(store: StoreName, index: string, key: string) =>
    run<T[]>(store, 'readonly', s => wrap(s.index(index).getAll(key)) as Promise<T[]>),
  put: (store: StoreName, value: unknown) => batch([{store, type: 'put', value}]),
  putMany: (store: StoreName, values: unknown[]) => batch(values.map(value => ({store, type: 'put', value}))),
  del: (store: StoreName, key: string) => batch([{store, type: 'delete', key}]),
  delMany: (store: StoreName, keys: string[]) => batch(keys.map(key => ({store, type: 'delete', key}))),
  clear: (store: StoreName) => batch([{store, type: 'clear'}]),
  batch,
  snapshot: (): Promise<DbSnapshot> => transaction(['kv', 'convs', 'turns'], 'readonly', async tx => {
    const [kv, convs, turns] = await Promise.all([
      wrap(tx.objectStore('kv').getAll()) as Promise<DbSnapshot['kv']>,
      wrap(tx.objectStore('convs').getAll()) as Promise<unknown[]>,
      wrap(tx.objectStore('turns').getAll()) as Promise<unknown[]>,
    ])
    return {kv, convs, turns}
  }),
}
