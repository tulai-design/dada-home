# 设计与边界

问题发生在产品 runAgent/dispatchTool、App.ask 审批生命周期及工具 guard，而不是供应商解码包。最小修正复用既有 AbortSignal 与失败事件合同，不再造工具框架。

- ai.ts：取消检查覆盖模型轮、分发、审批返回与批次边界；审批等待可取消且清理监听，AbortError 越过普通工具失败捕获，provider aborted 应表达取消。迟到响应/事件不重新触发执行。执行中的工具沿用 signal，等待其协作完成后释放拥有者，保留已提交效果。
- App.tsx 与 Assistant/审批关联类型：审批 resolver 绑定本轮和具体请求、清理 abort 监听和 pending；卡片答复携带独立审批 ID，chatStorageSchema 规整时保留 ID，不能依赖被重建的对象引用。旧卡回调不得答复新审批，旧 resolver 不得清掉新审批。finally 清理保留原会话/轮次身份，发送锁可靠释放。保持原有正确聊天写入边界。
- tools.ts/siteTools.ts/lifeTools.ts/searchTools.ts：消除异常变成功字符串。可解释领域异常交给统一分发层产生 ok:false；工具仍向模型回传解释，无需按文本反推。检查明确业务拒绝的普通返回，正常查询空结果保持现状。
- 对已经存在的异步写入补提交前取消边界：set_hot_boards 查询后提交、个人资料地名查询后写设置；weather.geocode 可选 signal；browserBookmarks 导入/推送可选 signal，导入落本地前、写扩展新批次前检查。已发送的扩展请求没有撤销协议，等待其完成，不提前释放发送锁也不声称回滚。
- 必要小型产品取消辅助函数可置于 src/lib，避免反复复制监听策略；不得为A4预建执行管理器。测试用真实行为边界，现有脚本可隔离模块，浏览器用真实App与模拟模型服务。
- 调整现有依赖错误合同的测试；新取消/失败行为纳入 pnpm test。不修改 node_modules 或通用 providers。
- 根会话维护长期合同/架构评估状态、任务验证日志与提交；实现代理负责运行时代码及行为测试；浏览器代理仅读并生成独立测试脚本，避免争写。

回滚是本轮提交级还原，无存储协议或格式变更，无迁移。
