import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Flexbox, Tag, Text} from '@lobehub/ui'
import {MagicWand as Wand2} from '@phosphor-icons/react'
import {useDark} from '../fx/Fx'
import {checkUrl} from '../lib/customWidget'
import {proxied} from '../lib/rss'
import {loadApplicationData, setApplicationValue} from '../lib/applicationData'
import {sandboxFrameProps} from '../lib/extensionSandbox'
import {prepareExtensionRequest} from '../lib/platform'
import {registerComponent, type ComponentHost, type ComponentProps} from '../lib/registry'

/**
 * 沙盒应用：AI 写的 HTML / CSS / JS，在隔离的 iframe 里运行。
 *
 * 这是给 AI 的「最大自由度」档位。它能做声明式组件和素材库做不到的事：
 * 小游戏、自定义图表、Three.js 场景、番茄钟、任何你想得到的小工具。
 *
 * 安全不靠信任 AI，靠浏览器强制的三道墙：
 *  1. iframe sandbox="allow-scripts"，没有 allow-same-origin ——
 *     应用拿到的是「不透明源」，读不到主页的 localStorage、cookie、DOM，也无法导航顶层页面。
 *  2. 页面内 CSP：脚本只能来自 esm.sh / jsdelivr / unpkg；
 *     图片、媒体、网络只能连用户已授权的域名。
 *  3. 能力走 postMessage 桥（tada.*）：取数要过域名授权，存储按实例隔离并限额。
 */

type AppConfig = {
  html: string
  css: string
  js: string
  height: number
  settings?: Record<string, unknown>
  surface?: string
}

const ESM_HOSTS = 'https://esm.sh https://cdn.jsdelivr.net https://unpkg.com'

/** 把主题里的关键变量快照进应用，让它天然和主页同一套视觉。 */
const THEME_VARS = [
  '--bg', '--bg2', '--bg3', '--text', '--text2', '--text3', '--text4', '--border', '--main',
  '--c-red', '--c-green', '--c-blue', '--c-amber', '--c-violet', '--radius', '--radius-lg', '--rule', '--font-sans', '--font-serif', '--font-mono',
]

function themeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(THEME_VARS.map((name) => [name, style.getPropertyValue(name).trim()]))
}

function themeCss(): string {
  return Object.entries(themeVariables()).map(([name, value]) => `${name}:${value}`).join(';')
}

/** 迷你样式套件：应用不写 CSS 也能和主页长得一家人。 */
const KIT = `
*{box-sizing:border-box;min-width:0}
html,body{margin:0;height:100%;background:transparent;color:var(--text);font:14px/1.6 var(--font-sans);-webkit-font-smoothing:antialiased}
body{padding:16px;overflow-wrap:anywhere}
h1,h2,h3{font-family:var(--font-serif);font-weight:600;margin:0 0 .4em;line-height:1.2}
a{color:var(--main);text-decoration:none}
.kicker{font:500 11px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--text3)}
.muted{color:var(--text2)}
.mono{font-family:var(--font-mono)}
.serif{font-family:var(--font-serif)}
.card{padding:12px 0;border:0;background:transparent}
.row{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.row>*{max-width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px}
.table-wrap{max-width:100%;overflow:auto;overscroll-behavior-x:contain}
img,video,canvas,svg{max-width:100%}img,video{height:auto}
pre{max-width:100%;overflow:auto}
.btn{font:inherit;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text);padding:6px 14px;border-radius:var(--radius,0);transition:.15s}
.btn:hover{background:var(--text);color:var(--bg)}
.btn.primary{background:var(--text);border-color:var(--text);color:var(--bg)}
input,textarea,select{max-width:100%;font:inherit;color:var(--text);background:transparent;border:1px solid var(--border);padding:6px 10px;border-radius:var(--radius,0)}
:where(button,a,input,textarea,select,[tabindex]):focus-visible{outline:2px solid var(--main);outline-offset:2px}
input[type=checkbox],input[type=radio],input[type=range]{accent-color:var(--main)}
button{max-width:100%;font:inherit;color:var(--text);cursor:pointer}
:disabled{cursor:not-allowed;opacity:.5}
@media(max-width:480px){body{padding:12px}.row{gap:8px}.btn,input,select{min-height:40px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
::selection{background:color-mix(in srgb,var(--main) 25%,transparent)}
`

/** 注入应用内的 SDK。window.tada 是应用与主页对话的唯一通道。 */
const SDK = `
(()=>{
  const freeze=(v)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
  const context=freeze(__APPLICATION_CONTEXT__);
  const themeNames=__THEME_NAMES__;
  const session=__SESSION__;
  const pending=new Map();let seq=0;
  const call=(op,payload)=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});
    parent.postMessage({tada:1,session,id,op,...payload},'*');
    /* 取数可能先等用户确认域名，给授权操作留出时间。 */
    setTimeout(()=>{if(pending.delete(id))reject(new Error('tada.'+op+' 超时'))},op==='fetch'?300000:15000);
  });
  addEventListener('message',(e)=>{
    if(e.source!==parent)return;
    const m=e.data;if(!m||m.tada!==1||m.session!==session)return;
    if(m.op==='theme'){
      const root=document.documentElement;
      for(const name of themeNames){const value=m.variables&&m.variables[name];if(typeof value==='string')root.style.setProperty(name,value)}
      root.dataset.theme=m.dark?'dark':'light';
      root.style.colorScheme=m.dark?'dark':'light';
      dispatchEvent(new CustomEvent('tada:themechange',{detail:{dark:!!m.dark}}));
      return;
    }
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);
    m.error?p.reject(new Error(m.error)):p.resolve(m.result);
  });
  /* 沙盒里没有 localStorage 和剪贴板权限，AI 常会顺手用到而直接崩掉：给不会崩的替身 */
  const memory=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:k=>{m.delete(k)},clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};
  for(const name of ['localStorage','sessionStorage']){
    try{window[name].getItem('x')}catch{try{Object.defineProperty(window,name,{value:memory(),configurable:true})}catch{}}
  }
  try{Object.defineProperty(navigator,'clipboard',{value:{writeText:(t)=>call('copy',{text:String(t)})},configurable:true})}catch{}
  /* 运行出错不再是一片空白：告诉主页，由主页显示并提供「让搭搭修复」 */
  const report=(e)=>{const msg=(e&&e.message)||String(e);parent.postMessage({tada:1,session,id:0,op:'error',message:msg},'*')};
  addEventListener('error',(e)=>report(e.error||e.message));
  addEventListener('unhandledrejection',(e)=>report(e.reason));
  window.tada={
    /** 本应用私有的 IndexedDB 存储；set 在事务提交后成功，失败 reject */
    store:{get:(key)=>call('get',{key}),set:(key,value)=>call('set',{key,value})},
    /** 取数。url 的域名必须已被用户授权；返回 {ok,status,text,json} */
    fetch:(url)=>call('fetch',{url}),
    /** 新标签页打开 https 链接 */
    open:(url)=>call('open',{url}),
    /** 复制文字到剪贴板（navigator.clipboard.writeText 也已接到这里） */
    copy:(text)=>call('copy',{text:String(text)}),
    /** 把一句话发给搭搭的 AI 助手 */
    ask:(text)=>call('ask',{text}),
    get dark(){return document.documentElement.dataset.theme==='dark'},
    get settings(){return context.settings},
    get surface(){return context.surface},
  };
})();
`

function hostList(grants: string[]): string[] {
  return grants.filter((host) => /^[a-z0-9.-]+$/.test(host)).map((host) => `https://${host}`)
}

export function buildSrcdoc(config: AppConfig, grants: string[], dark: boolean, session = ''): string {
  const granted = hostList(grants).join(' ')
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${ESM_HOSTS}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com data:',
    `img-src data: blob: https://images.unsplash.com ${granted}`.trim(),
    `media-src data: blob: ${granted}`.trim(),
    // 应用没有直连网络的权利：取数一律走 tada.fetch，由主页校验授权
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
  // JSON 只能作为数据进入脚本，不能由设置里的 </script> 提前闭合标签。
  const context = JSON.stringify({settings: config.settings ?? {}, surface: config.surface ?? 'widget'}).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const sdk = SDK.replace('__THEME_NAMES__', () => JSON.stringify(THEME_VARS)).replace('__APPLICATION_CONTEXT__', () => context).replace('__SESSION__', () => JSON.stringify(session))
  // 用户代码放在后面：SDK 和样式套件先就位
  return `<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root{${themeCss()};color-scheme:${dark ? 'dark' : 'light'}}${KIT}${config.surface === 'status' ? 'html,body{height:100%;overflow:hidden}body{padding:0}.btn,input,select{min-height:0}' : ''}</style>
<style>${config.css}</style>
<script>${sdk}</script>
</head><body>${config.html}
<script type="module">${config.js.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`
}

type Request = {tada: 1; id: number; op: string; [key: string]: unknown}

/** 取数：域名必须已授权，未授权会向用户发起授权请求。沙盒应用和小程序共用。 */
export async function bridgeFetch(url: string, host: ComponentHost): Promise<{ok: boolean; status: number; text: string; json: unknown}> {
  const check = checkUrl(url)
  if (!check.ok) throw new Error(check.reason)
  if (!host.networkGrants.includes(check.host)) {
    const approved = await host.requestNetworkGrant(check.host)
    if (!approved) throw new Error(`未允许访问 ${check.host}，请求已取消`)
  }
  const target = proxied(check.url, host.proxy)
  const preparing = prepareExtensionRequest(target)
  if (preparing) await preparing
  // 授权等待与实际请求分开计时，读取响应体也受 15 秒限制。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  let res: Response
  let text: string
  try {
    res = await fetch(target, {signal: controller.signal})
    text = (await res.text()).slice(0, 1_000_000)
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('请求超时（15 秒），请稍后重试')
    throw cause
  } finally {
    clearTimeout(timeout)
  }
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // 不是 JSON 就只给文本
  }
  return {ok: res.ok, status: res.status, text, json}
}

/** 复制到剪贴板：优先 Clipboard API，不行再退回到临时文本框。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

async function handle(request: Request, instanceId: string, host: ComponentHost): Promise<unknown> {
  const ref = {kind: 'app' as const, id: instanceId}
  switch (request.op) {
    case 'get': {
      const key = String(request.key ?? '')
      const data = await loadApplicationData(ref)
      return Object.hasOwn(data, key) ? data[key] : null
    }
    case 'set': {
      const key = String(request.key ?? '')
      if (!/^[\w.-]{1,64}$/.test(key)) throw new Error('键名只能是字母数字和 _ . -，最长 64 位')
      await setApplicationValue(ref, key, request.value)
      return true
    }
    case 'fetch':
      return bridgeFetch(String(request.url ?? ''), host)
    case 'copy': {
      if (!(await copyText(String(request.text ?? '')))) throw new Error('浏览器拒绝了复制')
      return true
    }
    case 'open': {
      const url = String(request.url ?? '')
      if (!/^https:\/\//i.test(url)) throw new Error('只能打开 https 链接')
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    }
    case 'ask': {
      host.ask(String(request.text ?? '').slice(0, 2000))
      return true
    }
    default:
      throw new Error(`未知操作：${request.op}`)
  }
}

function AppBlock({instance, config, host}: ComponentProps<AppConfig>) {
  const frame = useRef<HTMLIFrameElement>(null)
  const dark = useDark()
  const hostRef = useRef(host)
  hostRef.current = host

  const [error, setError] = useState('')
  const documentRef = useRef<{config: AppConfig; dark: boolean; grants: string[]; instanceId: string; session: string; latestRequest: number; pending: Map<number, Promise<unknown>>} | null>(null)
  const previous = documentRef.current
  // 新授权直接供 tada.fetch 使用，保留当前文档与待完成的请求。
  // 图片、媒体的 CSP 使用文档快照：重新挂载或修改源码后才加入新域名；
  // 已写入 CSP 的域名一旦撤销，则立即重建文档以收紧权限。
  if (!previous || previous.instanceId !== instance.id || previous.config.html !== config.html || previous.config.css !== config.css || previous.config.js !== config.js || JSON.stringify(previous.config.settings) !== JSON.stringify(config.settings) || previous.config.surface !== config.surface || previous.grants.some((grant) => !host.networkGrants.includes(grant))) {
    documentRef.current = {config: {...config}, dark, grants: [...host.networkGrants], instanceId: instance.id, session: crypto.randomUUID(), latestRequest: 0, pending: new Map()}
  }
  const appDocument = documentRef.current!
  const srcdoc = useMemo(
    () => buildSrcdoc(appDocument.config, appDocument.grants, appDocument.dark, appDocument.session),
    [appDocument],
  )
  useEffect(() => setError(''), [config.html, config.css, config.js])

  // 主题是宿主上下文，不重启用户程序：同一明暗模式下换颜色/字体也同步。
  const syncTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({tada: 1, session: documentRef.current?.session, op: 'theme', variables: themeVariables(), dark: document.documentElement.dataset.theme === 'dark'}, '*')
  }, [])
  useEffect(() => {
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['style', 'data-theme']})
    syncTheme()
    return () => observer.disconnect()
  }, [syncTheme])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // 只信任自己这个 iframe 发来的消息
      if (event.source !== frame.current?.contentWindow) return
      const request = event.data as Request
      const requestDocument = documentRef.current
      if (!requestDocument || !request || request.tada !== 1 || request.session !== requestDocument.session || !Number.isSafeInteger(request.id) || request.id < 0) return
      if (request.op === 'error') {
        setError(String(request.message ?? '未知错误').slice(0, 500))
        return
      }
      const reply = (payload: {result?: unknown; error?: string}) => {
        // 源码或权限变化已重建文档时，旧请求不能回复到新一轮同编号调用。
        if (documentRef.current !== requestDocument) return
        frame.current?.contentWindow?.postMessage({tada: 1, session: requestDocument.session, id: request.id, ...payload}, '*')
      }
      // 重复或迟到的请求不得重新执行写入；同一进行中请求共享结果。
      let operation = requestDocument.pending.get(request.id)
      if (!operation) {
        if (request.id <= requestDocument.latestRequest) return
        requestDocument.latestRequest = request.id
        operation = handle(request, instance.id, hostRef.current)
        requestDocument.pending.set(request.id, operation)
        void operation.finally(() => requestDocument.pending.delete(request.id)).catch(() => undefined)
      }
      operation.then(
        (result) => reply({result}),
        (error: Error) => reply({error: error.message}),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [instance.id])

  return (
    <>
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
          <Flexbox horizontal>
            <Button size="small" icon={<Wand2 size={14} />} onClick={() => host.ask(`沙盒应用「${instance.title || instance.id}」（id=${instance.id}）运行出错：${error}\n请先用 list_applications（ref: ${instance.id}）读取源码，再用 update_app 修好。`)}>
              让搭搭修复
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      <iframe
        key={appDocument.session}
        ref={frame}
        className="app-frame"
        title={instance.title || '应用'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        {...sandboxFrameProps(srcdoc, appDocument.session, syncTheme)}
        style={{height: config.surface === 'status' ? '100%' : config.height}}
      />
    </>
  )
}

registerComponent<AppConfig>({
  type: 'app',
  name: '沙盒应用',
  description:
    '最大自由度：用 HTML/CSS/JS 写一个完整的小应用（小游戏、自定义图表、Three.js/Canvas 场景、计时器、任何工具）。运行在隔离沙盒里，不会影响主页。用 create_app 创建，update_app 修改。优先考虑素材库（list_effects）、声明式组件（create_widget）和小程序（create_applet，用系统控件搭交互工具），它们做不到时再用这个；适合游戏、Canvas/WebGL 和需要完全自定义视觉的东西。',
  category: 'content',
  defaultConfig: {
    html: '<h2>你好，搭搭</h2><p class="muted">这是一个沙盒应用。</p>',
    css: '',
    js: '',
    height: 320,
  },
  configSchema: {
    html: {kind: 'string', label: 'body 内的 HTML'},
    css: {kind: 'string', label: 'CSS'},
    js: {kind: 'string', label: 'JavaScript（ES module，可 import https://esm.sh/...）'},
    height: {kind: 'number', label: '高度 px', min: 120, max: 900},
    settings: {kind: 'json', label: '应用设置（由应用目录注入）'},
    surface: {kind: 'string', label: '运行形态（由宿主注入）'},
  },
  defaultSpan: 'half',
  component: AppBlock,
  multiple: true,
  normalize: (config) => ({
    ...config,
    html: String(config.html ?? '').slice(0, 60_000),
    css: String(config.css ?? '').slice(0, 60_000),
    js: String(config.js ?? '').slice(0, 120_000),
  }),
})
