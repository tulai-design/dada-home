import {createRoot} from 'react-dom/client'
import {ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'
import '../src/widgets'
import {SyncSettings} from '../src/components/SyncSettings'
import {PersistenceNotice} from '../src/components/PersistenceNotice'
import * as database from '../src/lib/db'
import * as components from '../src/lib/componentData'
import * as chat from '../src/lib/chat'
import * as storage from '../src/lib/storage'
import * as persistence from '../src/lib/persistence'
import * as store from '../src/lib/store'
import * as workspace from '../src/lib/workspaceStore'
import * as ops from '../src/lib/ops'
import * as sync from '../src/lib/sync'

// Real storage, sync, providers and settings; only the test runner supplies an
// isolated remote. No App, analytics, auto sync or model provider is started.
const modules = {database, components, chat, storage, persistence, store, workspace, ops, sync}
declare global {interface Window {syncQA: typeof modules}}
async function start() {
  await storage.initStorage()
  window.syncQA = modules
  createRoot(document.getElementById('root')!).render(
    <ConfigProvider motion={motion}>
      <main style={{height: '100dvh', overflowY: 'auto', padding: '24px 12px', boxSizing: 'border-box'}}>
        <div style={{maxWidth: 720, margin: '0 auto', minWidth: 0}}><SyncSettings /></div>
      </main>
      <PersistenceNotice />
    </ConfigProvider>,
  )
}
void start()
