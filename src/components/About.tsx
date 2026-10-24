import {useEffect, useState} from 'react'
import {A, Modal, Switch, Text} from '@lobehub/ui'
import {Github} from '@lobehub/icons'
import {Bug, DownloadSimple as Download, GitFork, Heart, QrCode, ShieldCheck, Star} from '@phosphor-icons/react'
import {analyticsEnabled, setAnalyticsEnabled, umamiConfig} from '../lib/analytics'
import {useStored} from '../lib/store'
import {Group, Row} from './ios'

const base = import.meta.env.BASE_URL

const REPO = 'tulai-design/dada-home'
const REPO_URL = `https://github.com/${REPO}`
const AFDIAN_URL = 'https://afdian.com/a/ROYIANS'
const SPONSOR_IMAGE = `${base}brand/sponsor-wechat.jpg`

const openLink = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

type RepoStats = {stars: number; forks: number}

/** 仓库的 Star / Fork 数。GitHub 匿名接口一小时 60 次，所以缓存在本次会话里；拿不到就不显示数字。 */
function useRepoStats(): RepoStats | null {
  const [stats, setStats] = useState<RepoStats | null>(() => {
    try {
      const raw = sessionStorage.getItem('fp.repoStats')
      return raw ? (JSON.parse(raw) as RepoStats) : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (stats) return
    const controller = new AbortController()
    fetch(`https://api.github.com/repos/${REPO}`, {signal: controller.signal, headers: {accept: 'application/vnd.github+json'}})
      .then((res) => (res.ok ? (res.json() as Promise<{stargazers_count?: number; forks_count?: number}>) : null))
      .then((json) => {
        if (typeof json?.stargazers_count !== 'number') return
        const next = {stars: json.stargazers_count, forks: json.forks_count ?? 0}
        setStats(next)
        try {
          sessionStorage.setItem('fp.repoStats', JSON.stringify(next))
        } catch {
          /* 存不下就算了 */
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [stats])
  return stats
}

/** 搭搭的 IP 形象。关于页和 AI 对话的空状态都用它。 */
export function Mascot({size = 160, className}: {size?: number; className?: string}) {
  return <img className={className ?? 'mascot'} src={`${base}brand/dada-ip.webp`} alt="搭搭的吉祥物" width={size} height={size} draggable={false} />
}

export function AboutPanel() {
  const [tracking] = useStored<boolean>('analytics', analyticsEnabled())
  const tracked = umamiConfig() !== null
  const stats = useRepoStats()
  const [qr, setQr] = useState(false)
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
        <Row icon={<ShieldCheck size={16} />} label="隐私政策" chevron onClick={() => openLink(`${base}privacy.html`)} />
      </Group>
      <Group title="开源" footer="搭搭是开源的。觉得好用，点个 Star 就是对我们最直接的鼓励；想改成自己的样子，Fork 一份就行。">
        <Row icon={<Github size={16} />} label="GitHub" hint={REPO} chevron onClick={() => openLink(REPO_URL)} />
        <Row icon={<Star size={16} />} label="Star 一下" chevron onClick={() => openLink(REPO_URL)}>
          {stats ? stats.stars.toLocaleString() : undefined}
        </Row>
        <Row icon={<GitFork size={16} />} label="Fork 一份" chevron onClick={() => openLink(`${REPO_URL}/fork`)}>
          {stats ? stats.forks.toLocaleString() : undefined}
        </Row>
        <Row icon={<Bug size={16} />} label="反馈问题或建议" chevron onClick={() => openLink(`${REPO_URL}/issues/new`)} />
      </Group>
      <Group title="支持搭搭" footer="如果搭搭帮你搭好了自己的主页，欢迎请开发者喝杯咖啡，支持它继续打磨。感谢每一份使用、反馈与支持。">
        <Row icon={<Heart size={16} />} label="在爱发电支持" hint="afdian.com/a/ROYIANS" chevron onClick={() => openLink(AFDIAN_URL)} />
        <Row icon={<QrCode size={16} />} label="微信赞赏码" chevron onClick={() => setQr(true)} />
      </Group>
      <Modal open={qr} title="感谢支持搭搭" footer={null} width={420} onCancel={() => setQr(false)}>
        <div className="sponsor-qr">
          <Text type="secondary">使用微信扫一扫，或保存图片后在微信里识别赞赏码。</Text>
          <img src={SPONSOR_IMAGE} alt="微信赞赏码" width={1152} height={1152} draggable={false} />
          <A href={SPONSOR_IMAGE} download="搭搭-微信赞赏码.jpg">
            <Download size={14} /> 保存赞赏码
          </A>
        </div>
      </Modal>
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
