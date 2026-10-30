import {createProxyHandler} from '../server/proxy.mjs'

// Vercel Function 响应体上限低于常驻 Node 服务，预留平台头部/封装空间。
const proxy = createProxyHandler({maxBytes: 4 * 1024 * 1024})

/** Vercel 可能保留原 URL 或提供函数路径，统一到既有受控取数入口。 */
export default function handler(request, response) {
  const route = new URL(request.url ?? '/', 'http://proxy.local')
  route.pathname = '/__proxy'
  request.url = route.pathname + route.search
  return proxy(request, response)
}
