import {useSyncExternalStore} from 'react'
import {extensionApi, setExtensionRequestPreparer} from './platform'
export {prepareExtensionRequest} from './platform'

export type ExtensionNetworkRequest = {id: string; origin: string; status: 'pending' | 'requesting'; error?: string}
type Waiter = {resolve: () => void; reject: (error: Error | DOMException) => void; cleanup: () => void}
type Pending = {view: ExtensionNetworkRequest; pattern: string; waiters: Set<Waiter>}
const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()
let snapshot: readonly ExtensionNetworkRequest[] = []
let installed = false
let sequence = 0
function emit() {
  snapshot = [...pending.values()].map(item => item.view)
  listeners.forEach(listener => listener())
}
export const getExtensionNetworkRequests = (): readonly ExtensionNetworkRequest[] => snapshot
export function useExtensionNetworkRequests(): readonly ExtensionNetworkRequest[] {
  return useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener)}}, getExtensionNetworkRequests, getExtensionNetworkRequests)
}
function settle(item: Pending, error?: Error) {
  if (pending.get(item.pattern) !== item) return
  pending.delete(item.pattern)
  for (const waiter of item.waiters) {waiter.cleanup(); if (error) waiter.reject(error); else waiter.resolve()}
  item.waiters.clear()
  emit()
}

/** 必须从点击处理器直接调用，不能在 permissions.request 前插入 await。 */
export async function approveExtensionNetworkRequest(id: string): Promise<void> {
  const api = extensionApi()
  const item = [...pending.values()].find(item => item.view.id === id)
  if (!api || !item || item.view.status === 'requesting') return
  let request: Promise<boolean>
  try {request = api.permissions.request({origins: [item.pattern]})}
  catch (error) {settle(item, new Error(error instanceof Error ? error.message : '浏览器未能请求网络权限')); return}
  item.view = {...item.view, status: 'requesting'}
  emit()
  try {
    if (!await request) {settle(item, new Error(`未允许连接 ${item.view.origin}`)); return}
    settle(item)
  } catch (error) {
    settle(item, new Error(`无法获得 ${item.view.origin} 的连接权限：${error instanceof Error ? error.message : String(error)}`))
  }
}
export function rejectExtensionNetworkRequest(id: string): void {
  const item = [...pending.values()].find(item => item.view.id === id)
  if (item) settle(item, new Error(`已取消连接 ${item.view.origin}`))
}

async function permission(url: URL, signal?: AbortSignal | null): Promise<void> {
  const api = extensionApi()
  if (!api) return
  signal?.throwIfAborted()
  // Chrome 的来源匹配不区分端口，显示也按实际授予的协议与主机范围呈现。
  const origin = `${url.protocol}//${url.hostname}`
  const pattern = `${origin}/*`
  if (await api.permissions.contains({origins: [pattern]})) {signal?.throwIfAborted(); return}
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    let item = pending.get(pattern)
    if (!item) {
      item = {pattern, view: {id: `network-${++sequence}`, origin, status: 'pending'}, waiters: new Set()}
      pending.set(pattern, item)
    }
    const current = item
    const remove = (error: Error | DOMException) => {
      waiter.cleanup()
      current.waiters.delete(waiter)
      if (!current.waiters.size && pending.get(pattern) === current) pending.delete(pattern)
      emit()
      reject(error)
    }
    const abort = () => remove(signal?.reason instanceof Error ? signal.reason : new DOMException('请求已取消', 'AbortError'))
    const timer = setTimeout(() => remove(new Error(`等待 ${origin} 的网络权限超时，请重新操作`)), 300_000)
    const waiter: Waiter = {resolve, reject, cleanup: () => {clearTimeout(timer); signal?.removeEventListener('abort', abort)}}
    current.waiters.add(waiter)
    signal?.addEventListener('abort', abort, {once: true})
    emit()
  })
}

function targetUrl(input: RequestInfo | URL): {url: URL; rewritten?: URL; request?: Request} {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
  const url = new URL(request?.url ?? String(input), location.href)
  let rewritten: URL | undefined
  if (url.protocol === location.protocol && url.host === location.host && /^\/__proxy\/?$/.test(url.pathname)) {
    const target = url.searchParams.get('url')
    if (!target) throw new Error('取数地址缺少目标 URL')
    rewritten = new URL(target)
    if (!['http:', 'https:'].includes(rewritten.protocol) || rewritten.username || rewritten.password) throw new Error('取数地址仅支持不含账号密码的 HTTP(S) URL')
  }
  const target = rewritten ?? url
  if (target.username || target.password) throw new Error('连接地址不能包含账号密码，请使用独立凭据配置')
  return {url: target, rewritten, request}
}

/** 网页仍使用原 fetch；扩展仅替换受信任主页中的 fetch，不向沙盒暴露任意 URL 代理。 */
export function installExtensionFetch(): void {
  if (installed || !extensionApi()) return
  installed = true
  const nativeFetch = globalThis.fetch.bind(globalThis)
  setExtensionRequestPreparer(async (input, signal) => {
    const {url, request} = targetUrl(input)
    if (['http:', 'https:'].includes(url.protocol)) await permission(url, signal ?? request?.signal)
  })
  globalThis.fetch = async (input, init) => {
    const {url, rewritten, request} = targetUrl(input)
    const external = ['http:', 'https:'].includes(url.protocol)
    if (external) await permission(url, init?.signal ?? request?.signal)
    const target = rewritten ? (request ? new Request(rewritten, request) : rewritten) : input
    // Fetch 不暴露跨源重定向的 Location，不能在发出下一跳前核对授权。
    // 保留显式 manual/error；默认 follow 改为拒绝并提示填写最终地址。
    const redirect = init?.redirect ?? request?.redirect ?? 'follow'
    const guardRedirect = external && redirect === 'follow'
    const response = await nativeFetch(target, guardRedirect ? {...init, redirect: 'manual'} : init)
    if (guardRedirect && response.type === 'opaqueredirect') {
      throw new Error('服务返回了重定向。为避免连接未经允许的来源，扩展已停止请求；请填写服务或订阅的最终地址后重试。')
    }
    return response
  }
}
