# 首页组合与草稿设计

基线：0702e7e。已获开工与每轮本地提交授权；main开发，不推送。三个依赖任务均已归档通过。

## 最小行为缺口与边界

现有分区写入立即提交正式首页，模板套用会替换整套设计，不能用于保留已有应用的试排。新增单一内存草稿，复用现有分区纯操作和一次commit/undo。草稿只编排首页当前组件：sections及规范阅读顺序；不新增/删除组件、不搬其他页内容、不改变配置/外观/主题/图层/壁纸/应用安装或数据。四类是内容编排方向，不是暗中安装功能的整站模板。

预览直接运行真实组件会触发共享业务存储、取数和初始化。采用真实PageView布局+专用无副作用内容投影，明确叫“布局预览”。不挂载业务组件、应用、特效引擎，不读取私有业务值、不发网络；clock/search/links/fx文字可用配置绘制静态表现，其余按类型名称占位。全局主题正常跟随，草稿不提供写正式主题的切换开关；双主题通过真实当前主题验证。壁纸、动态效果、组件内部行为均明确unknown，不能说视觉全部验收。

## 四类组合

homepageRecipes.ts导出HOMEPAGE_RECIPES数组、listHomepageRecipes()和buildHomepageRecipe(workspace,{recipeId,focusId?}): Page，作为单一目录/纯构建器。所有原组件出现且仅出现一次，保留ID/config/span/look；只调用ops.setPageSections。可选focusId必须是本页ID。不猜自编应用用途，不按标题分类。

- minimal：clock/search组成居中hero；links/bookmarks单列快捷区；其余单列。显式focusId则优先作为hero；无核心组件使用首项。空页保持空态。
- productivity：search优先hero；工作内容主栏，clock/weather/calendar/agenda/countdown辅栏，形成2:1 split；不足时将现有links等作为工作内容，不补假待办。未知app/custom保留主栏。无主栏可省略split转section。
- editorial：focusId或首个feeds/note/quote/custom内容优先hero，回落clock/首项；其他阅读/未知内容主栏，搜索/快捷/信息辅栏。主要内容单列，左对齐。
- showcase：focusId或首个fx/custom/app/applet优先hero，回落clock/首项；其余两列；没有视觉内容时不凭空添加WebGL。

目录披露每种顺序、适用内容、空态、主题、窄容器和效果保留规则。生成默认不增加冗余分区标题。

## 草稿模块与公共接口

homepageDraft.ts管理唯一内存草稿，使用useSyncExternalStore订阅。草稿不进入storage、template库、history；刷新即丢弃。使用snapshotOf的复制边界取首页基线，不把整个模板apply回去。

类型HomepageDraft {id,recipeId,revision,basePage,page}；revision从1开始每次成功修正+1。

导出：
- getHomepageDraft(): HomepageDraft|null、subscribeHomepageDraft(listener)、useHomepageDraft()
- createHomepageDraft({recipeId,focusId?}): HomepageDraft；已有草稿报错，不静默覆盖。
- updateHomepageDraft({draftId,expectedRevision,sections})，或同一入口{draftId,expectedRevision,recipeId,focusId?}重新选择方向。两类输入互斥且至少一种；focusId仅与recipeId一起使用。重新选择方向始终从basePage的原始内容顺序生成，避免来回切方案产生顺序漂移；sections手工调整基于当前草稿。所有形状、ID和revision均严格检查，失败不改草稿或正式状态。
- applyHomepageDraft({draftId,expectedRevision})：核对ID/revision，当前home与basePage语义快照一致才允许。只将sections及其顺序应用到最新workspace，保留其他页/主题/设置/安装变化。复用ops.setPageSections再一次commit，成功才清草稿；冲突保留草稿并说明需取消后重新生成，不提供force覆盖。
- discardHomepageDraft({draftId})：匹配ID后清草稿，无commit。
- getHomepageDraftWorkspace(): Workspace|null：以当前正式workspace为基础替换草稿home，按正式workspace对象+草稿对象缓存稳定引用，用于渲染与stale检查。
- describeHomepageDraft(): JSON可序列化摘要|null：id/recipeId/revision、sections/effectiveOrder、组件ID/type/title（不读业务数据）、conflict、layout-only限制。

同ID不代表同一版本，update/apply要求expectedRevision；UI传当前版本，工具必须读取返回的revision。正式首页冲突拦截覆盖；不相关页/全局明暗修改允许合并。草稿应用一次撤销恢复正式旧首页，重做不恢复草稿。

## UI 与检查

App订阅草稿，canvas中显示独立布局预览面板，AI聊天仍可用。保留原页面挂载及输入实例，面板覆盖它并使其不可交互/不可被测为可见，不把双份业务组件装进去。面板header有方向选择、检查、应用、取消；必要的一句“布局预览，应用与实时内容为静态表示”。遵循现有纸张主题、紧凑控件，无默认大圆角/卡片墙。命令面板提供“预览首页方案”入口，创建minimal后可切换方向；AI创建也立即可见。不依赖改变导航状态展示。

PageView新增可选renderPreview(instance,label)内容slot，真实widget容器/分区算法共用；preview不渲染WidgetBoundary删除按钮等业务交互。look.css的selector加唯一data-page-style前缀，避免正式/草稿同ID相互污染。预览不执行未经sanitizeCss通过的历史样式。preview根有data-homepage-draft=<id>及data-page-id=home。

独立inspect_homepage_draft({draftId})经ToolHost.inspectHomepageDraft转发。homepageDraftInspection.ts复用createPageInspectionHost/inspectPageElement及有界等待；MountedInspectionPage可带draftId，PageInspectionMetadata转发draftId为安全限定selector。正式inspect_page语义不变。草稿报告带target:{kind:'homepage-draft',id,revision}、layout-only覆盖说明和每个组件静态/占位未知项，不读文本或私有值。ID不存在、面板没挂载、DOM与最新草稿不同、取消/超时均明确不可测；等待后再核对草稿对象与revision，不能把旧测量标成新版本。

## AI 工具

list_homepage_recipes、create_homepage_draft、get_homepage_draft、update_homepage_draft、inspect_homepage_draft、apply_homepage_draft、discard_homepage_draft。显式工具不改写已有set_page_sections/apply_template的正式语义。apply为highRisk，复用现有审批；用户也可直接点应用按钮。其他草稿操作只修改临时草稿，无正式提交。

提示词/技能/设计规范说明：改版先读现状→选组合→创建草稿→测量→草稿内修正→复查→用户确认后应用。预览阶段不调用正式写工具替代草稿更新。新增/删除内容或改全局主题是单独的明确需求，不伪称已包含在布局草稿中。

## 文件与职责/测试

- 数据worker：homepageRecipes.ts、homepageDraft.ts、test-homepage-draft.mjs；真实公开生命周期/ops/store/history与快照行为。
- 渲染worker：HomepageDraftPreview.tsx、HomepageDraftContent.tsx、PageView.tsx、App.tsx、homepage-draft.css、page-sections.css（时钟实际窄列字号）、main.tsx、隔离fixture与browser脚本；真实DOM和副作用隔离。
- 工具worker：homepageDraftTools.ts（供tools.ts注册，避免tools继续膨胀）、tools.ts、ai.ts、skills.ts、homepageDraftInspection.ts、pageInspectionHost.ts、pageInspector.ts、新tool测试。
- 主会话：任务/规范/术语/产品文档、package测试链、旧测试loader兼容、集成验证和提交。

公共测试接口沿用已批准的工具parse/execute、workspace操作/history以及真实组件浏览器；按红→绿纵向推进。覆盖四类内容分配/空页/未知组件、草稿无正式提交、缺字段/旧revision/冲突原子拒绝、取消无写、应用合并其他变化/一次undo/redo、ID和数据保留。浏览器4宽×2主题、实际窄分栏、键盘、静态预览无存储/网络/初始化、同ID CSS隔离、检查/修正/应用/撤销完整路径。记录有限覆盖，不声称审美和任意App内部通过。

范围外：任意组件源码或业务数据编辑、全站草稿事务、持久草稿库、自动新内容/安装、主题编辑器、公开发布、新依赖。
