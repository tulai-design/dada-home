import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Flexbox, Tag, Text, toast} from '@lobehub/ui'
import {ArrowCounterClockwise as RotateCcw, MagicWand as Wand2} from '@phosphor-icons/react'
import {useDark} from '../fx/Fx'
import {buildRunnerDoc} from '../lib/applet/runner'
import {UiTree, useContainerWidth, type UiNode} from '../lib/applet/render'
import {loadApplicationData, replaceApplicationData} from '../lib/applicationData'
import {sandboxFrameProps} from '../lib/extensionSandbox'
import {usePersistenceStatus} from '../lib/persistence'
import {registerComponent, type ComponentHost, type ComponentProps} from '../lib/registry'
import {bridgeFetch, copyText} from './app'

/**
 * 小程序：AI 写逻辑，系统控件出界面。
 *
 * 和「沙盒应用」(app) 的区别：app 把整个页面（HTML/CSS）交给 iframe，自由但风格难统一、原生控件难看；
 * 小程序只把「逻辑」交给沙盒，界面由主页用 Lobe UI 真实渲染，所以样式一致、交互可靠，逻辑照样自由。
 */

type AppletConfig = {source: string; settings?: Record<string, unknown>; surface?: string}

type Message = {applet: 1; k: string; [key: string]: unknown}

async function handleCall(message: Message, host: ComponentHost): Promise<unknown> {
  switch (message.op) {
    case 'fetch':
      return bridgeFetch(String(message.url ?? ''), host)
    case 'copy': {
      const ok = await copyText(String(message.text ?? ''))
      if (!ok) throw new Error('浏览器拒绝了复制')
      return true
    }
    case 'open': {
      const url = String(message.url ?? '')
      if (!/^https:\/\//i.test(url)) throw new Error('只能打开 https 链接')
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    }
    case 'ask':
      host.ask(String(message.text ?? '').slice(0, 2000))
      return true
    case 'toast': {
      const kind = message.kind === 'success' || message.kind === 'error' ? message.kind : 'info'
      toast[kind](String(message.text ?? '').slice(0, 200))
      return true
    }
    default:
      throw new Error(`未知操作：${String(message.op)}`)
  }
}

function Applet({instance, config, host}: ComponentProps<AppletConfig>) {
  const frame = useRef<HTMLIFrameElement>(null)
  const {ref: container, width} = useContainerWidth()
  const viewportRef = useRef({width, compact: width < 480})
  viewportRef.current = {width, compact: width < 480}
  const dark = useDark()
  const darkRef = useRef(dark)
  darkRef.current = dark
  const hostRef = useRef(host)
  hostRef.current = host
  const contextRef = useRef({settings: config.settings ?? {}, surface: config.surface ?? 'widget'})
  contextRef.current = {settings: config.settings ?? {}, surface: config.surface ?? 'widget'}
  const contextKey = JSON.stringify(contextRef.current)

  const [tree, setTree] = useState<UiNode | null>(null)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState<{kind: 'read' | 'write'; message: string} | null>(null)
  const [saving, setSaving] = useState(false)
  const {errors: persistenceErrors} = usePersistenceStatus()
  const previousStorageFailure = useRef({read: false, write: false})
  const [run, setRun] = useState(0)
  const runtime = useMemo(() => ({
    session: crypto.randomUUID(), ready: false, initialized: false, loading: false,
    latestSave: 0, pending: new Map<number, Promise<void>>(), latestCall: 0,
  }), [config.source, instance.id, run])
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const srcdoc = useMemo(() => buildRunnerDoc(config.source, runtime.session), [config.source, runtime])

  useEffect(() => {
    setTree(null)
    setError('')
    setStorageError(null)
    setSaving(false)
  }, [runtime])

  const post = useCallback((payload: Record<string, unknown>, session = runtimeRef.current.session) => {
    if (runtimeRef.current.session !== session) return
    frame.current?.contentWindow?.postMessage({applet: 1, session, ...payload}, '*')
  }, [])

  const initialize = useCallback(async () => {
    const current = runtimeRef.current
    if (!current.ready || current.loading || current.initialized) return
    current.loading = true
    setStorageError(null)
    try {
      const saved = await loadApplicationData({kind: 'applet', id: instance.id})
      if (runtimeRef.current !== current) return
      current.initialized = true
      post({k: 'init', saved, dark: darkRef.current, ...contextRef.current, viewport: viewportRef.current}, current.session)
    } catch (cause) {
      if (runtimeRef.current === current) setStorageError({kind: 'read', message: cause instanceof Error ? cause.message : String(cause)})
    } finally {current.loading = false}
  }, [instance.id, post])

  useEffect(() => {
    let active = true
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data as Message
      if (!message || message.applet !== 1 || message.session !== runtime.session || runtimeRef.current !== runtime) return
      const reply = (payload: Record<string, unknown>) => {
        if (active) post(payload, runtime.session)
      }
      switch (message.k) {
        case 'ready':
          runtime.ready = true
          void initialize()
          break
        case 'view':
          if (runtime.initialized) setTree(message.tree as UiNode)
          break
        case 'error':
          setError(String(message.message ?? '未知错误').slice(0, 500))
          break
        case 'storage-error':
          if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id <= runtime.latestSave) return
          runtime.latestSave = message.id
          setStorageError({kind: 'write', message: String(message.message ?? '数据无法保存').slice(0, 500)})
          setSaving(false)
          break
        case 'save': {
          if (!runtime.initialized || typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id <= 0) return
          const id = message.id
          let operation = runtime.pending.get(id)
          if (!operation) {
            // 已完成或迟到的旧序号不能把旧快照写回；重复进行中请求共享确认。
            if (id <= runtime.latestSave) return
            runtime.latestSave = id
            setSaving(true)
            setStorageError(null)
            operation = replaceApplicationData({kind: 'applet', id: instance.id}, message.data)
            runtime.pending.set(id, operation)
            void operation.finally(() => runtime.pending.delete(id)).catch(() => undefined)
          }
          operation.then(() => {
            reply({k: 'save-reply', id})
            if (active && runtimeRef.current === runtime && id === runtime.latestSave) {setSaving(false); setStorageError(null)}
          }, cause => {
            const message = cause instanceof Error ? cause.message : String(cause)
            reply({k: 'save-reply', id, error: message})
            if (active && runtimeRef.current === runtime && id === runtime.latestSave) {setSaving(false); setStorageError({kind: 'write', message})}
          })
          break
        }
        case 'call':
          if (!runtime.initialized || typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id <= runtime.latestCall) return
          runtime.latestCall = message.id
          handleCall(message, hostRef.current).then(
            result => reply({k: 'reply', id: message.id, result}),
            cause => reply({k: 'reply', id: message.id, error: cause instanceof Error ? cause.message : String(cause)}),
          )
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => {active = false; window.removeEventListener('message', onMessage)}
  }, [initialize, instance.id, post, runtime])

  // 全局重试完成后仍向当前运行确认最新快照，不能留下过期的局部失败提示。
  useEffect(() => {
    const read = persistenceErrors.some(item => item.source === `application-read:applet:${instance.id}`)
    const write = persistenceErrors.some(item => item.source === `application-write:applet:${instance.id}`)
    const previous = previousStorageFailure.current
    previousStorageFailure.current = {read, write}
    if (previous.read && !read && storageError?.kind === 'read') void initialize()
    if (previous.write && !write && storageError?.kind === 'write') post({k: 'retry-save'})
  }, [initialize, instance.id, persistenceErrors, post, storageError])

  useEffect(() => {
    post({k: 'dark', dark})
  }, [dark, post])
  useEffect(() => {
    post({k: 'context', ...contextRef.current})
  }, [contextKey, post])
  useEffect(() => {
    post({k: 'viewport', viewport: viewportRef.current})
  }, [width, post])

  const fire = useCallback((fn: number, payload?: unknown) => post({k: 'event', fn, payload}), [post])

  return (
    <Flexbox ref={container} className="page-pane applet" gap={12} style={{minWidth: 0, maxWidth: '100%'}}>
      {/* 逻辑沙盒：看不见，只跑脚本 */}
      <iframe key={runtime.session} ref={frame} title={`${instance.title || '小程序'}（逻辑）`} className="applet-runner" sandbox="allow-scripts" referrerPolicy="no-referrer" {...sandboxFrameProps(srcdoc, runtime.session)} aria-hidden tabIndex={-1} />

      {error && (
        <Flexbox className="applet-error" gap={8} role="alert">
          <Flexbox horizontal align="center" gap={8}>
            <Tag color="red" variant="borderless">
              运行出错
            </Tag>
            <Text fontSize={12} type="secondary" style={{flex: 1, wordBreak: 'break-all'}}>
              {error}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <Button size="small" icon={<Wand2 size={14} />} onClick={() => host.ask(`小程序「${instance.title || instance.id}」（id=${instance.id}）运行出错：${error}\n请先 list_applications({ref:"${instance.id}"}) 读取完整源码，再用 update_applet 修好。`)}>
              让搭搭修复
            </Button>
            <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={() => setRun((n) => n + 1)}>
              重新运行
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      {storageError && (
        <Flexbox gap={8} role="alert">
          <Text fontSize={13}>{storageError.kind === 'read' ? '无法读取应用数据' : '更改尚未保存'}：{storageError.message}</Text>
          <Button size="small" onClick={() => storageError.kind === 'read' ? void initialize() : post({k: 'retry-save'})}>
            {storageError.kind === 'read' ? '重新读取' : '重试保存'}
          </Button>
        </Flexbox>
      )}
      {saving && <Text type="secondary" fontSize={12} role="status">正在保存…</Text>}
      {tree ? <UiTree node={tree} fire={fire} /> : !error && !storageError && <Text type="secondary" fontSize={13}>正在启动…</Text>}
    </Flexbox>
  )
}

registerComponent<AppletConfig>({
  type: 'applet',
  name: '小程序',
  description:
    '有交互的小工具：逻辑是 AI 写的 JavaScript，界面用系统自带的控件（按钮、输入框、开关、滑块、选择器、标签、统计、柱状图、趋势折线、表格、可筛选分页的记录列表…）拼出来，风格和主页一致、深浅色自动适配、点击输入都可靠。适合计算器、生成器、记账、待办、换算、抽签、问卷、小看板。游戏、Canvas/WebGL 或需要完全自定义视觉的才用沙盒应用(app)。用 create_applet 创建，update_applet 修改。',
  category: 'content',
  defaultConfig: {source: "const {Stack, Text} = ui\napplet({\n  state: {},\n  view: () => Stack([Text({text: '你好，搭搭', size: 'lg'})]),\n})"},
  configSchema: {
    source: {kind: 'string', label: '脚本（ES module，调用 applet({...})）'},
    settings: {kind: 'json', label: '应用设置（由应用目录注入）'},
    surface: {kind: 'string', label: '运行形态（由宿主注入）'},
  },
  defaultSpan: 'half',
  component: Applet,
  multiple: true,
  normalize: (config) => ({...config, source: String(config.source ?? '').slice(0, 120_000)}),
})
