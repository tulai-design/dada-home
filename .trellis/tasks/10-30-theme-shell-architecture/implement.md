# A3 实施拆分与验收计划

状态：in_progress。主题身份与完整派生第一阶段已实施并通过验收；后续依赖仍按序推进。用户已接受分层开放方向；后续按具体子任务的最新范围执行，不重复询问同一产品方向。

## 纵向任务

| 顺序 | 子任务 | 依赖 | 独立交付 |
| --- | --- | --- | --- |
| 1 | theme-identity | A1/A2已验收 | 派生现有深度主题且真实改色，保存/模板/恢复/同步不丢身份 |
| 2 | shell-host | theme-identity | 三外壳经统一宿主运行，换壳保持业务与输入，新增Adapter不改App条件 |
| 3 | theme-authoring | shell-host | 同一能力目录驱动Agent/设置，隔离主题草稿可取消与应用 |
| 4 | local-theme-packages | theme-authoring | 本地声明式包安装、启用/停用、缺包保留和更新失败恢复 |

父子关系与blocked_by分别登记，不把规划完成当实现完成。第三方代码runner/在线工坊单独后续里程碑，不创建空泛实现任务。

## 每轮执行步骤

1. 读取当前子任务PRD、父设计、相关规范及研究证据；细化该子任务design/implement，并完成最新范围对齐。其他未来子任务暂不假定全部字段。
2. 按真实公开行为新增红色回归，先验证用户结果再调整实现。主题身份子任务用真实themes/store/模板往返，Shell用真实App，作者用实际目录/草稿/提交。
3. 小步产品变更，Agent/UI共用领域操作，延续commit/history与A1/A2。
4. 定向回归后本机tsc、完整test、build；浏览器使用独立上下文与合成服务，不读取真实用户存储/凭据。
5. Standards/Spec独立审查；只将已验证行为晋升运行时规范，更新design-system单一正文与按需目录说明。
6. main本地提交、当前完成子任务归档和日志；全部必要子任务及集成通过前，父任务保持未完成。无推送/发布授权。

## 源码高风险点

- `workspace.ts/themes.ts`：数据身份、完整派生、双模式优先级、默认值来源。
- `workspaceStore.ts/templates.ts/syncData.ts/incrementalConfigSchema.ts`：精确主题ID、全部unknown入口及往返；不可只改TS。
- `App.tsx`：通用导航、应用占用、助手/审批、稳定内容舞台和页面检查登记；按纵向切片迁移。
- `ThemeSettings.tsx/SettingsPage.tsx/main.tsx`、皮肤CSS：能力声明、portal/Lobe适配、静态资源加载与样式顺序。
- `ApplicationHost.tsx/ApplicationWindow.tsx/AssistantSplitPane.tsx`：DOM/容器身份、窗口几何、最小化与surface合同。
- `tools.ts/ai.ts/skills.ts/docs/design-system.md`：能力发现、有效值、写入/失败/取消；主提示不继续硬编码每套主题限制。
- `registry.ts/market.ts`：首期只建立可信shell/skin目录；动态包阶段才增加生命周期与缺包读取合同，不泛化成万能registry。

## 自动检查

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
git diff --check
```

现有测试可复用主题/appearance/theme-tools、application-tools/window、assistant-navigation/flows、A1/A2执行行为、workspace-history、storage/sync，及Switch/Win98/各内置主题browser脚本。本项目无独立lint命令。

## 浏览器集成矩阵

- 普通、Switch、Win98 × 浅/深 × 桌面1440、窄屏390/320、助手分栏窄画布；减少动画可用，末项/窗口/任务栏可达。
- 当前页面/设置/市场/监控/应用导航，同目标重复打开，删除目标回退，设置重复请求。
- 待办未提交输入、设置字段、应用运行init计数、聊天草稿、待决审批在改色/另存/换壳/启动器/最小化后保持；surface变化不扩大既有承诺。
- A→B→A反复热切：旧变量、CSS、字体、订阅、动画、指针捕获和对象URL不残留；资源404/离线fallback可用。
- 正式主题与预览不同：portal、toast/modal/drawer/window无污染，预览不启动真实存储/AI/同步/应用副作用。
- 缺失/损坏/冲突依赖、外壳渲染失败均可恢复，不丢数据；权限与保存故障入口不能被主题覆盖。
- Web与构建后MV3均验证数据主题；不能只在dev HMR通过就称安装热插拔完成。

## 本轮研究验证

初始规划轮仅做源码审查和真实领域隔离探针，文档检查相对链接与JSON/context，不重复执行与文档无关的全量build。生产变更测试留待各子任务实际执行后记录；不把研究脚本的缺陷断言当修复验收。
