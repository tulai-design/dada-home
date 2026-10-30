# 目录与职责

| 位置 | 实际职责 |
| --- | --- |
| [src/main.tsx](../../../src/main.tsx) | 样式、Lobe Provider、存储初始化、PWA 注册与开发工具入口 |
| [src/App.tsx](../../../src/App.tsx) | 页面、助手与全局宿主协调 |
| [src/components/](../../../src/components/) | 页面容器、应用窗口、设置、市场和助手 UI |
| [src/components/shell/](../../../src/components/shell/) | 固定外壳宿主、可信 Adapter、呈现合同与错误回退 |
| [src/lib/shell/](../../../src/lib/shell/) / [useNavigation](../../../src/lib/useNavigation.ts) | 单一导航投影、目标校验与宿主导航执行 |
| [src/widgets/](../../../src/widgets/) | 通过注册协议接入页面的内置组件 |
| [src/lib/registry.ts](../../../src/lib/registry.ts) | 组件定义、配置 schema、规整入口 |
| [src/lib/](../../../src/lib/) | 工作空间纯操作、持久化、主题、AI、业务工具 |
| [src/lib/applet/](../../../src/lib/applet/) | 小程序积木目录、沙盒执行与宿主渲染 |
| [src/fx/](../../../src/fx/) | 特效目录、参数校验、渲染映射及本地素材 |
| [scripts/](../../../scripts/) / [tests/](../../../tests/) | Node 回归脚本与浏览器回归页面 |
| [server/](../../../server/) / [worker/](../../../worker/) | 生产 Node 取数代理与独立 Worker 实现 |

页面结构编辑放在 `ops.ts`，应用目录操作放在 `applications.ts`，持久化和撤销放在 `workspaceStore.ts`。不要把这些逻辑复制进 React 点击处理器或工具说明里。

宿主样式分布在 `styles.css`、`theme.css` 与应用/助手等专题 CSS 中。先定位实际选择器和导入顺序，再增加覆盖规则；不要引入第二套全局控件主题。
