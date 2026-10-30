import {A, Text} from '@lobehub/ui'
import {DownloadSimple, Browser, ArrowClockwise, Database} from '@phosphor-icons/react'
import {isExtension} from '../lib/platform'
import {Group, Row} from './ios'

export const EXTENSION_DOWNLOAD = `${import.meta.env.BASE_URL}dada-extension.zip`

export function ExtensionSettings() {
  const installed = isExtension()
  return (
    <>
      <Group title={installed ? '正在使用浏览器扩展' : '搭搭 · 新标签页'} footer="适用于桌面版 Chrome 和 Edge。完整主页在浏览器本地运行；AI、订阅和同步仍需配置对应服务。">
        <Row label={installed ? '已安装开发者版本' : '把每个新标签页，变成自己的空间'} hint="保留主题、小工具、AI 搭建和生成应用。" icon={<Browser size={16} />} />
        {!installed && <Row label="下载扩展安装包" icon={<DownloadSimple size={16} />}>
          <A href={EXTENSION_DOWNLOAD} download="dada-extension.zip">下载 ZIP</A>
        </Row>}
      </Group>
      <Group title="安装方法" footer="ZIP 需要先解压；浏览器不会自动安装下载的文件。">
        <Row label="1. 下载并解压 ZIP" hint="将解压目录保存到固定位置，安装后也保留该目录。" />
        <Row label="2. 打开扩展管理" hint="Chrome：chrome://extensions；Edge：edge://extensions。复制地址到浏览器地址栏打开。" />
        <Row label="3. 开启开发者模式" hint="点击「加载已解压的扩展程序」，选择包含 manifest.json 的目录。" />
        <Row label="4. 打开一个新标签页" hint="浏览器询问时，确认使用搭搭作为新标签页。" />
      </Group>
      <Group title="数据与更新">
        <Row label="带上现在的数据" icon={<Database size={16} />} hint="网页版与扩展的数据独立。在「设置 → 数据」导出备份，再在扩展中导入；也可以连接同一个同步服务。" />
        <Row label="更新扩展" icon={<ArrowClockwise size={16} />} hint="从网页版下载新 ZIP，关闭搭搭标签页，将文件解压覆盖到原目录，再在扩展管理页点击重新加载。保留原目录和现有扩展，避免卸载丢失本地数据。" />
      </Group>
      <Text type="secondary">同时打开多个搭搭标签页时，使用「回到搭搭」进入已运行的主页，避免小工具重复运行和编辑互相覆盖。关闭运行页面会中断当前 AI 回答。</Text>
    </>
  )
}
