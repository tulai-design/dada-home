import {createRoot} from 'react-dom/client'
import {ConfigProvider, ToastHost} from '@lobehub/ui'
import {motion} from 'motion/react'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import App from '../src/App'
import {initStorage} from '../src/lib/storage'
import '../src/styles.css'
import '../src/theme.css'
import '../src/page-sections.css'
import '../src/homepage-draft.css'
import '../src/dock.css'
import '../src/life.css'

const config = await (await fetch('/__qa/config')).json()
const parentOrigin = new URL(document.referrer).origin
if (![config.origin, config.peerOrigin].includes(parentOrigin)) throw new Error('QA parent origin mismatch')
let failure = ''
window.addEventListener('error', event => {failure ||= event.message})
window.addEventListener('unhandledrejection', event => {failure ||= String(event.reason?.message ?? event.reason)})
const waitFor = async (read: () => unknown) => {
  const started = performance.now()
  while (performance.now() - started < 20000) {
    if (failure) throw new Error(failure)
    const result = read()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('实际应用未在预期时间内完成渲染')
}
try {
  await initStorage()
  createRoot(document.getElementById('root')!).render(<ConfigProvider motion={motion}><ToastHost/><App/></ConfigProvider>)
  const settings = await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label="设置"]')) as HTMLButtonElement
  await waitFor(() => document.documentElement.dataset.theme === 'dark')
  const themeApplied = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#211a35'
  settings.click()
  await waitFor(() => document.querySelector('.settings-page'))
  const partial = new URL(location.href).searchParams.has('partial')
  const searchSummary = !partial || Boolean([...document.querySelectorAll('.ios-summary')].find(item => item.textContent === '未配好'))
  parent.postMessage({channel: config.runId, ready: 'app', value: {settingsRendered: true, themeApplied, searchSummary}}, parentOrigin)
} catch (error) {
  parent.postMessage({channel: config.runId, ready: 'app', error: error instanceof Error ? error.message : String(error)}, parentOrigin)
}
