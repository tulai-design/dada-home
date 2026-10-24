# 搭搭书签桥

让搭搭读取、整理浏览器里的书签的 Chrome / Edge 扩展（Manifest V3）。

- 只申请 `bookmarks` 权限；对网站的访问是可选权限，用户在某个网站上点「在此网站启用」时才会申请，只对这一个网站生效。
- 网页通过 `window.postMessage` 和内容脚本通信，后台只接受已启用网站的请求。
- 不删除文件夹（删文件夹会连带里面的全部内容）。「同步到浏览器」只在书签栏新建「搭搭」文件夹往里添加。

## 本地安装

1. `pnpm pack:ext` 会生成 `public/dada-bookmarks-extension.zip`（`pnpm build` 时自动执行），页面里的「下载」按钮用的就是它。
2. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开「开发者模式」，「加载已解压的扩展程序」选这个 `extension/` 目录。
3. 打开搭搭，点工具栏里的扩展图标，「在此网站启用」。

## 上架后

把应用商店地址填进 `src/lib/browserBookmarks.ts` 的 `EXTENSION_STORE_URL`，安装步骤就会变成一个「去安装」按钮。

## 逻辑测试

`handlers.js` 只依赖传入的 `bookmarks` API，可以用假 API 在 Node 里直接跑。
