# 本地固定的同步 SDK

`tulai-design-sync-sdk-0.1.0.tgz` 来自独立仓库 [tulai-design/sync](https://github.com/tulai-design/sync)，源码提交 `a6c8f92`；包内容为浏览器/Node 客户端、协议与加密模块，不包含服务端或凭据。

- SHA-256：`3ee56ae34f2299017684dd0348043307dc8d8b81bd071554076cabd5cc0defd0`
- 依赖通过 `file:vendor/tulai-design-sync-sdk-0.1.0.tgz` 和 pnpm lockfile 固定，无本机绝对路径依赖。
- 此包尚未发布到 npm。正式发布后再替换版本来源；不要在搭搭复制或直接修改 SDK 源码。
- 更新包时先在同步仓库运行测试和类型检查，再 `pnpm pack --pack-destination <临时目录>`，核对归档只包含声明的 SDK 文件，最后更新此摘要与 lockfile。

本轮使用用户指定的本机 pnpm 可执行路径；该路径依据当前仓库原有 `packageManager: pnpm@10.20.0` 运行同版本，保留现有 node_modules 和 lockfile 格式，未调用 Codex Runtime pnpm 或重装依赖树。
