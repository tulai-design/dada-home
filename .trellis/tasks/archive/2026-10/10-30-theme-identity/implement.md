# 主题身份第一阶段实施计划

状态：已激活，实施中。先审读 design.md，确认 `skin/shell/origin`、解析结果及共享 main 的覆盖规则，再开始产品实现。

## 1. 红色行为证据

优先在现有 `scripts/test-theme-tools.mjs`、`test-appearance.mjs`、`test-workspace-history.mjs`、`test-sync-records.mjs` 中扩充真实操作回归；必要时新增主题身份专用 Node 脚本，由主会话接入 package.json，不靠源码字符串匹配。

- 对纸张、iOS、pixel、switch、win98 使用真实 tweak 操作写主色：断言当前及另一模式的有效主色、skin/shell、完整未改共享值、双模式和字体；来源为 shared，内置定义保持原样。
- 改名、save 另存、显式模式补丁、共享与模式同 key、分支替换/合并/清空分别验证；mode/base/frameOff 的保存与重新激活行为明确区分。
- 非法变量、字体、实现组合、origin 与模板主题必须在任何提交前拒绝；失败不增加 history，不产生半份工作空间。
- 模板 `my-custom` 保存→读取→采用后仍为相同设计和实现；不受内置预设顺序影响。

先确认新增行为测试在旧代码上因目标缺陷失败，保留命令与错误摘要；历史探针不改成新回归。

## 2. 核心实现顺序与文件

| 顺序 | 文件 | 必要改动 |
| --- | --- | --- |
| 1 | `src/lib/workspace.ts`，必要纯目录模块 | 最小 ThemeEntry 身份字段、五个内置定义与合法实现能力目录；不新增空扩展字段 |
| 2 | `src/lib/themes.ts` | 统一 unknown 校验、完整派生、保存/模式补丁合同、来源解析及 frame 能力；不依赖 DOM 或 store |
| 3 | `src/lib/appearance.ts` | 消费统一基础与有效值，输出身份/来源；保留还原内容与 Dock 偏好合同 |
| 4 | `src/lib/workspaceStore.ts`、`templates.ts` | 新字段完整往返、精确模板主题身份、完整设计查重及容量失败语义 |
| 5 | `src/lib/syncData.ts`，必要时 `incrementalConfigSchema.ts` | themes 和模板 theme 使用同一严格校验；出入站同时覆盖，不写第二份主题 validator |
| 6 | 对应 `scripts/test-*.mjs` | 新模型 fixture 和真实行为回归；不因新接口删除失败的行为断言 |

动产品前发主会话共享接口摘要。若发现范围外调用也需要字段变更，先报告，让其负责人更新；不可用 optional/类型断言绕过真实新合同。

## 3. 并行接线接口

主会话协调 App/tools/Settings 实现方：

1. 实例 ID 只供库操作；视图消费 resolveTheme 的 skin/shell，外框消费目录能力。
2. saveTheme 新建支持 from 指定来源（默认当前），更新时拒绝 from；origin version 为正整数，内置从 1 起。
3. 主题切换初始化 effect 使用 shell 变化，禁止同 shell 变体换色重置窗口、启动器、应用或助手。
3. 工具读回有效值、字段来源与 renderer 身份；共享主色覆盖规则和 save 新主题的完整来源写入描述。
4. Settings 保存完整设计与当前身份；不另建规则判断或将用户 Dock 偏好写回主题。

CSS 本阶段原则上不改：现有 dataset.skin 取值保持相同，仅 paper 对应无专属 skin；若实测需要 CSS 修复，由接线方说明具体原因后局部修改。

## 4. 绿色行为与数据往返

核心实现完成后运行主题/外观/历史/模板和同步相关脚本。覆盖：

- 完整 workspace JSON 重读、undo/redo，以及每个内置派生后的深浅色与共享值。
- 模板导出/导入/采用保持精确身份；重复内容判定包含 skin/shell/origin，避免同色不同外壳误合并。
- 备份恢复、快照同步 config codec 和增量 project/apply 路径接受新模型并保持身份；故意损坏 theme 或 snapshot.theme 验证整次拒绝。
- 新主题、更新、删除、还原及 clear 不改变页面、应用数据或与外观无关的设置。

真实 App 浏览器矩阵由主会话/接线方完成：五种造型亮暗、桌面/窄屏/助手分栏；Switch/Win98 当前窗口与输入、应用运行器、助手草稿/审批在同外壳变体修改后保持。执行现有 A1/A2 和主题浏览器脚本，记录实际覆盖，不能把纯函数结果当浏览器保留证明。

## 5. 最终质量门禁与收尾

只使用本机工具链；本项目没有 lint 命令。

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
```

子代理向主会话报告改动文件、红绿命令、已通过检查、未运行检查及真实风险；不 commit、不 push、不改真实本地数据或远端。主会话整合浏览器验收、更新长期合同与任务状态后执行本地提交，按总计划再推进 shell-host。
