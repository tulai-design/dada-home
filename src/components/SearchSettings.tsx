import {useState} from 'react'
import {A, Switch, Text} from '@lobehub/ui'
import {PlugsConnected as PlugZap} from '@phosphor-icons/react'
import {REMEMBERABLE, setAlwaysAllowed} from '../lib/permissions'
import {useStored} from '../lib/store'
import {SEARCH_KEY, SEARCH_PROVIDERS, defaultSearchConfig, providerInfo, searchReady, webSearch, type SearchConfig, type SearchProvider} from '../lib/webSearch'
import {Group, Row, TextRow} from './ios'

type Status = {kind: 'idle' | 'loading' | 'ok' | 'error'; text?: string}

/**
 * 搜索相关的设置：
 *   1. 联网搜索：让搭搭自己查资料用的搜索服务和密钥（Tavily、Firecrawl、SearXNG…）。
 *   2. 自动允许：「搜索并跳转」这类低风险动作，选过「总是允许」后可以在这里关掉。
 * 密钥只存在这台浏览器里，请求直接从浏览器发给服务商。
 */
export function SearchSettings() {
  const [config, setConfig] = useStored<SearchConfig>(SEARCH_KEY, defaultSearchConfig())
  const [allowed] = useStored<string[]>('alwaysAllow', [])
  const [status, setStatus] = useState<Status>({kind: 'idle'})
  const info = providerInfo(config.provider)

  const set = (patch: Partial<SearchConfig>) => {
    setConfig({...config, ...patch})
    setStatus({kind: 'idle'})
  }
  const pick = (provider: SearchProvider) => set({provider})

  const test = async () => {
    setStatus({kind: 'loading'})
    try {
      const result = await webSearch('OpenAI', {limit: 3}, config)
      setStatus({kind: 'ok', text: result.hits.length ? `连通了，返回 ${result.hits.length} 条结果。` : '连通了，但这次没有返回结果。'})
    } catch (error) {
      setStatus({kind: 'error', text: error instanceof Error ? error.message : String(error)})
    }
  }

  return (
    <>
      <Group title="联网搜索" footer="让搭搭自己上网查资料、核对最新信息，再回答你。选一个服务商，填上密钥就行；和首页输入框里的搜索引擎是两回事。">
        <Row label="不启用" checked={config.provider === 'off'} onClick={() => pick('off')} />
        {SEARCH_PROVIDERS.map((p) => (
          <Row key={p.id} label={p.name} hint={p.note} checked={config.provider === p.id} onClick={() => pick(p.id)} />
        ))}
      </Group>

      {info && (
        <Group
          title={info.name}
          footer={
            <>
              {info.needsKey ? '密钥只保存在这台浏览器里，请求直接发给服务商。' : '这个服务不需要密钥。'}{' '}
              <A href={info.signup} target="_blank" rel="noreferrer noopener">
                {info.needsKey ? '去申请密钥' : '了解如何自己搭一个'}
              </A>
              {info.id === 'searxng' && '。实例需要在 settings.yml 里把 json 加进 search.formats，并允许跨域，否则浏览器连不上。'}
            </>
          }
        >
          {info.needsKey && (
            <TextRow label="密钥" secret value={config.keys[info.id] ?? ''} placeholder={info.keyPlaceholder} onChange={(v) => set({keys: {...config.keys, [info.id]: v}})} />
          )}
          {(info.needsUrl || info.id === 'firecrawl') && (
            <TextRow
              label={info.id === 'searxng' ? '实例地址' : '服务地址'}
              stack
              value={config.urls[info.id] ?? ''}
              placeholder={info.urlPlaceholder}
              onChange={(v) => set({urls: {...config.urls, [info.id]: v}})}
            />
          )}
          <Row label="测试连接" icon={<PlugZap size={16} />} chevron onClick={searchReady(config) && status.kind !== 'loading' ? () => void test() : undefined}>
            {status.kind === 'loading' ? '测试中…' : searchReady(config) ? undefined : '先填完上面的'}
          </Row>
          {status.kind === 'ok' && (
            <Row>
              <Text type="success">{status.text}</Text>
            </Row>
          )}
          {status.kind === 'error' && (
            <Row>
              <Text type="danger">{status.text}</Text>
            </Row>
          )}
        </Group>
      )}

      <Group title="自动允许" footer="搭搭做这些事之前会先问你；在对话里点过「总是允许」就会出现在这里。关掉后，下次又会先问。">
        {Object.entries(REMEMBERABLE).map(([name, item]) => (
          <Row key={name} label={item.label} hint={item.hint}>
            <Switch checked={allowed.includes(name)} onChange={(on) => setAlwaysAllowed(name, on)} />
          </Row>
        ))}
      </Group>
    </>
  )
}
