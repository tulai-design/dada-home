import {createRoot} from 'react-dom/client'
import * as database from '../src/lib/db'
import * as applications from '../src/lib/applicationData'
import * as components from '../src/lib/componentData'
import * as chat from '../src/lib/chat'
import * as storage from '../src/lib/storage'
import * as persistence from '../src/lib/persistence'

// This isolated entry only exposes real public modules. It neither initializes
// product storage nor starts the App, analytics, sync or a model provider.
const modules = {database, applications, components, chat, storage, persistence}
declare global {
  interface Window {
    storageQA: typeof modules
    storageChat: ReturnType<typeof chat.useChat>
  }
}
window.storageQA = modules
function ChatObserver() {
  const state = chat.useChat()
  window.storageChat = state
  return <main><h1>隔离存储行为验证</h1><output id="chat-state">{JSON.stringify({ready: state.ready, convId: state.convId, turns: state.turns})}</output></main>
}
createRoot(document.getElementById('root')!).render(<ChatObserver />)
