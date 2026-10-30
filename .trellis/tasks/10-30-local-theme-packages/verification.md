# 本地声明式主题包验收

日期：2026-10-30。基线 `7fa143a`，main；用户已授权按 A3 顺序开发并每轮检查后本地提交。本地主题包与 A3 跨阶段集成已验收。

## 已实现行为

- 一个 `.dada-theme.json` 同时携带 manifest、完整设计和可选 WOFF2。严格身份、不可变精确版本、规范 SHA-256、文件/设计/资源/安装库预算；同版本异摘要不覆盖。安装保存为停用，启用前实际 FontFace 解码，选择贡献才提交主题。
- 统一 requested/availability/effectiveFonts 解析，缺包、停用、未知合同/schema 保留合法设计与精确引用，实际 paper/standard 与系统字体回退。可恢复原个人变体，不把回退写回主题。
- 本地字体通过 document FontFace(ArrayBuffer) lease，无字体 URL/外链；同资源多文字角色保留，物理加载共享。准备不修改当前 CSS family，旧请求、取消和资源状态变化不迟到激活。
- 引用保护涵盖主题、模板与内存作者草稿。原包导出保持身份；完整个人方案导出生成新包身份并含所需资源。远端默认字体或缺资源明确拒绝不完整导出。
- DB7 专仓、备份4、恢复日志5；保存屏障覆盖从调用开始的包写入。完整备份带字节且恢复停用，原状态回滚保留 enabled；三种同步仅设计与精确引用，不分发 bytes 或启用状态。
- 设置 UI 与现有作者工具共用领域合同；没有新增在线市场、下载工具、第三方执行 runner 或设备授权。运行时文档仍单一正文。

## 测试与红绿证据

- 未知 renderer 在基线真实主题入口被拒绝的 red 已转 green；包领域/事务最终 17 组，含不可变冲突、预算、hash、未知 envelope、安装屏障、取消、草稿引用、卸载重装 ABA 与同名未来 renderer 合同。
- 字体角色丢失由真实 saveTheme/readThemes/模板/migrate/apply 回归复现后修复；身份18、字体14组通过，普通主题22、作者16、工具20、外观13组通过。
- 独立资源协议12、原预览17组通过。保存27、持久化18、容量3组通过；新增真实 IDB + WOFF2 浏览器4组（font-src none仍可ArrayBuffer加载、备份字节、坏hash零写、restore disabled）。
- 模板、配置/full快照和增量同步往返缺包/未知设计；增量9、快照记录14组通过，bytes/启用状态既不出站也不改变同步采样指纹。
- `test-theme-packages.mjs` 与 `test-theme-package-preview.mjs` 已加入主 test；真实浏览器脚本单独执行，不读取真实用户资料。
- 首轮全量 test/build 通过；最终修复后的全量检查和静态产物矩阵记录于下方完成栏。浏览器详情见 [browser-validation.md](browser-validation.md)。

## 独立双轴审查

Standards：4 项已修并独立复验，当前无未解决项：严格普通 JSON 往返、个人变体后续编辑入口、资源协议共享边界、AbortError 不污染保存屏障。审查覆盖 `git diff 7fa143a` 与未跟踪文件，无 lint 命令。

最后追加预览即时草稿身份护栏，防止 patch 后 React effect 尚未清理时转发旧字体；真实 deferred 协议回归通过，随后重新全构建。

Spec：已修同一字体多角色读取丢失、同名未来 renderer 合同被旧目录误删；另主审补启用准备期间卸载重装的旧请求失效。独立真实 probe、tsc、领域与协议回归均复核通过，0 项未解决。

## 最终完成栏

- TypeScript：最后一次全构建中的 `tsc --noEmit` 通过。
- 全量 test：最后一次 `pnpm test` exit 0，日志 `/tmp/dada-local-theme-full-test-final.log`。
- Web/MV3/下载ZIP构建：全构建 exit 0，日志 `/tmp/dada-local-theme-build-final.log`；第三方 PURE 注释与大 chunk 提示不影响成功，未改变构建警告阈值。
- 静态 PWA 离线22/22、真实 MV3 21/21、Win98 包跨壳生命周期8/8，资源存储浏览器4/4。最后原始请求身份加严后重新构建，并追加 PWA 预览6/6、MV3预览5/5。详见 browser-validation。
- 文档本地引用217项有效；父子 Trellis validate 通过，diff check 通过；归档后再次检查路径。

## 边界

本地热装已有宿主支持的数据主题已经实现；在线分发、审核、账户与第三方可执行插件仍未实现。所有同步都不分发主题字体，完整备份才包含资源；完整备份其他本机配置仍沿既有恢复规则，包自身不携带权限。浏览器验证是隔离样例与有限设备尺寸，不宣称自动完成所有应用内部或审美验收。不推送、不发布、不自动清用户数据。
