import { ActionIcon, Flexbox, Hotkey, Tag, Text } from '@lobehub/ui'
import { Command, Settings } from 'lucide-react'

export function TopBar({
  clock,
  city,
  pageLabel,
  onPalette,
  onSettings,
  onMonitor,
  monitorTone,
  monitorLabel,
}: {
  clock: string
  city: string
  pageLabel: string
  onPalette: () => void
  onSettings: () => void
  onMonitor: () => void
  monitorTone: 'ok' | 'err' | 'loading' | ''
  monitorLabel: string
}) {
  const tone = monitorTone === 'ok' ? 'success' : monitorTone === 'err' ? 'error' : monitorTone === 'loading' ? 'warning' : 'gray'
  return (
    <Flexbox className="topbar" direction="horizontal" align="center" justify="space-between" gap={12} width="100%">
      <Flexbox direction="horizontal" align="center" gap={10}>
        <Text as="b" className="brand-title">
          搭搭
        </Text>
        <Tag size="small" variant="borderless">
          {pageLabel}
        </Tag>
      </Flexbox>
      <Flexbox direction="horizontal" align="center" gap={8}>
        <Text type="secondary" className="clock-small">
          {clock}
        </Text>
        <Tag color={tone} variant="filled" onClick={onMonitor} style={{ cursor: 'pointer' }}>
          {monitorLabel}
        </Tag>
        <Tag variant="borderless" onClick={onMonitor} style={{ cursor: 'pointer' }}>
          {city}
        </Tag>
        <ActionIcon icon={Command} title="命令面板" onClick={onPalette} />
        <Hotkey keys="mod+k" />
        <ActionIcon icon={Settings} title="设置" onClick={onSettings} />
      </Flexbox>
    </Flexbox>
  )
}
