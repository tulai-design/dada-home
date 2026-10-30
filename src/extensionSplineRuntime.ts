import {Application} from '@splinetool/runtime'
import {isSplineUrl} from './fx/catalog'

const canvas = document.querySelector('canvas')!
let application: Application | undefined
let session = ''
let started = false
let disposed = false
const post = (kind: string, message?: string) => parent.postMessage({dadaSpline: 1, session, kind, message}, '*')
const fail = (error: unknown) => post('error', error instanceof Error ? error.message : String(error))
const resize = () => application?.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight))
const dispose = () => {disposed = true; application?.dispose(); application = undefined}

addEventListener('message', event => {
  const message = event.data
  if (event.source !== parent || started || message?.dadaSpline !== 1 || message.kind !== 'load' || typeof message.session !== 'string' || !message.session || typeof message.scene !== 'string' || !isSplineUrl(message.scene)) return
  started = true
  session = message.session
  try {
    application = new Application(canvas, {renderMode: 'auto'})
    resize()
    void application.load(message.scene).then(() => {if (!disposed) {resize(); post('loaded')}}, fail)
  } catch (error) {fail(error)}
})
addEventListener('resize', resize)
addEventListener('pagehide', dispose, {once: true})
addEventListener('error', event => {if (session) fail(event.error ?? event.message)})
addEventListener('unhandledrejection', event => {if (session) fail(event.reason)})
