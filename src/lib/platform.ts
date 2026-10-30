/** 只声明本应用使用的扩展 API；网页和隔离沙盒不能借此获得扩展身份。 */
export type ExtensionTab = {id?: number; windowId: number; url?: string}
export type ExtensionApi = {
  runtime: {
    id: string
    getURL: (path: string) => string
    sendMessage: <T = unknown>(message: unknown) => Promise<T>
  }
  permissions: {
    contains: (permissions: {origins: string[]}) => Promise<boolean>
    request: (permissions: {origins: string[]}) => Promise<boolean>
    remove: (permissions: {origins: string[]}) => Promise<boolean>
  }
  tabs: {
    getCurrent: () => Promise<ExtensionTab | undefined>
    update: (id: number, changes: {active: boolean}) => Promise<ExtensionTab>
  }
  windows: {update: (id: number, changes: {focused: boolean}) => Promise<unknown>}
}

export function extensionApi(): ExtensionApi | undefined {
  const api = (globalThis as typeof globalThis & {chrome?: ExtensionApi}).chrome
  if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:' || !api?.runtime?.id) return undefined
  return api
}

export function isExtension(): boolean {
  return Boolean(extensionApi())
}

type RequestPreparer = (input: RequestInfo | URL, signal?: AbortSignal | null) => Promise<void>
let requestPreparer: RequestPreparer | undefined

/** 启动时接入扩展网络层；底层取数模块不依赖 React 或浏览器 UI。 */
export function setExtensionRequestPreparer(prepare: RequestPreparer): void {
  requestPreparer = prepare
}

/** 在业务请求超时开始之前等待用户授权；Web 环境不改变请求路径。 */
export function prepareExtensionRequest(input: RequestInfo | URL, signal?: AbortSignal | null): Promise<void> | undefined {
  return requestPreparer?.(input, signal)
}
