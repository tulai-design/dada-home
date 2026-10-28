import {db, type DbOperation} from './db'
import {CONFIG_NAMES, configValue, localConfig, type ConfigApply} from './incrementalAdapters'
import {ACTIVE, STORE, bindingOf, configApplyKey, freshRecord, isObject, putRecord, read, recordKey, recordOf, touchRecord} from './incrementalRows'
import {digest} from './syncProtocol'

/**
 * 配置在 localStorage，与 IndexedDB 不能同事务：入站值先作为“待应用”行随同步元数据提交，
 * 再由这里写入 localStorage；崩溃后下次启动重放，写入是幂等的。
 */
const configRef = (name: string) => ({collection: 'config' as const, key: name})
const valueDigest = (value: unknown) => digest(value)

/** 把已提交的待应用配置写入 localStorage。返回实际写入的项数。 */
export async function applyPendingConfig(): Promise<number> {
  const rows = await db.byIndex<unknown>(STORE, 'type', 'config-apply')
  let applied = 0
  for (const raw of rows) {
    if (!isObject(raw) || raw.type !== 'config-apply' || typeof raw.name !== 'string' || !CONFIG_NAMES.includes(raw.name) || raw.k !== configApplyKey(raw.name) || raw.value !== null && typeof raw.value !== 'string') throw new Error('待应用的配置记录无效，请刷新页面重试。')
    const row = raw as unknown as ConfigApply, key = `fp.${row.name}`
    if (row.value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, row.value)
    // 落盘后的本机值就是已对齐的基线，不能被下一次对账当成本机编辑再推回远端。
    const settled = await valueDigest(configValue(row.name, localConfig(row.name)))
    const binding = bindingOf(await db.get(STORE, ACTIVE))
    await db.atomic([STORE], [read(ACTIVE), ...(binding ? [read(recordKey(binding.epoch, configRef(row.name)))] : []), read(row.k)], values => {
      const current = bindingOf(values[0]), operations: DbOperation[] = [{store: STORE, type: 'delete', key: row.k}]
      if (binding && current?.epoch === binding.epoch) {
        const record = recordOf(values[1], binding.epoch, configRef(row.name))
        if (record) {record.digest = settled; operations.push(putRecord(record))}
      }
      return {operations, result: undefined}
    })
    applied++
  }
  return applied
}

/**
 * 对账：本机配置的可携值与上次对齐的摘要不同，就记为一次本机修改。
 * 这样无论配置从哪条路径写入（设置页、备份恢复、旧同步），都不会漏掉待同步标记。
 */
export async function reconcileConfig(epoch: string): Promise<number> {
  let touched = 0
  const absentDigest = await valueDigest(null)
  for (const name of CONFIG_NAMES) {
    const current = await valueDigest(configValue(name, localConfig(name)))
    const ref = configRef(name)
    const changed = await db.atomic([STORE], [read(ACTIVE), read(recordKey(epoch, ref)), read(configApplyKey(name))], values => {
      if (bindingOf(values[0])?.epoch !== epoch) throw new Error('增量同步绑定已改变，对账已停止。')
      // 入站值尚未落盘时，本机值不是稳定基线，留给 applyPendingConfig 之后的下一轮。
      if (values[2] !== undefined) return {operations: [], result: false}
      const record = recordOf(values[1], epoch, ref)
      if (record?.digest === current) return {operations: [], result: false}
      const absent = current === absentDigest
      if (!record && absent) return {operations: [], result: false}
      const row = record ?? freshRecord(epoch, ref)
      row.digest = current
      // 本机没有配置、且从未发送过：只记摘要，不制造一次删除。
      if (!(absent && row.remoteRevision === null && !row.inFlight)) touchRecord(row)
      return {operations: [putRecord(row)], result: true}
    })
    if (changed) touched++
  }
  return touched
}
