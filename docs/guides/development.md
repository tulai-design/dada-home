# 开发指南

[返回项目首页](../../README.md) · [使用指南](usage.md) · [部署指南](deployment.md)

## 环境与启动

建议使用 Node.js 24；CI 当前使用 24.11.0。包管理器以仓库 `package.json` 与锁文件为准，已有工作区沿用原安装版本，避免无关升级依赖。

```sh
git clone https://github.com/tulai-design/dada-home.git
cd dada-home
pnpm install --frozen-lockfile
pnpm dev
```

默认开发地址为 `http://localhost:5173`。本仓库 AGENTS.md 对当前维护者的本机 pnpm 绝对路径另有约定；AI 开发工具应先读该文件，不要直接使用其自带的新版本包管理器。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器和同源取数代理 |
| `pnpm exec tsc --noEmit` | TypeScript 检查 |
| `pnpm test` | 代理、工具、主题、应用运行时、存储与同步回归 |
| `pnpm build` | 类型检查、完整扩展 ZIP 和 Web/PWA 生产构建 |
| `pnpm build:extension` | 只构建完整新标签页扩展 |
| `pnpm pack:ext` | 打包独立的网页书签桥 |
| `pnpm preview` | 预览 `dist/`；不启动取数代理 |

当前没有独立的 lint 命令。构建输出 `dist/`、`dist-extension/` 与下载 ZIP；`dist/` 和 `dist-extension/` 不作为源码提交。部署构建、Vercel 与 Docker 的差异见[部署指南](deployment.md)。

## 开发缓存排查

出现 `504 (Outdated Optimize Dep)` 时，停止旧开发服务器，运行 `pnpm dev --force` 重新预构建依赖，再强制刷新页面。只需要重建 Vite 缓存，不要清除应用数据或重装依赖来掩盖缓存问题。

## 测试入口

浏览器内容解析回归可在开发服务器中访问 `/tests/content-regressions.html`，使用真实 DOMParser 检查 RSS / Atom / RDF、错误代理响应及文章上下文。

运行时浏览器回归位于 `/tests/application-layout-regressions.html` 和 `/tests/app-runtime-regressions.html`，检查窄容器布局、设置生命周期、主题热更新与消息来源隔离。脚本使用隔离数据；不要让验收夹具读取或替换真实工作空间。

`pnpm test` 以 `package.json` 为事实来源。其他真实浏览器脚本通过 `DADA_PLAYWRIGHT_PATH` 连接调用方提供的 Playwright，不增加生产依赖。各功能测试入口与覆盖范围见[质量规范](../../.trellis/spec/frontend/quality-guidelines.md)。

## 项目结构与扩展

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/components/` | 应用外壳、页面渲染、设置、对话和其他界面 |
| `src/widgets/` | 内置组件及其注册入口 |
| `src/lib/workspace.ts`、`workspaceStore.ts`、`ops.ts` | 工作空间模型、迁移、状态、编辑操作与撤销重做 |
| `src/lib/registry.ts` | 组件协议、配置描述与校验 |
| `src/lib/applications.ts` | AI 应用目录、分组、打开方式、入口、设置与页面挂载操作 |
| `src/lib/ai.ts`、`tools.ts`、`siteTools.ts`、`lifeTools.ts`、`searchTools.ts` | AI 会话、工具调用与站内操作 |
| `src/lib/applet/`、`src/fx/` | 小程序沙盒与渲染、特效素材库 |
| `src/lib/db.ts`、`storage.ts`、`sync.ts` | IndexedDB、备份与跨设备同步 |
| `browser-extension/`、`extension/` | 完整新标签页扩展、独立网页书签桥 |
| `api/`、`worker/`、`server/`、`docker/` | Vercel Functions、独立 Worker、内置取数代理与容器配置 |
| `tests/content-regressions.html`、`server/*.test.mjs` | 浏览器内容解析回归、生产代理自动测试 |

扩展时遵循以下约定：

1. **统一界面与主题变量**：控件优先使用 Lobe UI，颜色、字体和表面样式遵循主题变量；布局、状态与无障碍要求见 [设计规范](../design-system.md)。
2. **通过协议注册组件**：组件声明类型、名称、配置描述、默认值、渲染入口和可选设置界面，使页面系统与 AI 能发现和使用。新增内置组件时，在 `src/widgets/` 实现并注册，在 `src/lib/workspace.ts` 中补充类型，并加入 `src/widgets/index.ts`。
3. **结构与业务数据分开保存**：页面中的组件实例、顺序和配置可 JSON 序列化；组件业务数据使用独立命名空间，主题和模板可以复用设计而不携带业务数据。
4. **通过工具修改工作空间**：AI 编辑走参数校验与工作空间操作，遵循撤销历史和权限规则；自定义交互工具优先采用 Applet，需要完整自定义视觉时使用沙盒应用。

## 文档与贡献

- [文档中心](../README.md)：长期知识与指南索引。
- [领域术语](../../GLOSSARY.md)：页面、组件、应用、运行形态的统一含义。
- [运行时契约](../specs/runtime-contract.md)：状态、存储与生命周期。
- [AI 工具约定](../../.trellis/spec/ai/tools-and-apps.md)：目录、权限与生成应用边界。
- [任务工作流](../agents/workflow.md)：本仓库采用 Trellis 跟踪任务、上下文和验证证据。

提交问题时建议附浏览器版本、部署方式、复现步骤和脱敏截图。涉及存储问题先导出备份；不要公开 API Key、同步密钥或含私密数据的完整备份。
