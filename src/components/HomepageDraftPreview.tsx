import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Button, Select} from '@lobehub/ui'
import {PageView} from './PageView'
import {HomepageDraftContent} from './HomepageDraftContent'
import {applyHomepageDraft, describeHomepageDraft, discardHomepageDraft, updateHomepageDraft, type HomepageDraft} from '../lib/homepageDraft'
import {HOMEPAGE_RECIPES} from '../lib/homepageRecipes'
import type {ComponentHost} from '../lib/registry'
import type {Workspace} from '../lib/workspace'
import type {MountedInspectionPage} from '../lib/pageInspectionHost'
import type {HomepageDraftInspectionReport} from '../lib/homepageDraftInspection'

export function HomepageDraftPreview({draft, workspace, host, onMount, inspect}: {
  draft: HomepageDraft
  workspace: Workspace
  host: ComponentHost
  onMount: (mounted: MountedInspectionPage | null) => void
  inspect: (request: {draftId: string}, signal?: AbortSignal) => Promise<HomepageDraftInspectionReport>
}) {
  const panel = useRef<HTMLElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController | null>(null)
  const [time] = useState(() => new Date())
  const [error, setError] = useState('')
  const [report, setReport] = useState<HomepageDraftInspectionReport | null>(null)
  const [checking, setChecking] = useState(false)
  const conflict = describeHomepageDraft()?.conflict ?? false
  useLayoutEffect(() => {
    onMount(root.current ? {root: root.current, pageId: 'home', workspace, revision: String(draft.revision), draftId: draft.id} : null)
    return () => onMount(null)
  }, [draft, workspace, onMount])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = panel.current
    element?.focus({preventScroll: true})
    return () => {
      request.current?.abort()
      requestAnimationFrame(() => {
        // StrictMode simulates cleanup while this same panel is still mounted.
        if (element?.isConnected) return
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({preventScroll: true})
        else document.querySelector<HTMLElement>('.canvas > .topbar button')?.focus({preventScroll: true})
      })
    }
  }, [])
  useEffect(() => {request.current?.abort(); setChecking(false); setReport(null); setError('')}, [draft.revision, workspace])
  const change = (recipeId: string) => {
    try {updateHomepageDraft({draftId: draft.id, expectedRevision: draft.revision, recipeId})}
    catch (reason) {setError(reason instanceof Error ? reason.message : String(reason))}
  }
  const check = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setChecking(true); setError('')
    try {
      const next = await inspect({draftId: draft.id}, controller.signal)
      if (!controller.signal.aborted) setReport(next)
    } catch (reason) {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))}
    finally {if (!controller.signal.aborted) setChecking(false)}
  }
  const apply = () => {
    try {applyHomepageDraft({draftId: draft.id, expectedRevision: draft.revision})}
    catch (reason) {setError(reason instanceof Error ? reason.message : String(reason))}
  }
  const cancel = () => {
    try {discardHomepageDraft({draftId: draft.id})}
    catch (reason) {setError(reason instanceof Error ? reason.message : String(reason))}
  }
  return <section ref={panel} className="homepage-draft-preview" tabIndex={-1} aria-label="首页布局预览">
    <header className="homepage-draft-toolbar">
      <div className="homepage-draft-title"><h2>首页预览</h2><Select aria-label="首页方案" value={draft.recipeId} options={HOMEPAGE_RECIPES.map((recipe) => ({value: recipe.id, label: recipe.name}))} onChange={(value) => change(String(value))} /></div>
      <div className="homepage-draft-actions"><Button onClick={() => void check()} loading={checking}>检查</Button><Button type="primary" className="ink-button" disabled={conflict} onClick={apply}>应用</Button><Button type="text" onClick={cancel}>取消</Button></div>
      <p className="homepage-draft-note" title="不运行壁纸、动态效果和含资源的自定义样式；不读取私有业务数据。">布局预览，应用与实时内容为静态表示。未应用的草稿刷新后丢弃。</p>
      {(conflict || error) && <p className="homepage-draft-error" role="alert">{error || '首页已发生变化，取消后重新生成，避免覆盖新改动。'}</p>}
      {report && <p className="homepage-draft-result" role="status">{report.status === 'ok' ? `已检查 ${report.page.viewport.width}px 容器，发现 ${report.issues.length} 项布局问题。仅测静态预览，不代表实际内容已通过。` : '当前预览不可测，稍后重试。'}</p>}
    </header>
    <div ref={root} className="page homepage-draft-page" data-homepage-draft={draft.id} data-page-id="home">
      <PageView page={draft.page} workspace={workspace} host={host} onUpdateConfig={() => {}} onRemove={() => {}} renderPreview={(instance, label) => <HomepageDraftContent instance={instance} label={label} time={time} />} />
    </div>
  </section>
}
