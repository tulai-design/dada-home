# 本地声明式主题包实施顺序

状态：具体设计已审读接受，按既有授权实施。基线 `7fa143a`，依赖 theme-authoring 已完成。

## 1. 先冻结格式与真实失败用例

- 落 `themePackages/contracts.ts`、纯 codec/预算/规范摘要函数，导出 PackageIdentity、ThemePackageRef、LocalThemeFontRef、Availability 与UI摘要。
- 一个JSON文件，无ZIP和原始CSS/JS。资源manifest只用内部resourceId，不展开自身digest；实例化再生成完整ref，防止摘要自引用。
- 先写现真实red：带未知renderer的合法包依赖主题被assertThemeEntry拒绝/本地读取丢失；同步无资源只能落回默认且丢原引用；本地字体无resource消费。后续回归走真实公开边界，不能复制实现算法当断言。

## 2. 数据模型与解析纵向切片

- workspace版本9，主题packageRef/rendererContract/opaqueDesign；支持当前已知设计仍严格目录验证，未知renderer/package schema仅有界envelope保存。
- 原origin保持内置定义语义；全路径读/模板相等/来源fingerprint/同步/备份校验更新。
- resolveTheme返回请求与实际身份、availability和effective fonts；包不可用安全paper/standard/系统字，不改请求设计。
- author草稿对不可用/opaque来源明确拒绝编辑/应用，已知可用包设计完整派生；依赖fingerprint纳入精确包identity与本机generation，等待后重核。

## 3. 本机仓与持久化合同

- db7创建themePackages；包写入事务内重核不可变版本、全仓预算，完成后发布；初始化在App消费工作空间前完成，失败进入persistence故障。
- 包写队列加入saveBarrier，备份4/恢复日志5/DATA_STORES/snapshot/replaceOperations覆盖新仓，reset清仓；导入备份校验所有bytes/hash且恢复disabled，回滚保原状态。
- syncData显式仅导出旧业务仓，workspace refs完整往返，不分发bytes/enabled；增量配置同边界，不能从远端写本机仓。
- 所有坏包/数据库故障/确认后对象修改均零部分安装；无跨localStorage与IDB完全原子的声明。

## 4. 实际字体与预览

- 字体worker添加local ref严格验证、sha alias、FontFace(ArrayBuffer)、document lease、enabled默认resolver与单包闭包preparer；无fallback Google。
- UI接常驻runtime prepare端口；启用与激活prepare后重核generation/selection，latestworkspace一次commit，lease交接有界。
- preview控制仍64KiB，独立二进制请求有source/channel/revision/ref授权、2MiB/4MiB预算、hash核对、transfer副本和取消清理。
- 同名不同字节准备不得提前改变当前字体；FontFace检查Web与MV3实跑，不靠JSON存在声称已消费。

## 5. 产品闭环与Agent

- 外观页本地包组：文件解析摘要→确认安装disabled→包启停→选择贡献→引用保护卸载→原包/单方案依赖导出；错误说明含缺包/停用/不支持/损坏的区别。
- 既有Agent主题查询披露有效依赖诊断，不传base64大工具结果；本项不新增安装/启停AI工具，不提供网络下载或代码执行工具。
- 根runtime主题应用、Settings能力、appearance inspector与应用主题消息共用resolve有效结果，切包保业务舞台/助手/审批。

## 6. 验收和收尾

- 定向领域/资源/备份与同步回归；独立Web/MV3生命周期浏览器矩阵，保留未知依赖原文与实际回退/恢复证据。
- 本机pnpm依次tsc/full test/build；双轴Standards+Spec审查按基线7fa143a，不删旧断言绕退化。
- 更新长期运行时/作者/备份同步合同、字段目录/Agent文案及父任务验收；root提交实现、归档本子项并做A3整体验证/日志。此文件不是已完成检查记录。
