# 移动端长页底部遮挡验收

日期：2026-10-27。基线：5f4a0c3。

## 问题与根因

用户截图显示约492px宽、包含主视觉/待办/日程/链接分区的首页，末尾链接伸到移动Dock后。仅从`.page`是flex子项判断布局正常不足以证明内容可访问。

独立真实App探针和实现代理各自复现，后者使用更贴近截图的clock/search/todos/agenda/links布局。492×636视口，page高588、两层特效包装各高506；page虽有82px底部padding，长内容溢出固定高度包装后，滚动范围没有保留真实内容末尾的这82px。

实现代理的修复前后测量：

| 测量 | 修复前 | 修复后 |
| --- | ---: | ---: |
| scrollHeight | 933 | 1015 |
| 滚到底后的链接底边 | 588.36px | 506.36px |
| Dock顶边 | 566px | 566px |
| 内容与Dock间距 | 遮挡22.36px | 留白59.64px |

最小实验另证实：仅给page加flex-column并禁止子包装收缩，仍然遮挡。不是flex:1失效，而是自然内容高度没有贯通祖先包装。真实App行高等于组件实际内容高，没有证据将截图所有空白都归为Grid多余拉伸。

## 修复边界

修改FxLayers：非空sections页面的外包装和ClickSpark包装共用height:auto/min-height:100%，沿用ClickSpark既有style覆盖入口。保留原React父链、key与组件实例；旧单屏页仍height:100%。没有改全局page的display、vendor、主题、分区配置、业务数据或Dock高度。

768px矩阵额外发现既有外壳断点冲突：styles.css的max980把app改为自然高度/纵向排列，Dock却到760px才改为底栏，导致中间区间页面落在视口外。恢复旧包装height100%仍量得page bottom1318.56、links bottom1270.56，超出636px视口，证实为基线问题。最小删除max980内body/app/canvas三个遗留覆盖，保留该区间其他组件规则，使外壳与Dock统一沿用760px断点。

## 已执行检查

- 本机pnpm `exec tsc --noEmit`：通过。
- 本机pnpm `test`：完整回归通过。
- 真实App复现和临时样式对照：两位代理独立完成，根因和82px滚动范围差值一致。
- 主会话已查看修复前与临时验证截图：`/tmp/dada-page-mobile-before.png`、`/tmp/dada-page-mobile-probe-fixed.png`，修复后尾部标签可见。

新增`scripts/test-page-mobile-scroll-browser.mjs`完整通过：真实App加载、独立BrowserContext、拦截外部请求，未连接用户浏览器或写其存储。结构化长页覆盖320/375/492/768/1440和760/761/980/981边界、深浅两主题；每次滚到底断言页面在视口内、无横溢、最后链接完整可见且底边elementFromPoint命中链接。旧三块首页和组件市场覆盖同样9宽的实际可达/命中。另覆盖522px实际AI窄栏、320/492/1440草稿、todos未提交输入与DOM跨resize/theme/sections往返/草稿取消保持，无浏览器异常。

正式补丁截图`/tmp/dada-page-mobile-after.png`已经主会话查看，测量与临时对照一致；完整日志`/tmp/dada-page-scroll-tests.log`。同一回归脚本的临时副本仅在492场景恢复旧两层height100%，实际失败“末尾内容被遮挡”，链接底边坐标(332,586.36)命中Dock的“搭搭AI”按钮而非链接；红灯日志`/tmp/dada-page-scroll-red.log`。

Spec代理独立真实App复查非临时补丁的492×636场景，得到约60px净空。Standards与Spec首次审查均0发现，新增断点修复的增量复查也均0发现；完整浏览器矩阵由实现代理执行，审查者核对其断言和隔离，不把源码审查写成重复执行证据。

没有依赖、打包配置或资源变更，本轮不重复上轮已通过的build；项目无独立lint命令。检查不等于任意第三方应用内部的滚动或全部自定义主题都通过。

## 防止复发

补充page-layouts与quality-guidelines：Dock可访问性必须验证完整App宿主链路，滚到底检查末尾内容矩形和命中。单独PageView夹具、存在滚动条或检查器未报告祖先裁切，不能证明兄弟浮层没有遮挡。

修复提交：`2f78a16`（main，本地提交）。
