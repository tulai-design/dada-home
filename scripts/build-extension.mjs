import {build} from 'vite'
import {cp, mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {zipDirectory} from './zip-directory.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist-extension')
const download = path.join(root, 'public/dada-extension.zip')

await build({root, mode: 'extension'})
// 经典 IIFE 脚本可在不透明源 sandbox 中加载；运行时编译/Worker 不进入宿主页面。
await build({
  root,
  configFile: false,
  mode: 'extension',
  publicDir: false,
  build: {
    outDir: output,
    emptyOutDir: false,
    lib: {entry: path.join(root, 'src/extensionSplineRuntime.ts'), name: 'DadaSpline', formats: ['iife'], fileName: () => 'spline.js'},
    rollupOptions: {output: {inlineDynamicImports: true}},
  },
})
// 不复制 ZIP、源映射或其他生成物，避免递归包与站点运行时配置泄漏。
for (const name of await readdir(path.join(root, 'public'))) {
  if (name.endsWith('.zip') || name.endsWith('.map') || name === 'config.js') continue
  await cp(path.join(root, 'public', name), path.join(output, name), {recursive: true})
}
for (const name of await readdir(path.join(root, 'browser-extension'))) {
  if (name.endsWith('.md') || name.startsWith('.')) continue
  await cp(path.join(root, 'browser-extension', name), path.join(output, name), {recursive: true})
}
for (const name of ['handlers.js', 'icon16.png', 'icon48.png', 'icon128.png']) {
  await cp(path.join(root, 'extension', name), path.join(output, name))
}
await writeFile(path.join(output, 'config.js'), 'window.__DADA__ = {}\n')
await writeFile(path.join(output, '安装说明.txt'), [
  '搭搭 · Chrome / Edge 新标签页扩展（开发者模式自用版）',
  '',
  '1. 将 ZIP 解压到固定目录，请保留该目录。',
  '2. 打开 chrome://extensions 或 edge://extensions，开启「开发者模式」。',
  '3. 点击「加载已解压的扩展程序」，选择包含 manifest.json 的目录。',
  '4. 打开新标签页。若浏览器提示新标签页发生更改，请选择保留。',
  '',
  '更新：用新包替换原目录文件，在扩展管理页点击「重新加载」，再刷新搭搭页面。',
  '请勿卸载后重装来更新；卸载会清除扩展本地数据。建议先导出备份。',
  '网页与扩展数据独立，可在设置 → 数据导出/导入备份，或配置自己的同步连接。',
  'AI、RSS 等服务仍需网络和连接配置。首次连接目标站点时请按提示授权。',
  '多个新标签页共用一个编辑实例，避免旧页面覆盖数据。',
].join('\n'))
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
for (const file of [manifest.chrome_url_overrides.newtab, manifest.background.service_worker, ...manifest.sandbox.pages, 'sandbox.js', 'spline.js']) {
  if (!(await stat(path.join(output, file))).isFile()) throw new Error(`扩展包缺少必要文件：${file}`)
}
await mkdir(path.dirname(download), {recursive: true})
await rm(download, {force: true})
await zipDirectory(output, download)
console.log(`完整扩展目录：${output}\n下载 ZIP：${download}`)
