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

目标：为用户做出有个性、能直接用的小组件或小页面，避开千篇一律的「AI 味」。在这里，成品通常是 create_app 写的沙盒应用，也可能是声明式组件、特效素材的组合。

## 先想清楚再写
- 用途：它解决什么问题，谁、在什么场景用，一眼要看到什么。信息不够就先问一两个关键问题（或用 grill-me 的方式追问），别猜。
- 方向：挑一个明确的审美方向并贯彻到底，例如 编辑部杂志、克制极简、复古未来、工业实用、柔和纸感、粗野主义。主页默认是「米白纸张、墨色文字、红色点缀」的编辑部气质，新组件默认与它协调；用户想要反差再另说。
- 记住点：这个组件让人记住的那一个细节是什么（一个巧妙的交互、一个大号数字、一处动效）。

## 在搭搭里怎么落地
- 先走低档位：list_component_types 和 list_effects 能解决的，就别写代码。素材库放得下的标题、背景、卡片光效直接用。
- 要自己写时用 create_app（html、css、js 三段）。它在隔离沙盒里运行，读不到主页数据；颜色、字体用主页注入的变量：var(--bg) var(--text) var(--text2) var(--text3) var(--border) var(--main) 以及 var(--font-serif) var(--font-sans) var(--font-mono)。这样自动适配深浅色，也和主页一致。
- 背景保持透明，别给 body 设固定底色，让纸张底色透出来。
- 需要特别字体时，沙盒允许从 Google Fonts 引入（css 里 @import url('https://fonts.googleapis.com/...')）。选有性格的字体，成对搭配：一个展示字体加一个正文字体；避开 Arial、Inter、Roboto 这类默认字体。中文内容优先考虑 Noto Serif SC、Noto Sans SC、ZCOOL 系列。
- 动效：优先纯 CSS；一次编排好的入场（错开的 animation-delay）比到处散落的小动画更有质感。需要库时 import 自 esm.sh（例如 gsap、three）。尊重 prefers-reduced-motion。
- 数据：window.tada.store 存本组件私有状态，window.tada.fetch 取已授权域名的数据，window.tada.ask 可以把一句话发回搭搭。

## 审美准则
- 排版：层级分明，字号反差要大；行距和字距认真调。
- 色彩：一个主导色加一个锐利的强调色，比平均分配的多色更有力量。用 CSS 变量统一管理。
- 构图：留白要大方，或者密度要克制得有意图；可以不对称、叠压、打破网格，但对齐要准。
- 细节：纹理、细线、阴影、噪点、渐变网格这类细节制造氛围，别只用纯色块。
- 避开：紫色渐变配白底、千篇一律的卡片列表、无意义的圆角阴影堆叠、满屏表情符号。

## 交付前自检
1. 在半宽和整宽两种宽度下都不会溢出（组件宽度由页面决定，别写死像素宽）。
2. 浅色和深色都清楚可读，对比度够。
3. 没有写死的底色，没有外部图片（图片只能来自 data:/blob:、images.unsplash.com 和已授权域名）。
4. 交互有反馈：悬停、按下、空状态、出错状态都想过。
5. 代码在脑子里走一遍，出错用户只会看到空白，所以关键路径要稳。
6. 交付后用一两句话说明设计思路和怎么改（颜色在哪、文案在哪），再问用户要不要调整。`

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
    when: '只要你要新建或改动任何组件、页面版式、沙盒应用（create_app / create_widget / add_component / 调整布局和样式）之前，必须先读这份。它规定了控件怎么选、颜色间距字号怎么用、舞台型组件如何居中、状态怎么做、交付前怎么自检。',
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
    when: '用户要做新组件、小工具、小页面、海报式的展示，或想把某块界面做得更好看、更有设计感时（几乎总是配合 create_app 或特效素材）。',
    body: FRONTEND_DESIGN,
  },
]

export const findSkill = (id: string): Skill | undefined => SKILLS.find((skill) => skill.id === id.trim().toLowerCase())

/** 系统提示里的技能目录。 */
export function skillIndex(): string {
  return SKILLS.map((skill) => `- ${skill.id}（${skill.name}）：${skill.when}`).join('\n')
}
