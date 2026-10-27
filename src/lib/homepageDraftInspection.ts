import {describeHomepageDraft, getHomepageDraft, getHomepageDraftWorkspace} from './homepageDraft'
import {createPageInspectionHost, type MountedInspectionPage} from './pageInspectionHost'
import {pageInspectionSelector, unavailablePageInspection, type PageInspectionReport} from './pageInspector'

export type HomepageDraftInspectionRequest = {draftId: string}
export type HomepageDraftInspectionReport = PageInspectionReport & {
  target: {kind: 'homepage-draft'; id: string; revision: number | null}
  coverage: {mode: 'layout-only'; measured: string[]; notMeasured: string[]}
}
const coverage = (measured = false) => ({
  mode: 'layout-only' as const,
  measured: measured ? ['预览实际容器', '分区与组件静态外框'] : [],
  notMeasured: ['组件业务数据与应用内部', '壁纸与动态特效', '含资源或不安全的自定义样式', '照片和文字对比度', '审美和完整无障碍'],
})

export function unavailableHomepageDraftInspection(draftId: string, code: string, reason: string, revision: number | null = null): HomepageDraftInspectionReport {
  return {
    ...unavailablePageInspection({pageId: 'home', pageName: '首页草稿', code, reason, ...(revision === null ? {} : {revision: String(revision)}), status: code === 'stale-draft' || code === 'stale-render' ? 'unknown' : 'unavailable'}),
    target: {kind: 'homepage-draft', id: draftId, revision}, coverage: coverage(),
  }
}

/** 共用有界布局等待和真实 DOM 检查，前后核对草稿版本，绝不把旧预览当成最新草稿。 */
export function createHomepageDraftInspectionHost(host: {
  getMounted: () => MountedInspectionPage | null
}): (request: HomepageDraftInspectionRequest, signal?: AbortSignal) => Promise<HomepageDraftInspectionReport> {
  return async ({draftId}, signal) => {
    signal?.throwIfAborted()
    const draft = getHomepageDraft()
    const workspace = getHomepageDraftWorkspace()
    if (!draft || draft.id !== draftId || !workspace) return unavailableHomepageDraftInspection(draftId, 'unknown-draft', '没有这个首页草稿；先读取当前草稿，不会自动创建或切换。')
    const inspect = createPageInspectionHost({
      getWorkspace: () => getHomepageDraftWorkspace() ?? workspace,
      getMounted: () => {
        const mounted = host.getMounted()
        return mounted?.draftId === draftId ? mounted : null
      },
    })
    const result = await inspect({pageId: 'home'}, signal)
    signal?.throwIfAborted()
    if (getHomepageDraft() !== draft) return unavailableHomepageDraftInspection(draftId, 'stale-draft', '检查期间草稿已修改或取消；旧测量不能代表最新版本，重新读取草稿后再检查。', draft.revision)
    const mounted = host.getMounted()
    if (mounted?.draftId === draftId && mounted.revision !== String(draft.revision)) return unavailableHomepageDraftInspection(draftId, 'stale-render', '草稿预览尚未渲染最新版本，页面更新后再检查。', draft.revision)
    const conflict = describeHomepageDraft()?.conflict === true
    return {
      ...result,
      target: {kind: 'homepage-draft', id: draftId, revision: draft.revision}, coverage: coverage(result.page.visible),
      unknown: [...result.unknown,
        ...(conflict ? [{code: 'draft-base-conflict', reason: '正式首页在草稿创建后发生变化；当前草稿仍可测量，但不能直接应用覆盖，应取消后从最新首页重新生成。'}] : []),
        {code: 'layout-preview-only', reason: '只测量静态布局预览；业务应用、私有数据、壁纸和动态效果没有在草稿中运行。'},
        ...draft.page.components.map((instance) => ({code: 'preview-component-content', componentId: instance.id, selector: pageInspectionSelector('home', draftId, instance.id), reason: '此组件使用配置静态表示或占位，未执行真实业务内容；内部布局和交互尚未验证。'})),
      ],
    }
  }
}
