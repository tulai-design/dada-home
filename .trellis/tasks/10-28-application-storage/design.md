# AI 应用存储设计

日期：2026-10-28。范围为本轮子任务，按新开发实现，不读取或迁移旧 `fp.app.*` / `fp.applet.*`。

## 身份与预算

新增 IndexedDB `apps` 仓，`keyPath: k`，记录 `{k: 'app:<instanceId>' | 'applet:<instanceId>', v: JSON对象}`。canonical instance ID 不随形态、设置、安装状态变化；普通组件仍仅操作 kv。完整同步身份继续为 `app:app:<id>` / `app:applet:<id>`，从 apps 仓采样全部记录，包括已卸载应用保留的数据。配置同步不包含业务数据。

统一预算为每个应用实例整个 JSON 对象序列化后的 **8 MiB UTF-8 字节**。这不是浏览器总配额；超预算入队前拒绝并保留原值，实际 quota/事务失败分别报告。只接受 JSON 对象及其 JSON 值；不截断、不默默丢字段。schema 与预算校验为无环境依赖模块，供运行时、备份、同步共用。

## 仓库接口与可靠性

`applicationDataSchema.ts` 定义 ApplicationDataRef `{kind: 'app' | 'applet', id: string}`、ApplicationDataRecord、applicationDataKey(ref)、validateApplicationData(value)、validateApplicationDataRecord(value)、APPLICATION_DATA_MAX_BYTES。

`applicationData.ts` 提供异步 `loadApplicationData(ref)`、`setApplicationValue(ref,key,value)`、`replaceApplicationData(ref,snapshot)`、`flushApplicationData()`。按实例懒加载，不在启动时加载全部应用大对象。缺失记录才返回空对象；读取失败拒绝，不发布空缓存。返回值隔离引用，不能绕过保存入口修改缓存。

实例状态及待写队列属于仓库，不属于 iframe/组件挂载。先读取成功才允许覆盖；并发 App 单键更新在仓库合并最新值。接受写入时校验、克隆，检查全局写门禁；事务完成后才 resolve。失败 reject、登记持久化状态并保留最新 pending；重试保存最新值，旧完成不得清除更新。保存屏障必须覆盖已经调用但仍等初始化的写入，不只覆盖已进入 DB 的队列。flush 在恢复独占门禁内允许排空先前已接受的数据；新写入被门禁拒绝。

## 运行时

HTML App 保留 `await tada.store.get/set`；set Promise 成功表示 IndexedDB 事务已提交，失败 reject。宿主避免 read→await→write 的并发覆盖。

Applet 保留声明式 persist，保存协议增加运行 token、递增请求标识和提交回执。宿主读取成功才 init；读失败显示重新读取入口。runner 校验父消息来源及当前会话，自动保存捕获当前持久字段，区分已发送与已确认值；失败可以重试最新快照。旧文档消息、旧回包、重复请求不能污染新运行。业务状态立即交互，保存状态只在回执后确认。运行错误与保存错误分开，关窗/切形态不取消已接受的保存。

## 备份、恢复、同步

DB 升版本加入 apps；snapshot 一个事务读取 kv/apps/convs/turns。saveBarrier 加应用队列。备份使用 **version 2**，四仓均必填，旧格式直接拒绝；导入严格验证应用身份/重复/JSON/预算。恢复日志明确当前新格式，覆盖四仓；恢复原始快照仅验证恢复所需结构，不以导入预算拒绝可救回原值。reset 包含 apps。同步逻辑身份不变，物理目标由 localStorage 改为 apps；旧物理键不参与同步。读取、恢复、同步失败不清空原值。

versionchange 立即关闭旧连接，设置独立 `db-reload` 状态，拒绝旧页面重新 open 和业务写入，提示重载。意外 close 仍允许真实重试；不混用同步完成提示。

## 验证

公开仓库行为测试覆盖并发单键合并、读失败、事务确认/abort、最新值重试、UTF-8 预算和隔离身份。实际 runner/宿主协议测试覆盖初始化、延迟回执、会话隔离与重试。隔离浏览器使用真实 IDB/iframe，注入 quota/abort/unavailable 故障，检验大数据关闭/重开/刷新、设置/形态/卸载撤销、备份/同步与版本变化。只使用测试上下文，禁止读写真实用户浏览器数据。
