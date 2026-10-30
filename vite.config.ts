import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {resolve} from 'node:path'

let startupChunks: {url:string;size:number}[] = []
/** 多入口可能重分公共块，按实际静态依赖闭包缓存，不依赖Rollup自动命名。 */
function collectStartupChunks(): Plugin {
  return {name:'dada-startup-chunks',generateBundle(_options,bundle){
    const files=new Set<string>()
    const visit=(file:string)=>{
      if(files.has(file))return
      const chunk=bundle[file]
      if(!chunk || chunk.type!=='chunk')return
      files.add(file);chunk.imports.forEach(visit)
    }
    for(const chunk of Object.values(bundle))if(chunk.type==='chunk' && (chunk.isEntry || ['App','incrementalClient','syncService'].includes(chunk.name)))visit(chunk.fileName)
    startupChunks=[...files].map(url=>({url,size:Buffer.byteLength(bundle[url].type==='chunk'?bundle[url].code:'')}))
  }}
}

/** 转发这些请求头；其余一律丢弃，避免把浏览器的 cookie 带到目标站。 */
const FORWARD_HEADERS = ['authorization', 'content-type', 'accept']

/**
 * 开发期 CORS 代理：/__proxy?url=<encoded>
 * 纯前端页面直接请求 RSS / 监控接口会被浏览器拦住，开发时由这里转一手。
 * 生产构建后请把设置里的「取数代理」指向你自己的转发服务。
 */
function devProxy(): Plugin {
  return {
    name: 'first-page-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req: IncomingMessage, res: ServerResponse) => {
        const raw = req.url ?? ''
        const target = new URL(raw, 'http://localhost').searchParams.get('url')
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('access-control-allow-headers', '*')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (!target) {
          res.statusCode = 400
          res.end('missing url')
          return
        }
        let parsed: URL
        try {
          parsed = new URL(target)
        } catch {
          res.statusCode = 400
          res.end('bad url')
          return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.statusCode = 400
          res.end('only http(s)')
          return
        }

        const headers: Record<string, string> = {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
        }
        for (const name of FORWARD_HEADERS) {
          const value = req.headers[name]
          if (typeof value === 'string' && value) headers[name] = value
        }

        let body: BodyInit | undefined
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks) as unknown as BodyInit
        }

        try {
          const upstream = await fetch(parsed, {
            method: req.method ?? 'GET',
            headers,
            body,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          })
          const payload = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          const type = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8'
          res.setHeader('content-type', type)
          if (type.includes('application/json')) res.setHeader('cache-control', 'no-store')
          res.end(payload)
        } catch (err) {
          res.statusCode = 502
          res.end(err instanceof Error ? err.message : 'upstream failed')
        }
      })
    },
  }
}

/**
 * PWA：可以「安装到桌面/主屏幕」，打开不依赖网络。
 * 只缓存应用本身（页面、脚本、样式、图标）。
 * 取数代理、运行时配置、各家 AI 和数据接口一律走网络，不进缓存，免得读到过期的数据。
 * 更新方式用 prompt：新版本下载好后提示用户点「刷新」，不会在对方正用着的时候突然换版本。
 */
function pwa() {
  return VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.ico', 'brand/apple-touch-icon.png'],
    manifest: {
      id: '/',
      name: '搭搭 · tulai.design',
      short_name: '搭搭',
      description: '陪你把想法，搭成自己的主页。',
      lang: 'zh-CN',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#f3efe4',
      theme_color: '#f3efe4',
      categories: ['productivity', 'personalization'],
      icons: [
        { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/brand/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // 预缓存包含延后初始化的 App 及其静态同步依赖，保证离线仍能启动。
      // 其余懒加载的块（代码高亮语言包、Spline、物理引擎等加起来 20MB 以上）不预下载，
      // 用到哪个、缓存哪个（见下面的 runtimeCaching），首次安装才不会吃掉一大笔流量。
      globPatterns: ['index.html', 'theme-preview.html', 'manifest.webmanifest', 'favicon.ico', 'brand/*.{png,webp}', 'assets/*.css', 'assets/index-*.js', 'assets/themePreview-*.js', 'assets/App-*.js', 'assets/incrementalClient-*.js', 'assets/syncService-*.js', 'assets/virtual_pwa-register-*.js', 'assets/workbox-window*.js'],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/__proxy/, /^\/healthz/, /^\/config\.js/, /^\/privacy/, /^\/theme-preview\.html/],
      cleanupOutdatedCaches: true,
      manifestTransforms: [async entries=>{
        const urls=new Set(entries.map(entry=>entry.url))
        return {manifest:[...entries,...startupChunks.filter(entry=>!urls.has(entry.url)).map(entry=>({...entry,revision:null}))],warnings:[]}
      }],
      clientsClaim: false,
      skipWaiting: false,
      runtimeCaching: [
        { urlPattern: ({ url }) => url.pathname === '/config.js', handler: 'NetworkOnly' },
        { urlPattern: ({ url }) => url.pathname.startsWith('/__proxy'), handler: 'NetworkOnly' },
        {
          // 主题引入的 Google Fonts：样式表允许稍旧，字体文件内容不变，缓存优先；缓存过的字体离线也能用
          urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'dada-font-css', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
        },
        {
          urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
          handler: 'CacheFirst',
          options: { cacheName: 'dada-font-files', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
        },
        {
          // 带哈希的构建产物内容永远不变，缓存优先
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'dada-assets',
            expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  })
}

export default defineConfig(({mode}) => ({
  plugins: [react(), devProxy(), collectStartupChunks(), ...(mode === 'extension' ? [] : [pwa()])],
  // 扩展公共资源由打包脚本筛选复制，避免把下载 ZIP 再装进自身。
  build: {
    ...(mode === 'extension' ? {outDir: 'dist-extension', copyPublicDir: false} : {}),
    rollupOptions: {input: {index: resolve(import.meta.dirname,'index.html'), themePreview: resolve(import.meta.dirname,'theme-preview.html')}},
  },
  server: { port: 5173, host: true },
}))
