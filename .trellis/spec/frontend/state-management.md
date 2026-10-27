# 状态与持久化

## 工作空间与编辑

[workspace.ts](../../../src/lib/workspace.ts) 定义页面、组件、应用、主题与模板结构。[ops.ts](../../../src/lib/ops.ts) 负责结构编辑与验证，[workspaceStore.ts](../../../src/lib/workspaceStore.ts) 负责提交、本地存储、迁移、订阅和撤销/重做。

新增结构写操作遵循“读取当前工作空间 → 纯函数返回新结构 → `commit`”。不要直接修改 store 内对象或从工具写 `localStorage`。编辑前规整配置，导入和历史数据读取也要经过迁移/读取校验，不能只保护新建路径。

`migrate` 会恢复固定首页、规整主题和应用记录等。结构变更需考虑旧快照、模板导入、缺失字段和无效组件；不能只让新初始化的数据可用。首页布局草稿通过独立内存状态、首页冲突检查和一次正式提交实现，见[首页草稿规范](homepage-drafts.md)；不能把它扩大理解为全工作空间或业务数据事务。

## 数据分离

- 页面、组件配置与主题属于工作空间；见 `workspaceStore.ts`。
- 实例私有业务数据使用 [componentData.ts](../../../src/lib/componentData.ts)；IndexedDB 可用时使用库，否则回落到本地存储。
- 全局小设置通过 [store.ts](../../../src/lib/store.ts)；聊天和组件大数据由 [db.ts](../../../src/lib/db.ts) 与 [storage.ts](../../../src/lib/storage.ts) 初始化。
- 应用用户设置和业务状态分离：设置进入安装记录，业务状态使用 Applet `persist` 或 App 的 `tada.store`。

[applications.ts](../../../src/lib/applications.ts) 是应用安装记录的入口。应用取消页面挂载、关闭窗口、最小化和卸载是不同操作，不得混用。卸载应用保留私有数据的语义与普通组件移除不同，修改时查对应调用链，不凭名称推断。
