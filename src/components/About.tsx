import {A, Switch, Text} from '@lobehub/ui'
import {analyticsEnabled, setAnalyticsEnabled, umamiConfig} from '../lib/analytics'
import {useStored} from '../lib/store'
import {Group, Row} from './ios'

const base = import.meta.env.BASE_URL

/** 搭搭的 IP 形象。关于页和 AI 对话的空状态都用它。 */
export function Mascot({size = 160, className}: {size?: number; className?: string}) {
  return <img className={className ?? 'mascot'} src={`${base}brand/dada-ip.webp`} alt="搭搭的吉祥物" width={size} height={size} draggable={false} />
}

export function AboutPanel() {
  const [tracking] = useStored<boolean>('analytics', analyticsEnabled())
  const tracked = umamiConfig() !== null
  return (
    <>
      <div className="about-hero">
        <Mascot size={200} className="mascot about-mascot" />
        <Text as="h2" className="about-name">
          搭搭
        </Text>
        <Text type="secondary">陪你把想法，搭成自己的主页。</Text>
      </div>
      <Group>
        <Row label="作者">图来设计 tulai.design</Row>
        <Row label="网站">
          <A href="https://tulai.design" target="_blank" rel="noreferrer noopener">
            tulai.design
          </A>
        </Row>
        <Row label="数据">只保存在这台浏览器里</Row>
      </Group>
      {tracked && (
        <Group footer="只统计有多少人来过，不上报页面内容和你的任何数据；开了浏览器的「请勿跟踪」也会自动跳过。改动在下次打开页面时生效。">
          <Row label="匿名访问统计">
            <Switch checked={tracking !== false} onChange={setAnalyticsEnabled} />
          </Row>
        </Group>
      )}
    </>
  )
}
