# 页面分区设计

基线：3cc7321。范围与开工已有用户授权；沿用main开发，每轮验收后本地提交。

## 行为缺口与最小边界

目前Page只有扁平栅格，AI不能声明主视觉、分区或主辅关系。新增一层可选sections，引用已有组件ID；组件实体、配置、业务数据和应用安装记录仍使用现有唯一来源。旧页没有sections时走原舞台/栅格/首页居中布局。

## 数据合同

WORKSPACE_VERSION由5升到6；不为旧页自动建立分区。Page.sections?: PageSection[]，最多8区，id为1–48位ASCII字母/数字/下划线/短横线，全页唯一；title可选、最多80字，不默认生成口号或重复说明。

```ts
type PageSection =
 | {id: string; kind: 'hero'; title?: string; items: string[]; align?: 'start' | 'center'}
 | {id: string; kind: 'section'; title?: string; items: string[]; columns?: 1 | 2 | 3}
 | {id: string; kind: 'split'; title?: string; primary: string[]; secondary: string[]; ratio?: 'equal' | 'wide-primary'}
```

每页最多一个hero；hero默认start，section默认2列，split默认wide-primary（2:1）。仅一层，无递归、任意CSS或用户断点。每个组件至多被引用一次，引用必须属于本页。空分区可保留结构，渲染时省略空标题和占位；未分组组件始终按原相对顺序追加。null或[]仅清除分区，保留当前组件顺序、span、身份与数据。

sections顺序→items或primary→secondary→未分组项是唯一阅读/键盘顺序；写入时同步重排page.components为此顺序，不重发ID。set_page_sections整体替换分区；未知引用、重复、非法形状/选项必须在commit前原子失败。读取/导入容忍坏分区并清理悬空/重复引用，不因坏布局丢组件。

同页move与带index的add以当前规范化组件顺序为索引：先移除被移动引用，再插到目标索引的组件所在槽位之前；末尾进入未分组区。跨页默认追加到目标未分组区，有index时沿用插入规则。删除、卸载addon/custom/application、取消挂载均清引用。同页mount只调span时保留位置与分区。旧页操作保持原行为。

纯领域模块pageSections.ts集中严格解析、宽容读取、引用清理、顺序与插入逻辑；ops负责纯结构操作，store负责commit/history。templates内置preset换ID时用同一映射重写refs；自存模板和undo/redo保留原ID。外观还原保留sections。

## 渲染合同

保留所有.widget为同一个.page-grid的直接子元素，key只由组件ID决定。标题为独立稳定key兄弟；布局编辑、跨区移动、容器缩放和主题切换不更换业务子树父级。继续共用应用resolver、WidgetBoundary、data-id/type与检查器定位。

扁平布局计划给每项桌面grid-row/grid-column：hero逐项满行；section最多3等列；split主栏与辅栏按相同行索引对齐，比例1:1或2:1，不做独立列瀑布流。DOM顺序主栏全部→辅栏全部。使用.page-grid自身的CSS容器查询；实际内容宽度小于720px时撤销显式行列、按DOM顺序单列，不能靠窗口media query或重挂组件实现。

分区页面允许整页纵向滚动、自然内容高度，不沿用旧一屏强压缩。样式沿用纸张主题、墨色字体、现有token、无默认边框/大圆角/重背景。标题可换行，结构不额外添加操作按钮。widget自身的长内容、空/错误状态仍由原组件承担。

## AI发现与验证接口

list_page_layouts返回三种结构及受控参数/重排规则；set_page_sections经ops写入；get_workspace披露实际sections、有效顺序和未分组项。更新主提示词、frontend-design技能和docs/design-system.md，指导先读ID，再分组，再inspect_page复查；不把布局积木称作可add_component的组件。

沿用已批准的测试接口：公开工具parse/execute、真实ops/store/templates/migrate、真实PageView浏览器。先红后绿，覆盖非法写入0提交、CRUD与应用挂载、模板/undo/redo、旧页及容器状态存活。

## 文件与职责

- workspace.ts、pageSections.ts、ops.ts、workspaceStore.ts、applications.ts、templates.ts：数据与操作完整链。
- PageView.tsx、pageSectionLayout.ts、page-sections.css、main.tsx（仅样式导入）：扁平渲染与实际容器布局。
- tools.ts、ai.ts、skills.ts：AI发现/写入/读取和使用指引。
- test-page-sections*.mjs及tests/page-sections-regressions.*：数据、工具、真实浏览器回归；现有测试loader仅按新增依赖补齐。
- docs与spec、GLOSSARY：已验证合同和领域术语。

## 范围外

不改变用户当前首页、不自动套用演示、不新增依赖；不做草稿事务、四类首页模板、拖拽编辑器、任意布局树、独立列瀑布流或新增图表/表格。本轮产出可单独演示的布局能力，后续homepage-recipes消费此合同。
