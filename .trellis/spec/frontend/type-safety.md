# 输入、类型与规整

AI 工具参数、网络返回、备份、历史本地数据均从 `unknown` 进入边界。先确认对象/数组/字段类型，再调用领域操作；TypeScript 断言不能替代运行时校验。

现有边界可复用：

- [registry.ts](../../../src/lib/registry.ts) 的 `normalizeConfig`：按字段类型规整配置，额外嵌套约束交由组件 `normalize`。
- [customWidget.ts](../../../src/lib/customWidget.ts) 的 `normalizeWidget`、`sanitizeCss`、`sanitizeSvg`：声明组件与外观输入。
- [fx/catalog.ts](../../../src/fx/catalog.ts) 的 `normalizeParams`、`normalizeLayer`：特效参数及允许放置的类别。
- [workspaceStore.ts](../../../src/lib/workspaceStore.ts) 的 `migrate` 和各读取函数：旧数据、导入与模板。
- [applications.ts](../../../src/lib/applications.ts)：安装记录、设置 schema 与设置值。

为字段新增一种类型时，同时更新描述/schema、规整、渲染及读取迁移。已知非法输入应该明确失败或按既有契约回落，不能悄悄变成另一个效果后再告诉用户成功。

CSS 安全过滤不等于视觉质量检查。`sanitizeCss` 通过不能证明响应式、对比度或主题适配正确；不要把未来的设计检查器当作已有行为。
