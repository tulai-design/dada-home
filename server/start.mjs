import {spawn} from 'node:child_process'
import {createProxyServer, PROXY_PORT} from './proxy.mjs'

// PID 1 owns the proxy and supervises nginx. Losing either stops the container.
const proxy = createProxyServer()
let nginx
let closing = false
let exitCode = 0

function stop(code = 0) {
  if (closing) return
  closing = true
  exitCode = code
  proxy.close()
  proxy.closeAllConnections()
  if (nginx?.pid && nginx.exitCode === null) nginx.kill('SIGTERM')
  else process.exit(exitCode)
  setTimeout(() => {
    nginx?.kill('SIGKILL')
    process.exit(exitCode || 1)
  }, 8000).unref()
}

proxy.on('error', (error) => {
  console.error('data-proxy:', error.message)
  stop(1)
})
proxy.on('close', () => {
  if (!closing) stop(1)
})
proxy.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`data-proxy: listening on 127.0.0.1:${PROXY_PORT}`)
  // Keep the official nginx entrypoint, including runtime config hooks.
  nginx = spawn('/docker-entrypoint.sh', ['nginx', '-g', 'daemon off;'], {stdio: 'inherit'})
  nginx.on('error', (error) => {
    console.error('nginx:', error.message)
    stop(1)
  })
  nginx.on('exit', (code) => {
    if (closing) process.exit(exitCode)
    stop(code || 1)
    process.exit(code || 1)
  })
})

process.on('SIGTERM', () => stop())
process.on('SIGINT', () => stop())
