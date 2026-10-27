# 首页草稿与布局预览

## 状态与应用

首页组合只组织当前home的既有组件。homepageRecipes.ts集中四类规则，复用ops.setPageSections；禁止调用applyTemplate/defaultWorkspace/instanceId重建组件或暗中安装addon。草稿只含首页布局变更，组件config/look/span、背景、主题、安装记录和业务数据保持。

homepageDraft.ts集中唯一内存草稿与订阅；create/update/discard不得commit正式workspace、写storage或新建模板。显式draftId避免过期会话命中另一草稿，expectedRevision避免旧响应覆盖新调整。更新失败保持原草稿，创建不能静默替换已有草稿。

应用前比较正式home和建立时快照；冲突拒绝并保留草稿。不提供force选项，不用整份旧workspace覆盖当前状态。只把草稿sections写到最新workspace，一次commit进入原有undo/redo；其他页、主题、应用设置等无关变化保留。预览工作空间的对象引用按正式workspace+草稿缓存，以便检查宿主识别DOM是否陈旧。

## 渲染隔离

no-op host、禁用按钮或inert不能阻止业务组件自身useEffect/store/fetch。预览必须在调用真实definition.component之前分支，使用专用纯展示内容；App/Applet、业务组件、取数和特效引擎均不启动。预览不读取私有数据，以配置静态表示或类型占位清楚披露。

共用PageView真实widget容器、布局计划和CSS；正式页保留挂载和原输入状态，预览期间不可交互或被误当成可见页检查。预览不提供删除/更新组件的真实回调。相同组件ID可能同时存在于正式与预览DOM，look.css必须限定data-page-style；预览历史CSS经sanitizeCss校验，不信任历史值绕开限制。

主题跟随当前宿主，不能只改wrapper的data-theme而声称组件读取了另一主题。原Fx主题读取documentElement，预览不得复制一套独立主题状态或启动背景portal。手机工具栏换行，实际内容宽度仍由PageView容器查询处理。

## 检查与证据

正式inspect_page与inspect_homepage_draft分开，后者复用有界等待与几何算法。根注册携带draftId和workspace/revision，报告target区分草稿，selector带data-homepage-draft限制。等待后再次核对草稿ID/revision；不存在/取消/未挂载/陈旧渲染必须不可测，禁止将旧报告标成新版本。

检查不读text/value/storage/iframe；报告保留layout-only及静态/占位unknown，不能把空issues解释成真实应用内部或整页视觉通过。测试覆盖版本与冲突、零提交取消、单次应用撤销、同ID CSS隔离、无第二份业务副作用、真实容器与双主题、生成→检查→修正→应用→撤销。长期取舍见 [草稿隔离决策](../../../docs/decisions/0003-homepage-draft-isolation.md)。
