# 可恢复提交提取审查

日期：2026-10-28。基线 `8ff7043`。独立只读审查 `src/lib/storageCommit.ts`、`src/lib/storage.ts` 及真实调用入口；未修改产品文件，没有读取用户存储或连接真实远端。

## 已运行的检查

`/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-storage-backup.mjs`：14/14 通过。覆盖严格输入、即时导出、事务 abort、配置失败回退、回退失败保日志、同页恢复重试及无 Web Locks 的行为。原备份依旧在成功提交后立即重新加载。

代码依赖方向为 `storageCommit → chat/componentData/db/persistence`，提取模块不反向依赖 sync 或 storage。备份层保留等待同步结束，随后调用共用提交。只要同步协调层使用 `storageCommit` 而不反向 import storage，即可消除原 storage/sync 的运行时循环。

恢复日志与业务 IDB 操作仍在同一个 batch 中写入；localStorage 失败后回退，回退失败保留日志和只读错误。恢复/启动同源 Web Lock 与同标签独占门禁顺序沿用原实现。现存其他标签页业务写仍不隔离，属已明确边界。

## 已复现的集成问题

共用 `commitStorage()` 完成后会退出 `withPersistenceExclusive()`，但没有通知或更新已挂载业务 store 的内存。对于原备份，调用方立即 reload；对于本轮计划的“同步成功返回 needsReload，由用户手动刷新”，不能只提示后仍允许编辑。

通过一次性 Node probe 转译真实 `componentData.ts`、`storageCommit.ts` 和 `persistence.ts`，仅为 React、浏览器、数据库提供隔离替身；调用公开 API：

```ts
await initComponentData() // 预置 probe: {count: 1, label: 'before'}
await commitStorage({local: {}, operations: [
  {store: 'kv', type: 'put', value: {k: 'probe', v: {count: 2, label: 'pulled'}}},
]})
const value = readData('probe', null)
writeData('probe', {...value, count: value.count + 1})
await flush()
```

实际结果：

```json
{
  "memoryAfterPull": {"count": 1, "label": "before"},
  "diskAfterPull": {"count": 2, "label": "pulled"},
  "diskAfterNextEdit": {"count": 2, "label": "before"}
}
```

这是确定的数据覆盖：新的远端 label 被下一次基于旧界面值的编辑还原。建议拉取成功后维持专用 `sync-reload` 只读状态，直到页面加载新 store；另一种办法是热更新所有内存，但扩大本轮工作。父会话已分配核心与 UI 实现专用门禁及公开行为/浏览器验证，本文件记录修复前证据，不代替最终验收。

## 其他结论

未发现原备份校验与恢复行为的新增回归。同步调用者必须在门禁内进行最后指纹复核，而且不能依赖提交前一次采样保证网络期间没有新编辑；相应最终协调层仍由另一代理实现和复查。此审查没有声称完成整套同步协议审查。
