/**
 * IndexedDB 的一层薄封装，不引第三方库。
 *
 * 存什么：体量会无限增长的数据 —— 对话记录、组件自己的数据（待办、便签、订阅源、书签）。
 * 不存什么：工作空间结构、设置这类很小、又要在首屏同步读到的东西，仍放 localStorage。
 *
 * 三个仓库：
 *   kv     组件数据，键是实例 id（或 @shared.*）
 *   convs  对话（只有标题和时间）
 *   turns  每一轮问答，按 convId 建了索引，翻开某个对话时只读它自己的
 *
 * 浏览器不支持或被禁用（部分无痕模式）时，打开会得到 null，调用方回落到 localStorage。
 */

const NAME = 'dada'
const VERSION = 1

export type StoreName = 'kv' | 'convs' | 'turns'

let opened: Promise<IDBDatabase | null> | null = null
let ready = false

/** 数据库是否已成功打开。componentData 靠它决定走 IDB 还是 localStorage。 */
export function dbReady(): boolean {
  return ready
}

export function openDb(): Promise<IDBDatabase | null> {
  if (opened) return opened
  opened = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const request = indexedDB.open(NAME, VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' })
        if (!db.objectStoreNames.contains('convs')) db.createObjectStore('convs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('turns')) db.createObjectStore('turns', { keyPath: 'id' }).createIndex('convId', 'convId')
      }
      request.onsuccess = () => {
        ready = true
        // 另一个标签页要升级版本时，让路，不阻塞它
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opened
}

const wrap = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

async function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => Promise<T>, fallback: T): Promise<T> {
  const db = await openDb()
  if (!db) return fallback
  try {
    const tx = db.transaction(store, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const result = await work(tx.objectStore(store))
    await done
    return result
  } catch {
    return fallback
  }
}

export const db = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => wrap(s.get(key)) as Promise<T | undefined>, undefined),
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => wrap(s.getAll()) as Promise<T[]>, []),
  byIndex: <T>(store: StoreName, index: string, key: string) =>
    run<T[]>(store, 'readonly', (s) => wrap(s.index(index).getAll(key)) as Promise<T[]>, []),
  put: (store: StoreName, value: unknown) => run<void>(store, 'readwrite', async (s) => void (await wrap(s.put(value))), undefined),
  putMany: (store: StoreName, values: unknown[]) =>
    run<void>(
      store,
      'readwrite',
      async (s) => {
        await Promise.all(values.map((value) => wrap(s.put(value))))
      },
      undefined,
    ),
  del: (store: StoreName, key: string) => run<void>(store, 'readwrite', async (s) => void (await wrap(s.delete(key))), undefined),
  delMany: (store: StoreName, keys: string[]) =>
    run<void>(
      store,
      'readwrite',
      async (s) => {
        await Promise.all(keys.map((key) => wrap(s.delete(key))))
      },
      undefined,
    ),
  clear: (store: StoreName) => run<void>(store, 'readwrite', async (s) => void (await wrap(s.clear())), undefined),
}
