# ShellHost 实施计划

状态：已实现并通过验收。依赖 theme-identity 已交付，基线 `62db7cb`；用户顺序开工授权持续有效。本文不代表 runtime 已改。

## 1. 顺序与所有权

先建立真实行为 red，再按导航、固定舞台、外壳局部状态、故障/能力逐段落实。每段均能通过相同业务边界验证，最终清除旧 App shell 专属状态/props；不要同时保留两套长期导航或 presentation。

| 顺序 | 文件/模块职责 | 验证点 |
| --- | --- | --- |
| 1 | 浏览器回归脚本：真实 App iOS→Switch→Win98→iOS；进入启动器、最小化、恢复 | DOM 引用、未提交 todo、应用 init/canonical ID、Reader、助手草稿和审批；记录旧缺陷 red |
| 2 | `src/lib/shell/navigation.ts` 与宿主导航 hook/执行器；App 所有入口消费 | 单目录；合法/非法目标；同目标成功 revision；删除当前目标回退；应用打开/返回策略 |
| 3 | `src/components/shell/` 合同/静态 registry/ShellHost/ShellCanvas；先接 standard | 固定舞台/画布/portal，chrome 不包业务；shell session 独立组件 hooks；固定外部/内部锚点 |
| 4 | 三 Adapter 及 Rail/SwitchShell/Win98Shell 私有呈现 | 只读投影+判别 intent；局部菜单/封面/窗口；移除 App 的 `switchBoard/win98*` 与 `bindOpen` |
| 5 | App/Reader/ApplicationHost/ApplicationWindow 附着可见性协调 | shell 隐藏保留实例；自身 minimized 不被覆盖；close 才执行现有关闭/Reader 清除 |
| 6 | themeCatalog 与 SettingsPage/ThemeSettings 能力消费 | frame 仍 skin 能力；header/avatar/navigation 为 shell 元数据；无新增外壳 ID 分支 |
| 7 | Adapter 错误边界与有效渲染回落；第四 Adapter 测试夹具 | 缺失/render/event/非法布局；有效 skin/variables/layout 真回落；可信设置/助手/停止/重试 |
| 8 | pageInspector/Fx/专属 CSS 及稳定 stage 布局 | 已提交隐藏同步退出检查；inert/focus；直接子选择器；保留区与窄画布 |
| 9 | 测试/文档/审查/提交 | 全矩阵、命令检查、源码基线双轴审查、实际合同与任务收尾 |

文件名可随现有目录习惯收敛，不能拆成只透传同一组几十 props 的空包装。模块内部可用一个小 context 连接两个固定 chrome anchor，公开接口保持 design.md 的 model/intent/presentation，禁止万能 setter/store 引用。外壳组件是独立 hooks owner，不动态调用 adapter hook。

如分工并行：宿主实施者独占 App/固定树/导航执行器；Adapter 实施者独占三 chrome/各自 CSS（固定合同后开始）；验证者独占浏览器脚本与验收记录。Shared registry、能力和 Reader/application 文件先明确单一 owner。所有实施者不回滚他人，不自行提交，最后主会话串行整合检查。

## 2. 关键实施约束

- 正常路由仍可按原行为卸载；换 shell/主题、打开启动器、最小化不得新增卸载。业务 children 不交 Adapter，不放其错误边界，不改变 portal target。
- 同目标成功激活有 revision；导航验证在宿主最新数据上执行。失败不先 reveal/关闭启动器，不用 pageId effect 替代成功回执。
- `minimizeWin98Window` 现有清 Reader/应用最小化策略改为 shell 临时隐藏；`closeWin98Window` 的真实 close/返回策略保留在 `close-content`。
- 所有根 CSS 写入经有效渲染结果协调。Win98/Switch 故障回落测试先读旧 CSS 隐藏规则，再实际验证 safe standard/paper，可点/可见必须用 computed geometry 与真实点击证明。
- Adapter 仅发布有限布局；验证、去重、隐藏/检查与焦点在稳定宿主完成。不得通过 passive effect 留下隐藏但可检查的一帧状态。
- 安全/恢复入口在可信宿主，错误 session 不得包助手/审批。事件/异步错误单独捕获；不把 ErrorBoundary 描述成沙盒。
- 测试第四 Adapter 通过内部 registry 注入，不放宽生产 ThemeShell/schema，不改 App/Settings 增加 test ID 分支。

## 3. 必须完成的验收矩阵

1. 三外壳所有页面/系统页/应用/助手入口；同目标恢复、同设置 section 重开；无效/已删目标不伪造成功；应用 modal/drawer/page 原策略。
2. 同壳变体保持局部状态；跨壳同业务 route 未提交输入、真实 DOM、应用 init/网络计数及 canonical ID 保持；助手草稿、发送锁、待决审批/停止路径保持 A1/A2。
3. Switch 启动器/Win98 桌面与最小化隐藏而不销毁；Reader 恢复保持；原本自己最小化的应用不因 shell restore 意外出现；close 确实关闭当前附着运行并按原策略返回。
4. 隐藏内容无键盘/指针/辅助技术进入，焦点可恢复且不抢新目标；隐藏舞台不能被 inspector 测量；homepageDraft 检查规则保持。
5. 切换释放旧监听/电池回调/指针捕获/动画/portal；切回没有双监听、重复打开和额外 init。
6. 浅深、1440/390/320、分栏窄画布、reduce-motion；标题/任务栏与 canvas reserves 无遮挡、负宽度或滚动失效。
7. 第四 Adapter 仅实现+注册；不同 hooks 数切换无 hook 次序错误；duplicate ID 明确拒绝；缺失、render/event/非法布局故障可真实操作设置/助手/停止/重试，原主题记录与业务实例保持。
8. fallback 同时验证请求 Win98/Switch 的根有效 skin/变量/layout，不能仅断言 fallback 文案出现；恢复成功不反复重挂业务舞台。
9. Web 与开发者模式 MV3 构建/真实相关回归，已交付 theme-identity 的派生/模板与 A1/A2 工具失败语义不退化。

## 4. 检查与收尾

始终用 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`，build 的 PATH 同样优先该 Node 目录。

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH=/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
git diff --check
```

本项目没有 lint 命令，不报告 lint。浏览器测试用隔离 profile/fixture/本地端口，不读改真实用户存储或调用真实 AI/远端。保留 red/green 证据及失败修复，不靠删除旧断言掩盖行为回归。

更新长期目录/领域/运行时技能文档只描述实际交付；`docs/design-system.md` 保留路径与单一正文。针对本项基线 `62db7cb` 做 Standards/Spec 双轴审查，包括新增文件；主会话检查通过后在 main 本地提交、仅归档 shell-host、记录中文 journal。父任务保持未完成，再按依赖进入 theme-authoring，无推送/发布。
