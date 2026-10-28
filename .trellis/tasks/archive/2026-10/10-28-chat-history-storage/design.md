# 聊天分页与工具正文分离

日期：2026-10-28；基线4547ad1，按新模型实现，无旧数据迁移/双写。不删除真实用户旧记录；不兼容旧持久格式。

## 变化边界

当前startup读取全部convs和当前会话全部turns，UI slice40只是渲染隐藏；工具text混在turn里。实现仓库游标分页、工具正文按需读取、独立模型上下文与明确写API；不做自动摘要/删除、内容去重、云端独立明细冲突协议或新增依赖。本轮只外置工具正文，prompt/answer/reasoning/article仍按轮分页读取且完整保存。

## 数据与纯边界

新 chatStorageSchema.ts 无React/DB依赖，提供并从chat.ts重导出：
- ToolStep {name,title,ok,text}，Turn沿现有完整逻辑结构（convId可选），Conv保持id/title/createdAt/updatedAt。
- StoredTool {name,title,ok,detailId}；StoredTurn = Omit<Turn,'tools'|'convId'> & {convId:string;tools:StoredTool[]}。
- ToolDetail {id,turnId,convId,index:number,text:string,bytes:number}。id由 JSON.stringify([turnId,index]) 确定，index非负整数，bytes为text的UTF-8字节，不是磁盘占用。
- splitTurn(full:Turn & {convId:string}):{turn:StoredTurn;details:ToolDetail[]}；hydrateTurn(head:StoredTurn,details:ReadonlyMap<string,ToolDetail>):Turn & {convId:string}。
- validateTurn(value:unknown):Turn & {convId:string}、validateStoredTurn(value:unknown):StoredTurn、validateToolDetail(value:unknown):ToolDetail、validateConv(value:unknown):Conv、validateStoredChat(convs:unknown[],turns:unknown[],details:unknown[]):void。

完整字段/有限时间/ID/重复/引用归属/顺序/bytes均验证，缺正文不能补空；全仓校验拒绝孤立明细或轮次。物理引用与工具正文同事务写入，已保存body不随每个answer片段重写。DB升版本新增toolDetails(id主键，turnId与convId索引)；convs索引recent=[updatedAt,id]；turns索引chronological=[convId,startedAt,id]，保留convId删除索引。snapshot五仓同事务读取。

## 仓库接口

chat.ts保留initChat/flush/beginTurn/turnContent/contextTurns/elapsed/isActive和完整导出/清空；删除旧迁移及setTurns语义，用显式写替代“可见数组缺席即删除”。

getChatState()/useChat状态：ready、convs、convId、currentConv:Conv|null、turns:StoredTurn[]、activeTurnIds:string[]、hasMoreConvs、convsLoading、hasOlderTurns、turnsLoading、convsError:string、turnsError:string。

导出方法并由useChat返回：newConv():Promise<string>、openConv(id):Promise<void>、deleteConv(id):Promise<void>、loadMoreConvs():Promise<void>、loadOlderTurns():Promise<void>、appendTurn(convId,turn:Turn):void、patchTurn(convId,turnId,patch:Partial<Omit<Turn,'id'|'convId'|'tools'>>):void、appendTool(convId,turnId,tool:ToolStep):void。另 readToolDetail(detailId):Promise<string>，loadContextTurns(convId,limit=24):Promise<StoredTurn[]>。

初始每页40轮、50会话，按复合索引exclusive cursor读取limit+1，显示按时间/id确定序；cursor不随流式排序移动重建。currentConv独立取回saved id，即使不在前50会话也能打开。页加载只更新可见内存，不标脏、不推断删除；失败保留已有页与cursor，允许真实重试。加载与导航使用请求代次，结果合并最新active/dirty版本，并为每个在途读取保留其生命周期内的更新，flush确认后也不能被迟到结果回退；读取结束立即释放这份overlay。删除其他会话不取消当前历史分页；只撤销指向被删除会话的导航。

活动轮独立于当前页，所有patch捕获convId+turnId；导航不清除正在生成的数据，磁盘未结束轮仅在非本次active时标中止。删除活动会话明确拒绝；删除整个会话用key-only索引查询删除全部轮次/明细，不能仅删除已加载页或全读工具正文取ID。新建/删除/翻页/导航与恢复门禁、flush保持一致。

readToolDetail优先pending、否则单条DB读，缺失/损坏明确错误；不建无限全局明细缓存。UI局部缓存随行卸载释放。模型上下文独立索引查最新最多limit轮并合入已接受写入，继续原contextTurns规则：默认24、设置1–100、36000 JS字符，至少最新一轮；文章参与，历史reasoning/tools不发送。不会读取工具正文。

## UI与发起

App.tsx在ask开始捕获目标convId，fresh由newConv返回id；await独立上下文后发模型，失败不回退UI片段，锁由finally释放。append/patch/appendTool绑定目标，保留当轮agent完整消息。发送全局互斥，生成中允许浏览其他会话/回到原会话；删除生成中禁用。

Assistant真加载更早40轮/更多50会话，loading/error/retry明确。prepend保留可见轮次锚点，不跳底；流式上滚继续暂停跟随。ToolRow展开后readToolDetail，有加载/错误重试/空正文；历史失败默认折叠但显示未完成，活动轮失败保持自动展开；使用detailId稳定key，旧异步结果不串到新行。active/pending审批仅真实活动轮可操作。抽屉/分栏/全屏共享入口，手机/双主题验证。

## 备份与同步

备份 version3，indexedDB.chat={convs,turns,toolDetails}三表必填并交叉验证；恢复日志version3和snapshot五仓，reset/rollback全覆盖。旧备份拒绝。原始恢复快照仅验证可回退结构，不要求历史坏数据满足导入规则。

快照 wire仍为v2完整逻辑Turn。collect在同一DB snapshot hydrate全部轮次，绝不从UI页/已展开明细取样；缺明细拒绝，生成中turn/conversation仍deferred。changes先按现有规则合回本机字段再split，新头/正文及旧body删除同一事务；turn/conv墓碑清理关联明细。不得让独立冲突合并拼出新头旧正文。Gist配置不读聊天仓。

## 验证与基线

隔离Chromium合成1000会话、单会话10000轮，每轮1020字符工具正文；基线4547ad1 startup读取1000convs(80891 JSON UTF8字节)+10000turns(29605249字节)，171.5ms（含测试采样开销，单次本机测量，不是性能保证）。新实现记录相同数据的读取行/字节/耗时、按字段合成字节及写入放大。验收重点是读取有界和工具零预读，不以单次耗时作承诺。

行为测试覆盖同时间游标、全部页顺序、快速导航、流式跨会话/翻页、读取/事务故障重试、引用原子性、上下文等价、备份完整恢复与两设备同步。使用隔离上下文与fake远端，禁止真实用户数据；最终test/tsc/build、Standards/Spec审查后提交归档。
