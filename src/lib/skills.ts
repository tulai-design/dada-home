/**
 * 内置技能（Skill）。
 *
 * 技能是一段「怎么做某类事」的方法说明。不把它们都塞进每次的系统提示里（太长、多数时候用不上），
 * 提示里只放目录，模型判断当前任务需要哪个，再用 use_skill 取全文，照着做。
 */
export type Skill = {
  id: string
  name: string
  /** 一句话：它是什么、什么时候该用。会出现在系统提示里。 */
  when: string
  /** 全文，use_skill 返回给模型。 */
  body: string
}

const GRILL_ME = `# 技能：拷问（grill-me）

目标：把用户一个还模糊的计划、设计或想法，通过追问聊到双方都清楚为止，而不是直接动手。

怎么做：
1. 先用一两句话复述你理解的计划，让用户确认方向没跑偏。
2. 把这个计划拆成一棵决策树：目标 → 范围 → 关键取舍 → 细节。先问上游的，上游定了再问依赖它的下游。
3. 一次只问一个问题。每个问题都带上你的推荐答案和一句理由，用户可以只回「就这样」。
4. 能自己查到答案的不要问。关于现有页面、组件、书签、订阅、主题、模板的事，先用 get_workspace、list_* 之类的工具去看，看完再决定要不要问。
5. 抓住含糊的词（「简洁一点」「常用的」「重要的」），让用户给出具体的例子或标准。
6. 发现前后矛盾或会连带影响别处时，直接指出来，让用户选。
7. 用户说「够了」「就这样」或所有分支都有结论时停止追问。最后给一份简短的结论：做什么、不做什么、关键决定、接下来的步骤；然后问用户要不要现在就动手，别没问就改。

语气：直接、有判断，像一个认真的搭档，不要客套，也不要一口气抛一大串问题。`

const FRONTEND_DESIGN = `# 技能：前端设计（frontend-design）

目标：做出能直接使用、与主页协调的小组件或小页面。普通交互工具首选 create_applet；静态展示用声明式组件或特效素材。只有游戏、Canvas/WebGL 或必须完全自定义视觉时才用 create_app。

## 先想清楚再写
- 用途：先确定用户要完成的操作与最重要的结果；能从现有数据和需求判断的直接做，只有缺少关键条件时才提问。
- 方向：默认沿用主页的编辑部风格，纸张底色、墨色文字、克制的强调色。用户明确指定其他风格时再调整。
- 焦点：突出一个结果或主操作，其余信息让位。文案只保留完成操作所需的名称、标签、单位与错误说明。

## 在搭搭里怎么落地
- 先走低档位：list_component_types 和 list_effects 能解决的，就别写代码。素材库放得下的标题、背景、卡片光效直接用。
- 首页整体改版先 get_workspace → list_homepage_recipes → create_homepage_draft。四类组合只安排已有首页内容，不新增/删除组件、不安装功能、不改主题/壁纸/特效或其他页面。用 get_homepage_draft 取当前 draftId/revision，update_homepage_draft 调整分区或切换组合；预览阶段不用正式写工具替代。
- 草稿是内存中的静态布局预览：不运行应用/实时业务/壁纸/动态效果，不读取私有数据。inspect_homepage_draft 只测当前预览容器与静态外框，报告标明草稿版本和未知范围；修正后重新检查，不能声称应用内部或全部尺寸、两种主题与审美通过。用户确认后 apply_homepage_draft 一次应用可撤销；取消用 discard_homepage_draft，刷新丢弃草稿。旧版本或正式首页冲突先说明，不能偷偷覆盖。
- 直接修改正式页面的局部分区时，先 get_workspace 读取现有组件 ID、sections、effectiveOrder 与 ungrouped，再 list_page_layouts 取受控布局目录。set_page_sections 引用本页已有组件，用 hero 承载主视觉、section 组织1–3列内容、split 安排主次栏；不为改布局新建应用或复制组件。这三种是布局结构，不是 add_component 的类型。
- 分区最多8个、hero最多1个；id用1–48位ASCII字母/数字/下划线/短横线，标题可省略且最多80字。一个组件在全页只引用一次；分区有序展开，split先primary后secondary，未分组项最后。分区及槽位决定已分组组件的位置，未分组项沿用原span；实际内容容器小于720px时全部按阅读顺序单列。空分区不显示空标题。先安排真实内容与主操作，再决定是否需要特效，不能用空标题或装饰填满分区。
- set_page_sections 会整体替换分区，保留仍需要的分区一起传回；null或[]只清除结构，保留当前组件顺序、配置与数据。新增/移动组件时index按有效顺序插在目标组件的槽位内，末尾默认未分组；move先移除旧项再定位。要把新内容并入某区可再次set_page_sections，不必重建页面。
- 自写交互工具先 use_skill applet，按真实积木目录写 create_applet；不用 HTML/CSS，布局与控件由宿主渲染。先 use_skill design-system 读取主页规范。
- create_app 只用于上述需要自定义视觉的场景，写 html、css、js 三段。它在隔离沙盒里运行，读不到主页数据；颜色、字体用主页变量：var(--bg) var(--text) var(--text2) var(--text3) var(--border) var(--main) 和 var(--font-serif) var(--font-sans) var(--font-mono)，圆角用 var(--radius) / var(--radius-lg)。背景透明，不给 body 设固定底色；浅色、深色都要可读。
- 自定义字体、CSS 动效仅适用于 app；默认沿用主页字体，不额外引字体或装饰库。必要动效尊重 prefers-reduced-motion。
- 数据：Applet 用 persist、ctx.fetch、ctx.ask；App 用 tada.store、tada.fetch、tada.ask。网络域名需要用户授权，设置值与业务数据分开保存。两类应用业务 JSON 统一存入 IndexedDB，每实例 8 MiB UTF-8 预算；App 必须 await tada.store.set 并处理失败，Applet 由宿主确认 persist 落盘，不能提前提示已保存。
- 安装和入口：create_app / create_applet 默认安装到组件市场，不自动建页面、不把每个应用放进 Dock。用 group 分组、openMode 选择弹窗/抽屉/全页面；用户确有需要再固定 dock/status 入口或给 pageId 挂页面小组件。入口管理用 configure_application，用户设置用 settingsSchema 定义并在应用读取 tada.settings / ctx.settings；运行形态为 tada.surface / ctx.surface。
- 五种运行形态是 widget、modal、drawer、page、status。modal 桌面由宿主提供可拖动窗口与交通灯，支持最小化和最大化；不要在应用里重复绘制窗口按钮或打开方式选项。最小化仍保留当前运行实例，关闭或切换形态则可能重新挂载。应用设置从组件市场或系统设置进入。按容器宽度排版，不能把弹窗或小组件当成全浏览器窗口。Applet 用 ctx.viewport.width / ctx.viewport.compact（容器小于 480px）切换布局；Grid 默认按容器收列，只有计算器键盘等需要固定网格时才用 responsive:false。App 按 iframe 宽度写响应式 CSS，避免固定宽度与 100vw 导致横向溢出。
- 顶部状态栏：statusMode 默认 launcher 为启动入口；用户需要真实紧凑形态时，先在源码实现 surface === "status" 的分支，再配置 status:true,statusMode:"compact"。只留一行数字、图标或核心状态，不放标题、整页表单、大按钮。高度 32px；Applet 桌面最大宽 200px、手机 140px；App 桌面宽 160px、手机 130px。主窗口或可见小组件运行时宿主自动回退入口，避免同应用并发写状态。
- 设置更新：Applet 的 init 只在启动时执行；设置副作用用 onSettingsChange(s,ctx,previous) 重新设置定时器或数据源，先取消旧任务。App 设置变化会安全重载，tada.store 保留。切换形态也可能重新挂载；定时、请求只在挂载的运行形态中存在，没有任何运行形态后不会后台常驻，计时器应保存截止时间。

## 审美准则
- 排版：一处焦点、两级辅助信息，按规范使用字号、间距和对齐。
- 色彩：沿用主题变量，强调色只突出当前焦点；不用固定的白底黑字锁住深浅色。
- 列表：靠对齐和间距分组，不给每行加上边框；只在确有必要时分隔大区块。
- 装饰：不用大圆角卡片、层层边框、渐变和阴影堆叠；不加口号、重复标题、操作说明或满屏表情符号。

## 交付前自检
1. 核对源码适配了实际开启的形态；手机 320–375px、半宽小组件、抽屉和弹窗都按各自容器布局，横向控件必要时换行或纵排。
2. 核对浅色和深色的变量、对比度、键盘操作、空/加载/错误反馈；图片仅来自 data:/blob:、images.unsplash.com 和已授权域名。
3. 核对设置确实被逻辑使用，修改后副作用能更新；持久数据、设置、临时 UI 状态各用对应机制。
4. 应用创建或更新后用 list_applications 核对源码、分组、设置与入口，再按用户需要 open_application。页面编排后用 get_workspace 核对分区、阅读顺序与未分组项；inspect_page 可测当前挂载页面的宿主容器和组件外框，修改后可复查。独立应用窗口或 iframe 内部、Canvas 内容、对比度和审美不在测量范围。报告 unknown / unavailable 不能当成通过；没有截图反馈，不能声称已亲眼检查页面或完成视觉验收。
5. 用一两句话说明结果、入口和必要限制，不重复介绍界面上已有的标签。`

/** 设计规范的原文放在 docs/design-system.md：人、写代码的 AI、搭搭自己读的是同一份。 */
import DESIGN_SYSTEM from '../../docs/design-system.md?raw'
import {appletGuide} from './applet/catalog'

export const SKILLS: Skill[] = [
  {
    id: 'applet',
    name: '小程序',
    when: '要用 create_applet / update_applet 做有交互的小工具之前，必须先读这份：它有完整的积木目录、写法、ctx 能力和设计要求。',
    body: appletGuide(),
  },
  {
    id: 'design-system',
    name: '设计规范',
    when: '新建或改动任何组件、页面版式、应用（create_applet / create_app / create_widget / add_component / 调整布局和样式）之前，必须先读这份。它规定控件、主题、间距、文案、容器响应式与交付核对要求。',
    body: DESIGN_SYSTEM,
  },
  {
    id: 'grill-me',
    name: '拷问',
    when: '用户想把一个计划、设计或想法想透，或说「拷问我」「帮我想清楚」「压力测试一下这个方案」「grill me」时。一次一问、带推荐答案，直到双方理解一致。',
    body: GRILL_ME,
  },
  {
    id: 'frontend-design',
    name: '前端设计',
    when: '用户要做新组件、交互工具、小页面，或调整界面设计时。普通工具首选 create_applet；完整自定义视觉才用 create_app，静态展示先考虑现成组件和特效素材。',
    body: FRONTEND_DESIGN,
  },
]

export const findSkill = (id: string): Skill | undefined => SKILLS.find((skill) => skill.id === id.trim().toLowerCase())

/** 系统提示里的技能目录。 */
export function skillIndex(): string {
  return SKILLS.map((skill) => `- ${skill.id}（${skill.name}）：${skill.when}`).join('\n')
}
