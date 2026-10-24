import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Flexbox, Tag, Text, toast} from '@lobehub/ui'
import {RotateCcw, Wand2} from 'lucide-react'
import {useDark} from '../fx/Fx'
import {buildRunnerDoc} from '../lib/applet/runner'
import {UiTree, type UiNode} from '../lib/applet/render'
import {readStored, writeStored} from '../lib/store'
import {registerComponent, type ComponentHost, type ComponentProps} from '../lib/registry'
import {bridgeFetch, copyText} from './app'

/**
 * 小程序：AI 写逻辑，系统控件出界面。
 *
 * 和「沙盒应用」(app) 的区别：app 把整个页面（HTML/CSS）交给 iframe，自由但风格难统一、原生控件难看；
 * 小程序只把「逻辑」交给沙盒，界面由主页用 Lobe UI 真实渲染，所以样式一致、交互可靠，逻辑照样自由。
 */

type AppletConfig = {source: string}

const MAX_STORE = 100_000

type Message = {applet: 1; k: string; [key: string]: unknown}

async function handleCall(message: Message, host: ComponentHost, storeKey: string): Promise<unknown> {
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
      void storeKey
      throw new Error(`未知操作：${String(message.op)}`)
  }
}

function Applet({instance, config, host}: ComponentProps<AppletConfig>) {
  const frame = useRef<HTMLIFrameElement>(null)
  const dark = useDark()
  const darkRef = useRef(dark)
  darkRef.current = dark
  const hostRef = useRef(host)
  hostRef.current = host

  const [tree, setTree] = useState<UiNode | null>(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState(0)
  const storeKey = `applet.${instance.id}`

  const srcdoc = useMemo(
    () => buildRunnerDoc(config.source),
    // run 变化 = 用户点了「重新运行」
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.source, run],
  )

  // 源码变了就是一次全新的运行
  useEffect(() => {
    setTree(null)
    setError('')
  }, [srcdoc])

  const post = useCallback((payload: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({applet: 1, ...payload}, '*')
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // 只信任自己这个沙盒发来的消息
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data as Message
      if (!message || message.applet !== 1) return
      switch (message.k) {
        case 'ready':
          post({k: 'init', saved: readStored<Record<string, unknown>>(storeKey, {}), dark: darkRef.current})
          break
        case 'view':
          setTree(message.tree as UiNode)
          break
        case 'error':
          setError(String(message.message ?? '未知错误').slice(0, 500))
          break
        case 'save': {
          const text = JSON.stringify(message.data ?? {})
          if (text.length > MAX_STORE) setError('存储超过 100KB 上限，新的改动没有保存')
          else writeStored(storeKey, message.data ?? {})
          break
        }
        case 'call':
          handleCall(message, hostRef.current, storeKey).then(
            (result) => post({k: 'reply', id: message.id, result}),
            (cause: Error) => post({k: 'reply', id: message.id, error: cause.message}),
          )
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [post, storeKey])

  useEffect(() => {
    post({k: 'dark', dark})
  }, [dark, post])

  const fire = useCallback((fn: number, payload?: unknown) => post({k: 'event', fn, payload}), [post])

  return (
    <Flexbox className="page-pane applet" gap={12}>
      {/* 逻辑沙盒：看不见，只跑脚本 */}
      <iframe ref={frame} title={`${instance.title || '小程序'}（逻辑）`} className="applet-runner" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcdoc} aria-hidden tabIndex={-1} />

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
            <Button size="small" icon={<Wand2 size={14} />} onClick={() => host.ask(`小程序「${instance.title || instance.id}」（id=${instance.id}）运行出错：${error}\n请先 get_workspace 看一下它的源码，用 update_applet 修好。`)}>
              让搭搭修复
            </Button>
            <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={() => setRun((n) => n + 1)}>
              重新运行
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      {tree ? <UiTree node={tree} fire={fire} /> : !error && <Text type="secondary" fontSize={13}>正在启动…</Text>}
    </Flexbox>
  )
}

registerComponent<AppletConfig>({
  type: 'applet',
  name: '小程序',
  description:
    '有交互的小工具：逻辑是 AI 写的 JavaScript，界面用系统自带的控件（按钮、输入框、开关、滑块、选择器、标签、统计、柱状图、表格…）拼出来，风格和主页一致、深浅色自动适配、点击输入都可靠。适合计算器、生成器、记账、待办、换算、抽签、问卷、小看板。游戏、Canvas/WebGL 或需要完全自定义视觉的才用沙盒应用(app)。用 create_applet 创建，update_applet 修改。',
  category: 'content',
  defaultConfig: {source: "const {Stack, Text} = ui\napplet({\n  state: {},\n  view: () => Stack([Text({text: '你好，搭搭', size: 'lg'})]),\n})"},
  configSchema: {
    source: {kind: 'string', label: '脚本（ES module，调用 applet({...})）'},
  },
  defaultSpan: 'half',
  component: Applet,
  multiple: true,
  normalize: (config) => ({...config, source: String(config.source ?? '').slice(0, 120_000)}),
})
