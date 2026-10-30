import {useLayoutEffect, useRef, useState} from 'react'
import {Rail} from '../Rail'
import {SwitchDock, SwitchHome} from '../SwitchShell'
import {Win98Desktop, Win98Taskbar, Win98Titlebar} from '../Win98Shell'
import {ShellPort} from './ports'
import {STANDARD_CAPABILITIES, VISIBLE_PRESENTATION, type ShellAdapter, type ShellAdapterProps} from './contracts'
import {DEFAULT_WIN98_WINDOW_GAP} from '../../lib/themeCatalog'

function StandardChrome({model, dispatch, publish}: ShellAdapterProps) {
  useLayoutEffect(() => publish(VISIBLE_PRESENTATION), [publish])
  return <ShellPort place="navigation"><Rail model={model} dispatch={dispatch} /></ShellPort>
}
function SwitchChrome({model, dispatch, publish}: ShellAdapterProps) {
  const [board, setBoard] = useState(true)
  const [dockHeight, setDockHeight] = useState(72)
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const dock = chrome?.querySelector<HTMLElement>('.switch-dock')
    if (!dock) return
    const measure = () => setDockHeight(dock.getBoundingClientRect().height)
    measure(); const observer = new ResizeObserver(measure); observer.observe(dock); return () => observer.disconnect()
  }, [board, chrome])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const activation = useRef(model.activation.revision)
  useLayoutEffect(() => {if (activation.current !== model.activation.revision) {activation.current = model.activation.revision; setBoard(false)}}, [model.activation.revision])
  useLayoutEffect(() => publish({...VISIBLE_PRESENTATION, content: board ? 'launcher' : 'visible', backdrop: board ? 'shell' : 'page', reserves: {top: 0, right: 0, bottom: board ? 0 : dockHeight, left: 0}}), [board, dockHeight, publish])
  const selected = model.entries.find((entry) => entry.key === selectedKey)
    ?? model.entries.find((entry) => !entry.home && entry.pinned && entry.target.kind !== 'system')
  const view = model.activation.target.kind === 'system' ? model.activation.target.name : model.activation.target.kind
  return <ShellPort place="canvas"><div className="shell-adapter-root" ref={setChrome}>
    {board && <SwitchHome name={model.profile.name} avatarSeed={model.profile.avatarSeed} entries={model.entries} dispatch={dispatch} selectedKey={selectedKey} onSelect={setSelectedKey} />}
    <SwitchDock view={view} board={board} entries={model.entries} dispatch={dispatch} onBoard={() => {setSelectedKey(null); setBoard(true)}} onStart={selected ? () => dispatch({type: 'navigate', target: selected.target}) : undefined} />
  </div></ShellPort>
}
function Win98Chrome({model, dispatch, publish}: ShellAdapterProps) {
  const [content, setContent] = useState<'visible' | 'minimized' | 'closed'>('closed')
  const [maximized, setMaximized] = useState(false)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState({gap: DEFAULT_WIN98_WINDOW_GAP, taskbar: 44})
  const requestedGap = model.shellConfig?.windowGap ?? DEFAULT_WIN98_WINDOW_GAP
  useLayoutEffect(() => {
    const canvas = root?.closest('.canvas')
    const taskbar = root?.querySelector<HTMLElement>('.win98-taskbar')
    if (!canvas || !taskbar) return
    const measure = () => {const rect = canvas.getBoundingClientRect(); const taskbarHeight = taskbar.getBoundingClientRect().height; const safeGap = Math.max(4, Math.min(requestedGap, (rect.width - 240) / 2, (rect.height - taskbarHeight - 160) / 2)); const next = {gap: maximized || rect.width <= 760 || rect.height <= 420 ? 4 : safeGap, taskbar: taskbarHeight}; setGeometry((old) => old.gap === next.gap && old.taskbar === next.taskbar ? old : next)}
    measure(); const observer = new ResizeObserver(measure); observer.observe(canvas); observer.observe(taskbar); return () => observer.disconnect()
  }, [maximized, root, requestedGap])
  const activation = useRef(model.activation.revision)
  useLayoutEffect(() => {if (activation.current !== model.activation.revision) {activation.current = model.activation.revision; setContent('visible')}}, [model.activation.revision])
  useLayoutEffect(() => publish({...VISIBLE_PRESENTATION, content, maximized, backdrop: 'shell', reserves: {top: geometry.gap + 32, right: geometry.gap, bottom: geometry.gap + geometry.taskbar, left: geometry.gap}}), [content, maximized, geometry, publish])
  const title = model.activation.target.kind === 'system' && model.activation.target.name === 'settings' ? '控制面板' : model.activation.title
  const desktop = content !== 'visible'
  const navigation = {entries: model.entries, dispatch}
  return <ShellPort place="canvas"><div className="shell-adapter-root" ref={setRoot}>
    {desktop && <Win98Desktop {...navigation} />}
    {!desktop && <Win98Titlebar title={title} maximized={maximized} onMinimize={() => setContent('minimized')} onMaximize={() => setMaximized((value) => !value)} onClose={() => {dispatch({type: 'close-content'}); setContent('closed')}} />}
    <Win98Taskbar {...navigation} title={title} activationRevision={model.activation.revision} windowOpen={content !== 'closed'} desktop={desktop} onRestore={() => setContent('visible')} onDesktop={() => setContent('minimized')} mode={model.mode} assistantOpen={model.assistant.open} />
  </div></ShellPort>
}
export const BUILTIN_SHELL_ADAPTERS: readonly ShellAdapter[] = [
  {id: 'standard', capabilities: STANDARD_CAPABILITIES, Chrome: StandardChrome},
  {id: 'switch', capabilities: {settings: {header: 'wide', avatar: true}, navigation: 'launcher'}, Chrome: SwitchChrome},
  {id: 'win98', capabilities: {settings: {header: 'sidebar', avatar: false}, navigation: 'taskbar'}, Chrome: Win98Chrome},
]
