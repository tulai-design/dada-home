# Applet 趋势图设计

基线：1d12e1f；原有提交已按用户授权推送。沿用main开发与每轮验收后本地提交约定。

## 范围与选型

补齐已有Bars之外的分类序列折线/趋势图。使用宿主原生SVG，集成到ui.LineChart白名单；不新增图表依赖，不开放任意React组件导入。Recharts为后续复杂图表候选，本轮已查官方React19兼容与无障碍资料，但受控折线+有界数据+明细表不需要完整图表库。事实与取舍见research/implementation.md。

不新增远程数据源、不自动安装演示应用、不调整既有Bars/Table行为，不加入散点/饼图/缩放/拖选/任意轴格式函数。示例与目录交付使AI能真正声明该积木。

## 公开协议

`ui.LineChart({title?, labels, series, unit?, height?})`。

- labels：字符串数组，0–120项，每项最多80字符，按输入顺序等距排列。不是自动日期轴；AI负责排序和按日/周/月聚合。
- series：1–4项，每项`{name:string, values:(number|null)[], tone?:'accent'|'blue'|'green'|'orange'}`。name非空且最多80字符。values长度须与labels一致，数值必须有限且绝对值≤1e12；0和负数是有效数值。null表示缺失，画断线，不补0、不跨缺口连接。
- title可选，默认“趋势”，若提供须非空且≤80字符；unit可选，≤16字符，仅文本后缀。height可选，默认220，有限数字按160–360约束。
- 缺字段、错误类型、长度不匹配、超量系列/点或无效数值在图表边界显示可理解错误。禁止静默截断或改写业务数据；模型应先聚合后重试。未知额外字段沿用现有渲染器忽略策略，不作为可用能力描述。
- 空labels或全null显示无数据状态；全null仍保留缺失明细。单点/常数/正负数均有可见图形与有限坐标。
- 图例颜色来自宿主语义token，默认依次accent/blue/green/orange，可选tone；不同系列另外用不同线型，不能只靠颜色识别。

## 模块与渲染

`src/lib/applet/lineChartData.ts`负责unknown协议校验、限额、每序列可读摘要；返回`{ok:true,data}`或`{ok:false,error}`，不抛给整个应用、不取数/写存储。数据模型见实现前代理接口协调。catalog从同一限额导入常量，避免文档与执行不同。

`src/lib/applet/LineChart.tsx`封装SVG和明细，以已有UiTree新增分支接入。测量真实容器，不依赖window/runner iframe。为复用现有useContainerWidth，可移到独立同目录hook并由render.tsx重导出，保持widgets/applet.tsx当前导入兼容，避免renderer与Chart循环依赖。

SVG用线性折线；null切断为独立段，单点可见。纵轴共同包含0，flat全0使用非零安全范围；不支持双轴或混合单位。横轴按实际宽度减少到2–6个标签并保留首尾，必要缩略刻度但完整文本和精确值在明细。默认无动画；resize只改变展示，不重启runner/请求。

图表无额外卡片壳。标题与最新值摘要、可换行图例、图形、原生details“查看数据”；表格有caption和列标题，缺失显示“缺失”，数字明细不使用轴上的缩略值。触摸和键盘都能展开读取数据，表格可在自身范围横滚；SVG提供有意义title/desc，不能只依赖hover tooltip。空/错误不显示假趋势。

## AI示例

新增共享的可执行趋势示例源，catalog guide引用该源；示例使用本地记录，支持添加记录、时间范围或单位设置、persist、status简洁分支，不在view取数，不假造真实用户记录。验证中通过真实create_applet安装/打开，测试数据仅放隔离context，用户工作空间不自动加样例。

## 职责与测试

- 数据代理：lineChartData.ts、catalog.ts、趋势示例源、对应公开协议/runner测试；从缺失LineChart目录红灯逐条纵向实现。
- 渲染代理：LineChart.tsx、独立样式、容器hook提取、render.tsx接线；先通过UiTree真实渲染取得红灯，保留Bars。
- 验证代理：真实Applet/UI浏览器脚本或隔离夹具；320/375/768/1440和桌面窄容器、深浅主题，空/错误/null/负数/单点/超量、键盘/触摸数据明细、无横溢、resize/theme/state不重启取数。与数据/渲染代理对齐公开协议，不检查图表私有路径字符串。
- 主会话：设计/规范/运行时指引及widgets/applet.tsx目录描述、package测试链接入、官方资料、集成检查、双轴审查、提交归档。测试沿用已批准的Applet目录→runner JSON→UiTree可观察行为，不新设用户需确认的接口。
