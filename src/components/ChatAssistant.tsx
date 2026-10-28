import type {ComponentProps} from 'react'
import {toast} from '@lobehub/ui'
import {useChat} from '../lib/chat'
import {Assistant} from './Assistant'

type ChatKeys = 'turns' | 'ready' | 'convs' | 'convId' | 'activeTurnIds' | 'hasOlderTurns' | 'turnsLoading' | 'turnsError' | 'onLoadOlderTurns' | 'hasMoreConvs' | 'convsLoading' | 'convsError' | 'onLoadMoreConvs' | 'onNewConv' | 'onOpenConv' | 'onDeleteConv'

const report = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))

/**
 * 把聊天仓库接到助手面板。
 * 订阅放在这一层而不是 App：流式输出每次更新只重绘面板，不会带着整个主页一起重绘。
 */
export function ChatAssistant({onConvChange, ...props}: Omit<ComponentProps<typeof Assistant>, ChatKeys> & {onConvChange: () => void}) {
  const chat = useChat()
  return (
    <Assistant
      {...props}
      turns={chat.turns}
      ready={chat.ready}
      convs={chat.convs}
      convId={chat.convId}
      activeTurnIds={chat.activeTurnIds}
      hasOlderTurns={chat.hasOlderTurns}
      turnsLoading={chat.turnsLoading}
      turnsError={chat.turnsError}
      onLoadOlderTurns={chat.loadOlderTurns}
      hasMoreConvs={chat.hasMoreConvs}
      convsLoading={chat.convsLoading}
      convsError={chat.convsError}
      onLoadMoreConvs={chat.loadMoreConvs}
      onNewConv={() => { void chat.newConv().then(onConvChange).catch(report) }}
      onOpenConv={(id) => { void chat.openConv(id).then(onConvChange).catch(report) }}
      onDeleteConv={(id) => { void chat.deleteConv(id).then(() => { if (id === chat.convId) onConvChange() }).catch(report) }}
    />
  )
}
