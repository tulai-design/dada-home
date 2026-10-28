import * as chat from '../src/lib/chat'
import * as schema from '../src/lib/chatStorageSchema'
import * as database from '../src/lib/db'
import * as storage from '../src/lib/storage'
import * as persistence from '../src/lib/persistence'
const modules = {chat, schema, database, storage, persistence}
declare global {interface Window {chatQA: typeof modules}}
// 不启动产品、模型或同步；测试显式创建独立浏览器上下文和合成数据。
window.chatQA = modules
