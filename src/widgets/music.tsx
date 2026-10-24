import {useEffect, useMemo, useRef, useState} from 'react'
import {ActionIcon, Block, Button, Empty, Flexbox, Input, Popover, Slider, Tag, Text, Tooltip} from '@lobehub/ui'
import {AudioLines, ListPlus, Pause, Play, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Trash2, Volume1, Volume2, VolumeX, Waves} from 'lucide-react'
import {SHARED, useComponentData} from '../lib/componentData'
import {MODE_LABEL, PRESETS, addPreset, addTrack, playerActions, removeTrack, usePlayer, type PlayMode, type Track} from '../lib/player'
import {registerComponent, type ComponentProps} from '../lib/registry'

type MusicConfig = {
  showVolume: boolean
  /** 离开音乐页面（切到别的页面、设置等）时自动暂停 */
  pauseOnLeave: boolean
}

const MODE_ICON: Record<PlayMode, typeof Repeat> = {list: Repeat, one: Repeat1, shuffle: Shuffle}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

const isNoise = (track?: Track) => !!track?.url.startsWith('noise:')

/** 没有封面图，就按曲名生成一块稳定的渐变：同一首歌永远是同一个颜色。 */
function coverStyle(title = ''): React.CSSProperties {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return {background: `linear-gradient(180deg, hsl(${hue} 30% 56%), hsl(${(hue + 20) % 360} 34% 46%))`}
}

/* ───────────── 离开页面时暂停 ───────────── */

/**
 * 记录现在有几个「音乐」界面挂在屏幕上。播放器是全局单例，切页面不会断；
 * 但用户的预期通常是「离开音乐页就停」。所以：最后一个界面卸载、且状态条里也没有音乐时，暂停。
 * 状态条里放了音乐的人，是明确想在别的页面也控制它，这时不暂停。
 */
let pageMounted = 0
let statusMounted = 0

function pauseIfAbandoned() {
  // 推迟一拍：React 严格模式、或换页时「旧的卸载、新的挂载」是连着发生的，不能误判为离开
  setTimeout(() => {
    if (pageMounted === 0 && statusMounted === 0) playerActions.pause()
  }, 0)
}

function Cover({track, playing, loading}: {track?: Track; playing: boolean; loading: boolean}) {
  const Icon = !track ? AudioLines : isNoise(track) ? Waves : Radio
  return (
    <div className="music-cover" style={coverStyle(track?.title)} data-empty={!track} data-playing={playing}>
      <Icon size={44} strokeWidth={1.25} aria-hidden />
      <div className="music-eq" aria-hidden data-on={playing || loading}>
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}

function AddPanel({tracks}: {tracks: Track[]}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const missing = useMemo(() => PRESETS.filter((preset) => !tracks.some((track) => track.url === preset.url)), [tracks])

  const add = () => {
    try {
      addTrack(title, url)
      setTitle('')
      setUrl('')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Flexbox gap={12} style={{width: 320}}>
      {missing.length > 0 && (
        <Flexbox gap={8}>
          <Text type="secondary" fontSize={12}>
            常用，点一下加入
          </Text>
          <Flexbox gap={4} style={{maxHeight: 188, overflow: 'auto'}}>
            {missing.map((preset) => (
              <Block key={preset.url} clickable variant="borderless" padding={8} onClick={() => addPreset(preset.url)} title={preset.note}>
                <Flexbox horizontal align="center" gap={8}>
                  {preset.url.startsWith('noise:') ? <Waves size={14} /> : <Radio size={14} />}
                  <Text ellipsis style={{flex: 1}}>
                    {preset.title}
                  </Text>
                  <ListPlus size={14} />
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        </Flexbox>
      )}
      <Flexbox gap={8}>
        <Text type="secondary" fontSize={12}>
          或者加一个音频直链、网络电台（https）
        </Text>
        <Input placeholder="名称（可选）" value={title} onValueChange={setTitle} />
        <Input placeholder="https://…/xxx.mp3" value={url} onValueChange={setUrl} onPressEnter={add} />
        {error && (
          <Text type="danger" fontSize={12}>
            {error}
          </Text>
        )}
        <Button className="ink-button" type="primary" disabled={!url.trim()} onClick={add}>
          添加到列表
        </Button>
      </Flexbox>
    </Flexbox>
  )
}

function Music({config}: ComponentProps<MusicConfig>) {
  const player = usePlayer()
  const [tracks] = useComponentData<Track[]>(SHARED.music, [])
  const current = tracks.find((track) => track.id === player.trackId)
  const [drag, setDrag] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const ModeIcon = MODE_ICON[player.mode]
  const VolumeIcon = player.volume === 0 ? VolumeX : player.volume < 0.5 ? Volume1 : Volume2
  const live = !!current && player.duration === 0

  const leave = useRef(config.pauseOnLeave)
  leave.current = config.pauseOnLeave
  useEffect(() => {
    pageMounted += 1
    return () => {
      pageMounted -= 1
      if (leave.current) pauseIfAbandoned()
    }
  }, [])

  const subtitle = player.error ? (
    <Text type="danger" fontSize={13}>
      {player.error}
    </Text>
  ) : (
    <Text type="secondary" fontSize={13}>
      {player.loading ? '正在缓冲…' : current?.note ?? (tracks.length ? '从右边的列表里选一首' : '先加几首')}
    </Text>
  )

  return (
    <Flexbox className="page-pane music" horizontal wrap="wrap" gap={32} align="stretch">
      <Flexbox className="music-deck" gap={20}>
        <Cover track={current} playing={player.playing} loading={player.loading} />

        <Flexbox className="music-meta" gap={4}>
          <div className="music-title">{current?.title ?? '还没在播放'}</div>
          {subtitle}
        </Flexbox>

        <Flexbox gap={4}>
          <Slider
            className="music-seek"
            min={0}
            max={Math.max(player.duration, 1)}
            step={1}
            disabled={!player.duration}
            value={drag ?? player.position}
            onChange={(v) => setDrag(v as number)}
            onChangeComplete={(v) => {
              playerActions.seek(v as number)
              setDrag(null)
            }}
          />
          <Flexbox horizontal justify="space-between" className="music-times">
            <span>{live ? '直播' : clock(drag ?? player.position)}</span>
            <span>{player.duration ? clock(player.duration) : live ? '' : '0:00'}</span>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align="center" justify="space-between">
          <Tooltip title={`${MODE_LABEL[player.mode]}（点击切换）`}>
            <ActionIcon icon={ModeIcon} aria-label={MODE_LABEL[player.mode]} onClick={playerActions.cycleMode} />
          </Tooltip>
          <Flexbox horizontal align="center" gap={8}>
            <ActionIcon icon={SkipBack} size="large" aria-label="上一首" disabled={!tracks.length} onClick={playerActions.prev} />
            <Button
              className="ink-button"
              type="primary"
              size="large"
              aria-label={player.playing ? '暂停' : '播放'}
              icon={player.playing ? <Pause size={18} /> : <Play size={18} />}
              disabled={!tracks.length}
              onClick={playerActions.toggle}
              style={{width: 52, height: 52, padding: 0}}
            />
            <ActionIcon icon={SkipForward} size="large" aria-label="下一首" disabled={!tracks.length} onClick={playerActions.next} />
          </Flexbox>
          {config.showVolume ? (
            <Popover
              trigger="click"
              placement="top"
              arrow={false}
              content={
                <Flexbox horizontal align="center" gap={8} style={{width: 160}}>
                  <Slider min={0} max={1} step={0.02} value={player.volume} onChange={(v) => playerActions.setVolume(v as number)} style={{flex: 1}} />
                </Flexbox>
              }
            >
              <ActionIcon icon={VolumeIcon} aria-label="音量" />
            </Popover>
          ) : (
            <span style={{width: 32}} />
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox className="music-queue" gap={12}>
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal align="baseline" gap={8}>
            <Text strong style={{fontSize: 14}}>
              播放列表
            </Text>
            <Text type="secondary" fontSize={12}>
              {tracks.length} 首
            </Text>
          </Flexbox>
          <Popover trigger="click" placement="bottomRight" open={adding} onOpenChange={setAdding} content={<AddPanel tracks={tracks} />}>
            <Button size="small" icon={<ListPlus size={14} />}>
              添加
            </Button>
          </Popover>
        </Flexbox>

        {tracks.length ? (
          <Flexbox className="music-list" gap={4}>
            {tracks.map((track, index) => {
              const active = track.id === player.trackId
              return (
                <Block
                  key={track.id}
                  className="music-row"
                  clickable
                  variant={active ? 'filled' : 'borderless'}
                  padding={8}
                  data-active={active}
                  onClick={() => (active ? playerActions.toggle() : playerActions.play(track.id))}
                >
                  <Flexbox horizontal align="center" gap={12}>
                    <span className="music-index" data-playing={active && player.playing}>
                      {active && player.playing ? <AudioLines size={14} /> : <span>{index + 1}</span>}
                    </span>
                    <div className="music-row-text">
                      <span className="music-row-title">{track.title}</span>
                      {track.note && <span className="music-row-note">{track.note}</span>}
                    </div>
                    <Tag size="small" icon={isNoise(track) ? <Waves size={11} /> : <Radio size={11} />}>
                      {isNoise(track) ? '噪音' : '在线'}
                    </Tag>
                    <ActionIcon
                      className="music-row-remove"
                      icon={Trash2}
                      size="small"
                      aria-label={`把「${track.title}」移出列表`}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeTrack(track.id)
                      }}
                    />
                  </Flexbox>
                </Block>
              )
            })}
          </Flexbox>
        ) : (
          <Flexbox flex={1} align="center" justify="center">
            <Empty title="播放列表是空的" description="点右上角的「添加」，从常用电台和白噪音里挑，或者让搭搭帮你加。" />
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  )
}

/** 状态条形态：播放中显示曲名，一键暂停；没播放就是一个小按钮。状态条里有它，就说明想在别的页面也能控制，所以它在时不会自动暂停。 */
function MusicStatus() {
  const player = usePlayer()
  const [tracks] = useComponentData<Track[]>(SHARED.music, [])
  const current = tracks.find((track) => track.id === player.trackId)
  useEffect(() => {
    statusMounted += 1
    return () => {
      statusMounted -= 1
    }
  }, [])
  return (
    <Tooltip title={player.playing ? '点一下暂停' : '点一下播放'}>
      <Button size="small" type="text" className="status-focus" data-running={player.playing} icon={player.playing ? <Pause size={12} /> : <Play size={12} />} onClick={playerActions.toggle}>
        {current ? <span className="status-music-title">{current.title}</span> : '音乐'}
      </Button>
    </Tooltip>
  )
}

registerComponent<MusicConfig>({
  type: 'music',
  name: '音乐',
  description:
    '音乐播放器：封面、进度、上一首 / 下一首、列表 / 单曲 / 随机循环、音量，右侧是播放列表。曲目是音频直链、网络电台（如 SomaFM）和内置的白噪音 / 粉红噪音 / 棕色噪音。默认离开音乐页面就自动暂停（可关）；支持系统媒体键。AI 可以替你加歌、播放、暂停、切歌。舞台型组件，独占一页时居中。能放进状态条（放进去后，在别的页面也能控制，也就不会自动暂停）。',
  category: 'tool',
  defaultConfig: {showVolume: true, pauseOnLeave: true},
  configSchema: {
    showVolume: {kind: 'boolean', label: '显示音量'},
    pauseOnLeave: {kind: 'boolean', label: '离开页面时暂停', description: '切到别的页面或设置时自动暂停。状态条里放了音乐时不会暂停。'},
  },
  defaultSpan: 'third',
  stage: {width: 880},
  component: Music,
  status: MusicStatus,
  multiple: false,
})
