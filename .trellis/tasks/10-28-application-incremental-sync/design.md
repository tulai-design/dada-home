# 设计

## 缺口与归属

当前 applicationData 只向 apps 仓保存，服务 SDK 尚未接入真实业务。本轮改变保存边界及新增应用专用同步适配器；通用网络/密码学继续在独立 SDK。

- db.ts：同步 read-plan-write 原子原语及专用本机同步仓；不执行网络或加密。
- applicationData.ts：保存/删除与持久意图原子提交，沿用失败报告和保存屏障。
- applicationSyncStore/Types：绑定 epoch、generation、draft、不可变 prepared、版本、冲突、游标。
- applicationSyncCodec/Projection：应用身份、凭据过滤、完整加密对象、入站校验。
- applicationSync.ts：有界运行、重试对账、锁与只读门禁。
- storageCommit.ts：活动绑定时拒绝 apps 整包替换，防两套同步基线混写。

## 身份与数据

collection=applicationData，schemaVersion=1。entityId 为 UTF-8 编码 JSON.stringify(canonical app key) 的 SHA-256；不能截断或降低既有 1000 JS 字符约束。认证密文 metadata 保留 canonical key，并核验 hash。删除也使用加密 metadata 的逻辑墓碑 put，便于新设备识别 hash 身份；与保存空对象不同。

每个应用状态序列化到加密对象，8 MiB/100 层正文不经过服务小记录 canonical 限制。live metadata精确为{format,version,applicationKey,prepared:{descriptor,manifest}}，墓碑精确为{format,version,applicationKey,deleted:true}。format=dada-application-data，version=1。记录只放加密 metadata/manifest，objectRefs 与 descriptor 完全对应。完整密文 Blob 与原始请求在任何网络写入前持久化；token/keyring 仅在运行时传入。

## 原子与并发

绑定包含 endpoint/appId/spaceId/deviceId/非秘密密钥标识和随机 epoch。业务值与最新 draft 同事务；claim 固定 generation 和 operationId，后继编辑独立保留。确认只清自己对应版本。409 不自动 rebase，冲突保存双方与版本；解决操作同时使用观察时的 localGeneration 与 remoteRevision 守卫。

网络/crypto 在事务外；apply 页时重新读取当前 apps 与队列，合并本机凭据后再次校验，同事务保存业务、版本、冲突和 cursor。自己的 deviceId+operationId 回流先对账。非法记录、未知 schema/collection、解密/对象失败拒绝整页。

## 生命周期

run/bind/detach 与恢复共用 dada-storage-restore Web Lock，本地普通编辑仍允许。入站短暂写入门禁并 flush 已接受写入，业务变化后设置 sync-reload，避免旧 iframe/cache 写回。一次运行只应用一个有界页，返回 hasMore/needsReload。

close 停止运行且保留待同步数据；显式 detach 清活动绑定、隔离保留旧 epoch 队列与冲突，之后纯本地可用。绑定期间恢复/整包同步若涉及 apps 则拒绝；解绑后才能替换。重新绑定新 epoch 从本地种子开始，已有远端数据走冲突，不无声复用旧游标。恢复日志 v4 只保存和回退实际触及的业务仓；非 apps 写入失败不能因活动绑定而让恢复卡住。活动标签的旧cache通过持久generation CAS拒绝覆盖。

## 交付与验证

固定 SDK tarball 随仓库保存，记录来源提交/摘要；不使用绝对路径依赖或未发布的远端版本。Docker依赖安装前复制vendor，构建与CI Node固定24.11.0以满足SDK消费环境。真实浏览器 QA 使用隔离 origin、临时服务目录与合成令牌，不读取用户现有站点数据。单元测试覆盖纯 codec/协调行为，浏览器验证真实事务和 HTTP。
