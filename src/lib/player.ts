import {useSyncExternalStore} from 'react'
import {SHARED, readData, writeData} from './componentData'
import {readStored, writeStored, uid} from './store'

/**
 * 音乐播放。
 *
 * 播放器是模块级的单例：只有一个 <audio>，切页面、组件卸载都不会断。
 * 曲目只存「地址」，不存音频文件本身 —— 可以是直链音频、网络电台，
 * 也可以是 noise:white 这样的内置白噪音（用 WebAudio 现场生成，不需要任何文件）。
 * 系统的媒体键、锁屏界面通过 Media Session 接上。
 */

export type Track = {id: string; title: string; url: string; note?: string}
export type PlayMode = 'list' | 'one' | 'shuffle'
export const MODE_LABEL: Record<PlayMode, string> = {list: '列表循环', one: '单曲循环', shuffle: '随机播放'}

export type PlayerState = {
  trackId?: string
  playing: boolean
  loading: boolean
  error?: string
  /** 秒；电台和噪音没有时长，为 0 */
  position: number
  duration: number
  volume: number
  mode: PlayMode
}

/** 内置预设：一键加进列表。 */
export const PRESETS: Omit<Track, 'id'>[] = [
  {title: '白噪音', url: 'noise:white', note: '均匀的沙沙声，盖住环境噪音'},
  {title: '粉红噪音', url: 'noise:pink', note: '更柔和，类似雨声和风声'},
  {title: '棕色噪音', url: 'noise:brown', note: '低沉，类似远处的瀑布和雷声'},
  {title: 'SomaFM · Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3', note: '舒缓的氛围电子 / 低速节拍'},
  {title: 'SomaFM · Drone Zone', url: 'https://ice1.somafm.com/dronezone-128-mp3', note: '空灵的氛围音，几乎没有节拍，适合专注'},
  {title: 'SomaFM · Deep Space One', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', note: '深空氛围'},
  {title: 'SomaFM · Lush', url: 'https://ice1.somafm.com/lush-128-mp3', note: '柔和的女声电子'},
  {title: 'SomaFM · Secret Agent', url: 'https://ice1.somafm.com/secretagent-128-mp3', note: '60 年代间谍片风格的 lounge'},
]

const MAX_TRACKS = 200
const PREFS_KEY = 'playerPrefs'

/* ───────────── 曲目库 ───────────── */

export function readTracks(): Track[] {
  const list = readData<Track[]>(SHARED.music, [])
  return Array.isArray(list) ? list : []
}
const writeTracks = (next: Track[]) => writeData(SHARED.music, next.slice(0, MAX_TRACKS))

/** 校验地址：http(s) 直链，或 noise:xxx。页面是 https 时不能播 http。 */
export function checkUrl(raw: string): string {
  const url = raw.trim()
  if (/^noise:(white|pink|brown)$/.test(url)) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`「${raw}」不是一个有效的地址。`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http(s) 开头的音频直链或电台地址。')
  if (parsed.protocol === 'http:' && location.protocol === 'https:') throw new Error('这个页面是 https，浏览器不允许播放 http 地址的音频；请换成 https 的链接。')
  return parsed.toString()
}

export function addTrack(title: string, rawUrl: string, note?: string): Track {
  const url = checkUrl(rawUrl)
  const tracks = readTracks()
  const hit = tracks.find((track) => track.url === url)
  if (hit) return hit
  const track: Track = {id: uid(), title: title.trim().slice(0, 80) || new URL(url, location.href).hostname || '未命名', url}
  if (note?.trim()) track.note = note.trim().slice(0, 120)
  writeTracks([...tracks, track])
  return track
}

export function addPreset(url: string): Track | null {
  const preset = PRESETS.find((item) => item.url === url)
  return preset ? addTrack(preset.title, preset.url, preset.note) : null
}

export function removeTrack(id: string) {
  if (state.trackId === id) playerActions.stop()
  writeTracks(readTracks().filter((track) => track.id !== id))
}

export function renameTrack(id: string, title: string) {
  const next = title.trim().slice(0, 80)
  if (!next) return
  writeTracks(readTracks().map((track) => (track.id === id ? {...track, title: next} : track)))
}

/* ───────────── 噪音引擎 ───────────── */

let ctx: AudioContext | undefined
let noiseSource: AudioBufferSourceNode | undefined
let noiseGain: GainNode | undefined

function makeNoise(kind: 'white' | 'pink' | 'brown', context: AudioContext): AudioBuffer {
  const seconds = 6
  const buffer = context.createBuffer(2, context.sampleRate * seconds, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    if (kind === 'white') {
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    } else if (kind === 'pink') {
      // Paul Kellet 的近似
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.969 * b2 + white * 0.153852
        b3 = 0.8665 * b3 + white * 0.3104856
        b4 = 0.55 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.016898
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
        b6 = white * 0.115926
      }
    } else {
      let last = 0
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      }
    }
    // 首尾各淡 50ms，循环处不爆音
    const fade = Math.floor(context.sampleRate * 0.05)
    for (let i = 0; i < fade; i += 1) {
      const k = i / fade
      data[i] *= k
      data[data.length - 1 - i] *= k
    }
  }
  return buffer
}

function startNoise(kind: 'white' | 'pink' | 'brown') {
  ctx ??= new AudioContext()
  void ctx.resume()
  stopNoise()
  noiseSource = ctx.createBufferSource()
  noiseSource.buffer = makeNoise(kind, ctx)
  noiseSource.loop = true
  noiseGain = ctx.createGain()
  // 噪音比音乐刺耳，整体压低一些
  noiseGain.gain.value = state.volume * 0.5
  noiseSource.connect(noiseGain).connect(ctx.destination)
  noiseSource.start()
}

function stopNoise() {
  try {
    noiseSource?.stop()
  } catch {
    /* 已经停了 */
  }
  noiseSource?.disconnect()
  noiseGain?.disconnect()
  noiseSource = undefined
  noiseGain = undefined
}

/* ───────────── 状态 ───────────── */

const prefs = readStored<Partial<{volume: number; mode: PlayMode; trackId: string}>>(PREFS_KEY, {})
let state: PlayerState = {
  trackId: prefs.trackId,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: typeof prefs.volume === 'number' ? Math.min(1, Math.max(0, prefs.volume)) : 0.7,
  mode: prefs.mode === 'one' || prefs.mode === 'shuffle' ? prefs.mode : 'list',
}
const listeners = new Set<() => void>()

function set(patch: Partial<PlayerState>, persist = false) {
  state = {...state, ...patch}
  if (persist) writeStored(PREFS_KEY, {volume: state.volume, mode: state.mode, trackId: state.trackId})
  listeners.forEach((fn) => fn())
}

let audio: HTMLAudioElement | undefined

function element(): HTMLAudioElement {
  if (audio) return audio
  const el = new Audio()
  el.preload = 'none'
  el.volume = state.volume
  el.addEventListener('playing', () => {
    set({playing: true, loading: false, error: undefined})
    syncSession()
  })
  el.addEventListener('pause', () => {
    if (!el.ended) set({playing: false, loading: false})
    syncSession()
  })
  el.addEventListener('waiting', () => set({loading: true}))
  el.addEventListener('timeupdate', () => {
    // 每 0.5 秒左右刷一次，别让订阅者太忙
    if (Math.abs(el.currentTime - state.position) >= 0.5) set({position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0})
  })
  el.addEventListener('loadedmetadata', () => set({duration: Number.isFinite(el.duration) ? el.duration : 0}))
  el.addEventListener('ended', () => advance(true))
  el.addEventListener('error', () => set({playing: false, loading: false, error: '这个地址播不了：可能已失效，或者对方不允许外站播放。'}))
  audio = el
  return el
}

const current = (): Track | undefined => readTracks().find((track) => track.id === state.trackId)

function advance(auto: boolean) {
  const tracks = readTracks()
  if (!tracks.length) return
  const index = tracks.findIndex((track) => track.id === state.trackId)
  if (auto && state.mode === 'one' && index >= 0) {
    playTrack(tracks[index])
    return
  }
  let next: Track
  if (state.mode === 'shuffle' && tracks.length > 1) {
    do next = tracks[Math.floor(Math.random() * tracks.length)]
    while (next.id === state.trackId)
  } else {
    next = tracks[(index + 1) % tracks.length]
  }
  playTrack(next)
}

function playTrack(track: Track) {
  const el = element()
  el.pause()
  stopNoise()
  set({trackId: track.id, loading: true, error: undefined, playing: false, position: 0, duration: 0}, true)
  const noise = /^noise:(white|pink|brown)$/.exec(track.url)
  if (noise) {
    el.removeAttribute('src')
    el.load()
    try {
      startNoise(noise[1] as 'white' | 'pink' | 'brown')
      set({playing: true, loading: false})
    } catch {
      set({playing: false, loading: false, error: '这个浏览器不能生成噪音。'})
    }
    syncSession()
    return
  }
  el.src = track.url
  void el.play().catch((err: unknown) => {
    // 被打断（切歌太快）不算错误
    if (err instanceof DOMException && err.name === 'AbortError') return
    set({playing: false, loading: false, error: err instanceof DOMException && err.name === 'NotAllowedError' ? '浏览器要求先点一下页面才能出声，再点一次播放。' : '这个地址播不了：可能已失效，或者对方不允许外站播放。'})
  })
  syncSession()
}

export const playerActions = {
  /** 播放指定曲目；不给就继续当前，没有当前就从头。 */
  play(id?: string) {
    const tracks = readTracks()
    const track = id ? tracks.find((item) => item.id === id) : (current() ?? tracks[0])
    if (!track) return
    if (!id && state.trackId === track.id && audio?.src && !state.playing && !/^noise:/.test(track.url)) {
      void element().play().catch(() => set({error: '播放失败，再试一次。'}))
      return
    }
    if (!id && state.trackId === track.id && noiseSource) return
    playTrack(track)
  },
  pause() {
    if (!state.trackId) return
    if (noiseSource) {
      stopNoise()
      set({playing: false})
      syncSession()
    } else audio?.pause()
  },
  toggle() {
    if (state.playing) playerActions.pause()
    else playerActions.play()
  },
  stop() {
    audio?.pause()
    if (audio) {
      audio.removeAttribute('src')
      audio.load()
    }
    stopNoise()
    set({playing: false, loading: false, position: 0, duration: 0, error: undefined})
    syncSession()
  },
  next: () => advance(false),
  prev() {
    const tracks = readTracks()
    if (!tracks.length) return
    const index = tracks.findIndex((track) => track.id === state.trackId)
    playTrack(tracks[(index - 1 + tracks.length) % tracks.length])
  },
  seek(seconds: number) {
    if (audio && state.duration > 0) audio.currentTime = Math.min(state.duration, Math.max(0, seconds))
  },
  setVolume(volume: number) {
    const v = Math.min(1, Math.max(0, volume))
    if (audio) audio.volume = v
    if (noiseGain) noiseGain.gain.value = v * 0.5
    set({volume: v}, true)
  },
  setMode(mode: PlayMode) {
    set({mode}, true)
  },
  cycleMode() {
    playerActions.setMode(state.mode === 'list' ? 'shuffle' : state.mode === 'shuffle' ? 'one' : 'list')
  },
}

export const getPlayerState = () => state
export const currentTrack = current

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

/* ───────────── 系统媒体键 / 锁屏 ───────────── */

let sessionReady = false

function syncSession() {
  if (!('mediaSession' in navigator)) return
  const track = current()
  if (!sessionReady) {
    sessionReady = true
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => playerActions.play()],
      ['pause', () => playerActions.pause()],
      ['nexttrack', () => playerActions.next()],
      ['previoustrack', () => playerActions.prev()],
    ]
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        /* 某些浏览器不支持其中一些动作 */
      }
    }
  }
  navigator.mediaSession.metadata = track
    ? new MediaMetadata({title: track.title, artist: '搭搭', artwork: [{src: `${import.meta.env.BASE_URL}brand/icon-512.png`, sizes: '512x512', type: 'image/png'}]})
    : null
  navigator.mediaSession.playbackState = state.playing ? 'playing' : track ? 'paused' : 'none'
}
