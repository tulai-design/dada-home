import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, ToastHost } from '@lobehub/ui'
import { motion } from 'motion/react'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import App from './App'
import { initStorage } from './lib/storage'
import './styles.css'
import './theme.css'

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

// 先把 IndexedDB 里的数据读进内存再渲染：组件一挂载就要同步拿到自己的数据。
void initStorage().then(() =>
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider motion={motion}>
      <ToastHost position="top-right" />
      <App />
    </ConfigProvider>
  </StrictMode>,
  ),
)
