# Hooks 与运行时生命周期

[hooks.ts](../../../src/hooks.ts) 的 `useNow`、`useInterval`、`useHotkeys` 展示现有做法：定时器、监听成对注册/清理，回调更新与订阅寿命分离。新增监听、Observer、请求和渲染循环时必须确认卸载路径，适配入口的 React StrictMode。

容器尺寸从实际元素测量。[widgets/applet.tsx](../../../src/widgets/applet.tsx) 将宽度送入 Applet 上下文；[applet/render.tsx](../../../src/lib/applet/render.tsx) 按布局容器调整网格。尺寸变化只更新布局，不重新运行应用初始化或重置业务状态。

Applet 的 `init`、`onSettingsChange` 与纯 `view` 有不同职责，见 [runner.ts](../../../src/lib/applet/runner.ts)：

- `init` 在启动时执行；设置变化不重跑它。
- `view` 生成积木树，不启动请求、定时器或订阅。
- `onSettingsChange` 在初始化完成后处理实际设置变化，先释放依赖旧设置的任务。
- 使用运行时提供的计时器能力并释放旧任务；倒计时持久化截止时间，不能依赖卸载后的后台轮询。

特效中已有离屏、页面可见性和减少动画处理，例如 [Aurora.tsx](../../../src/fx/vendor/Aurora.tsx)、[Waves.tsx](../../../src/fx/vendor/Waves.tsx)。修改特效时检查相关处理仍能触发，不能因重构丢掉资源释放。
