import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, ToastHost, toast } from '@lobehub/ui'
import { motion } from 'motion/react'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import App from './App'
import { initAnalytics } from './lib/analytics'
import { initStorage } from './lib/storage'
import { consumeSyncKeyFromLocation, startAutoSync } from './lib/sync'
import {StorageStartupError} from './components/PersistenceNotice'
import './styles.css'
import './theme.css'
import './page-sections.css'
import './homepage-draft.css'
import './dock.css'
import './life.css'
import './switch-content.css'
import './switch-widgets.css'
import './switch-collections.css'

// 仅开发环境：把工具和 store 挂到 window，方便在控制台按 AI 的方式调用，验证整条链路。
if (import.meta.env.DEV) {
  void Promise.all([import('./lib/tools'), import('./lib/workspaceStore')]).then(([tools, store]) => {
    ;(window as unknown as Record<string, unknown>).__tada = {
      /** 像 AI 一样调用一个工具：__tada.call('set_page_layers', {...}) */
      call: async (name: string, args: unknown) => {
        const tool = tools.findTool(name)
        if (!tool) return `没有工具 ${name}`
        const parsed = (tool as unknown as {parseArguments: (raw: unknown) => unknown}).parseArguments(args ?? {})
        return tools.runTool(tool, parsed, {openPage: () => undefined} as never)
      },
      tools: tools.HOME_TOOLS.map((tool) => tool.name),
      findTool: tools.findTool,
      workspace: store.getWorkspace,
    }
  })
}

// PWA：生产环境注册 service worker。新版本下载好后提示一下，用户点了再刷新。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast.info({
          id: 'pwa-update',
          title: '搭搭有新版本了',
          description: '刷新后就能用上。',
          duration: 0,
          actions: [{ label: '刷新', onClick: () => void update(true) }],
        })
      },
      onRegisterError(error) {
        console.warn('service worker 注册失败', error)
      },
    })
    // 开着不关的标签页也要能发现新版本：每小时问一次
    window.setInterval(() => void navigator.serviceWorker.getRegistration().then((reg) => reg?.update()), 60 * 60 * 1000)
  })
}

// 先把 IndexedDB 里的数据读进内存再渲染：组件一挂载就要同步拿到自己的数据。
const root = createRoot(document.getElementById('root')!)
async function start() {
  try {
    await initStorage()
    initAnalytics()
    consumeSyncKeyFromLocation()
    startAutoSync()
    root.render(
      <StrictMode>
        <ConfigProvider motion={motion}>
          <ToastHost position="top-right" />
          <App />
        </ConfigProvider>
      </StrictMode>,
    )
  } catch (error) {
    root.render(<ConfigProvider motion={motion}><StorageStartupError error={error} onRetry={start} /></ConfigProvider>)
  }
}
void start()
