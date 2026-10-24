import {A, Text} from '@lobehub/ui'
import {Group, Row} from './ios'

const base = import.meta.env.BASE_URL

/** 搭搭的 IP 形象。关于页和 AI 对话的空状态都用它。 */
export function Mascot({size = 160, className}: {size?: number; className?: string}) {
  return <img className={className ?? 'mascot'} src={`${base}brand/dada-ip.webp`} alt="搭搭的吉祥物" width={size} height={size} draggable={false} />
}

export function AboutPanel() {
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
    </>
  )
}
