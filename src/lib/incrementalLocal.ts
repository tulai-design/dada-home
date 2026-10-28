import {db, type DbOperation, type DbRead} from './db'
import {ACTIVE, STORE, bindingOf, freshRecord, putRecord, read, recordKey, recordOf, touchRecord, type SyncRef} from './incrementalRows'

const RETRIES = 3
const stores = (operations: DbOperation[]) => [...new Set(operations.map(operation => operation.store))]

/**
 * 业务写入与同步草稿标记同事务提交。没有绑定时只是一次普通批量写；
 * 绑定在采样与事务之间改变时重采样，不能让已确认写入漏掉待同步标记。
 */
export async function commitWithSync(operations: DbOperation[], touched: SyncRef[]): Promise<void> {
  if (!touched.length) {await db.batch(operations); return}
  const refs = [...new Map(touched.map(ref => [`${ref.collection}\u0000${ref.key}`, ref])).values()]
  let lastError: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const sampled = bindingOf(await db.get(STORE, ACTIVE))
    const reads: DbRead[] = [read(ACTIVE), ...(sampled ? refs.map(ref => read(recordKey(sampled.epoch, ref))) : [])]
    try {
      await db.atomic([...new Set([...stores(operations), STORE])], reads, values => {
        const binding = bindingOf(values[0])
        if (binding?.epoch !== sampled?.epoch) throw new Error('RESAMPLE')
        const writes: DbOperation[] = [...operations]
        if (binding) refs.forEach((ref, index) => {
          const row = recordOf(values[1 + index], binding.epoch, ref) ?? freshRecord(binding.epoch, ref)
          writes.push(putRecord(touchRecord(row)))
        })
        return {operations: writes, result: undefined}
      })
      return
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'RESAMPLE') throw error
      lastError = error
    }
  }
  throw new Error('保存期间同步绑定持续变化，请稍后重试。', {cause: lastError})
}

