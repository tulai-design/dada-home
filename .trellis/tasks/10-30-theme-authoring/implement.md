# 主题作者实施计划

状态：待主会话审读、激活；只准备文档，无runtime变更。用户已授权按依赖顺序开发，不重复询问相同范围。

## 1. 顺序与文件职责

| 步骤 | 主要ownership | 实际交付/检查 |
| --- | --- | --- |
| 1 | themeAuthoring/catalog.ts、validator/resolve；themes.ts/themeCatalog/workspace数据层 | 盘点所有内置实际字段生成目录，先red未知token/错scope/整批失败；token/recipe/shell/resource只有真实绑定 |
| 2 | workspaceStore/syncData/incrementalConfigSchema/templates相关数据测试 | recipes/shellConfig全边界校验、完整派生/保存/模板/备份/同步往返；版本+1，无兼容桥 |
| 3 | recipe adapter CSS、Switch cover CSS、Win98 controller、ShellModel投影 | 显式recipe实际覆写普通控件；coverScale与windowGap真实消费且布局仍受安全边界限制，不动用户Dock偏好 |
| 4 | themeAuthoring纯draft模型+内存store+resource状态 | id/rev、source/dependency fingerprint、selectionGeneration、整批patch；同步末段唯一commit，undo/冲突/stop |
| 5 | fonts.ts document-scoped lease、去静态@import、正式root资源协调 | 系统fallback、固定来源、实际font加载/超时/404、generation/引用计数清理；正式预备不提前接管主题 |
| 6 | theme-preview.html/themePreview.tsx/静态presenters/消息协议；Vite与扩展入口 | 独立document/portal/资源，不import App/storage/sync/AI；Web与MV3 packaged自有脚本，真实加载 |
| 7 | ThemeSettings/ThemeAuthoringPanel与preview父bridge | catalog表单、id/rev/diff/冲突/模式/资源、apply/discard；不另设UI范围、不过早正式edit |
| 8 | themeAuthoringTools.ts/tools/ai/skills | 六工具全链路、schema目录生成、纯主题写工具风险等级保持、signal停止；旧即时工具同catalog不绕过 |
| 9 | tests/browser/长期docs/任务收尾 | 真实工具+事务+资源+隔离+截图矩阵；实际合同、双轴审查、本地commit/archive/journal |

先固定catalog/draft/preview协议再并行。数据与作者核心owner独占themes/workspace/所有unknown边界；UI/preview owner独占ThemeSettings/preview入口/桥；字体+渲染owner独占fonts/recipe CSS/shell config消费；Agent工具与browser由owner明确后接入。共享ShellModel/registry/Vite/config文件先串行约定，不互相回滚，不各自commit。

## 2. 必须保持的行为

- 不把ThemeEntry全量改成另一个ThemeSpec树，不加空assets/recipes大全或任意shell JSON；只加本项实际消费字段。
- 目录是validator/form/tool/description/binding一份事实来源，内置预设也走同验证。author颜色scope显式；删除背景猜测兼容逻辑。
- 草稿create/patch/discard不commit；apply只合并最新workspace主题部分。await后重核所有冲突再同步commit，保留无关业务编辑/应用ID/助手审批。
- A→B→A选择变化能检测；正式theme无需另增revision维护负担，canonical fingerprint明确包含全部语义字段。
- preview仅固定脱敏夹具；不import业务根，无二次analytics/AI/sync/保存/应用init。Lobe portal与字体都归iframe document。
- 正式root与preview root不同色/模式可同时存在；有效值/资源/几何检查和视觉审美分开，不把unknown当通过。
- 默认与自定义字体统一可追踪加载；缺资源明确降级且不能apply该revision。显式改系统后备可恢复，不自动删fonts。
- 旧即时工具同目录严格校验；现有切mode/已保存主题切换不强制走草稿。完整主题创作用新事务。
- finish apply沿用现有纯主题工具highRisk=false，不新加审批或免审标志；用户明确应用后仍校验同revision，cancel/signal不可留下迟到commit。

## 3. 定向验证与最终检查

1. 全内置主题及每catalog字段真实值合法；未知字段/错scope/不适用能力/范围/注入/别名循环整次失败；schema/form/tool同范围。
2. derive/edit双路径，builtin不可edit；元数据/双模式/recipe/config/fonts完整；模板/备份/全量和增量sync不丢字段。
3. stale draft/旧调用/源删改/目录变更/选择切换和A→B→A冲突；无关todo/应用配置编辑保留；等待资源期间再变更也拒绝；一次undo与cancel零历史。
4. iframe真实输入/按钮/各状态/静态overlay；正式root/portal/font links不被污染；有限几何与viewport声明准确。
5. remote字体成功/404/离线/CSP/超时/A→B→A迟到/lease释放；系统后备不联网；失败不改变正式主题。
6. Web/MV3真实加载入口；1440/390/320/分栏窄容器、浅深、reduce-motion；派生保持应用DOM/runtime/init/草稿与审批。
7. 工具实际dispatch从schema发现→create→patch→inspect→确认apply/discard；失败是failed事件、停止无迟到commit。

最终执行本机pnpm：

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH=/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
git diff --check
```

没有lint命令，不报告lint。浏览器隔离fixture/profile，无真实模型/用户存储/远端。记录red/green与资源失败证据，更新docs/design-system.md单一正文和实际现状，不提前声称工坊可安装。针对本项开始commit记录固定baseline做Standards/Spec双轴审查，检查通过main本地提交，仅归档theme-authoring并写中文journal；父任务与local-theme-packages仍未完成。
