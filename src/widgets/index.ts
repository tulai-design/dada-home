/**
 * 组件注册入口。
 *
 * 每个组件文件在末尾调用 registerComponent 自注册，这里只负责按固定顺序 import，
 * 保证注册表在任何组件被渲染前已经填充完整。
 *
 * 新增组件：在 widgets/ 下建文件、末尾自注册、在 workspace.ts 的 ComponentType
 * 里加一个值，再在这里 import 一行。
 */
import './clock'
import './search'
import './weather'
import './todos'
import './note'
import './feeds'
import './bookmarks'
import './hot'
import './quote'
