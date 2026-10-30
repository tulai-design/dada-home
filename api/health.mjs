import {createProxyHandler} from '../server/proxy.mjs'

const proxy = createProxyHandler()

export default function handler(request, response) {
  request.url = '/healthz'
  return proxy(request, response)
}
