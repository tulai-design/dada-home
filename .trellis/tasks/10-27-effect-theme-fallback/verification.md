# 双主题特效与失败恢复验收

日期：2026-10-27；基线41ce919。结论：实现、检查与两轴复核通过。

## 已交付

- params.palette='theme'使用宿主语义色；light/dark仅接受本效果颜色字段，按普通参数→语义色→当前模式分支解析。普通参数更新保留配色，分支整体替换，null清除对应控制字段。
- 图层、外层文字/横幅、vendor及静态正文使用同一解析结果。同模式修改主题变量也更新；未启用新配色的旧固定色保持原合同。
- 11种WebGL背景报告实际上下文不可用和已识别shader/program失败。宿主捕获context loss与组件加载/render失败，卸载装饰并保留正文；重试和配置切换可恢复，业务输入不重建。
- 图层重试在aria-hidden外的页面Popover；内容块就地重试。浏览器原生模块失败缓存无法靠新React.lazy清除时明确提示刷新。
- AI目录和设计规范披露参数、优先级、兼容与边界；没有增加生产依赖。

## 自动检查

使用用户指定的本机pnpm；build子进程PATH也优先本机版本。

| 检查 | 结果 |
| --- | --- |
| exec tsc --noEmit | 通过；build也再次执行 |
| pnpm test | 全套通过；新配色8/8、既有策略18/18 |
| pnpm build | 通过；保留既有大chunk警告 |
| git diff --check | 通过 |
| 可重复真实浏览器脚本 | 31/31通过 |

TDD：先用真实ops.addComponent验证新palette字段，原代码返回undefined而非theme；接入规范化后变绿，再覆盖图层、分支限制、解析、旧数据、模板、迁移、撤销与不可变。

浏览器脚本为scripts/test-effect-theme-browser.mjs，使用独立内存fixture，不读用户工作空间。提供外部Playwright工具路径后运行：

```sh
DADA_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.js node scripts/test-effect-theme-browser.mjs
```

默认开发服务http://127.0.0.1:5175，可用DADA_QA_URL指定其他地址；脚本不安装依赖，finally关闭浏览器。

## 真实浏览器覆盖

可重复31项覆盖：三类真实组件SplitText/GlareHover/Waves的浅深模式、同模式修改、显式分支及业务状态；11个背景分别拒绝getContext；11个背景分别拒绝实际LINK_STATUS；恢复API重试、原生WEBGL_lose_context重试、lazy网络失败、减少动画配色、RotatingText高亮文字及图层可访问重试。

本轮另执行44条会话断言，包含上述范围并补充：

- 旧Waves lineColor='rgb(27,23,20)'在暗模式保持深线。真实canvas截图像素最小平均RGB23.33、深色像素1065，确认未被转为浅墨。
- Spline真实场景网络请求失败后保留横幅文字与重试。
- 320px容器和390px触屏卡片无横向溢出，静态卡片保留暗色分支与完整正文。
- 实际查看深色卡片截图；静态背景保留指定底色与对应文字色。

故障注入发生在浏览器网络/WebGL API边界，使用真实vendor，未mock renderer。静态替代是安全结果而非原效果截图；未逐个检查26项全部视觉参数，未测FPS、耗电或自动对比度。任意第三方RAF/事件回调异常不在全局拦截范围；未验证真实远程Spline场景全部交互。

## Standards轴

初审3项均修复并独立复核通过：

1. 卡片失败重试被固定高度裁剪：flex分配正文和错误区，浏览器验证按钮位于可视高度内。
2. 旧RGB/HSL先转hex会误触发legacy墨色替换：只转换新覆盖字段或不支持HSL的LiquidChrome，旧字符串身份保留；像素回归验证。
3. 静态背景丢掉显式配对底色：保留resolved.backgroundColor，与文字配色共同降级。

## Spec轴

初审1项已修复并独立复核通过：高亮轮播词忽略新显式文字色。views仅为新覆盖字段传style.color，vendor优先使用它，旧自动选色行为保留；真实高亮span暗色计算值验证通过。

## 后续

本任务只完成配色与失败恢复。下一项为page-inspector：让应用内AI得到可核对的页面检查结果；当前仍不能声称AI已经具备截图观察、自动对比度或性能测量能力。
