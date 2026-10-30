import type {ThemePreviewReport} from './previewProtocol'

export type ThemePreviewInspection = {draftId: string; revision: number; signal?: AbortSignal}
type Inspector = (request: ThemePreviewInspection) => Promise<ThemePreviewReport>
let inspector: Inspector | undefined
/** 单个可见作者舞台；模块只管理连接，不启动业务、存储或 iframe。 */
export function registerThemePreviewInspector(next: Inspector): () => void {
  inspector = next
  return () => {if (inspector === next) inspector = undefined}
}
export async function inspectThemeDraftPreview(request: ThemePreviewInspection): Promise<ThemePreviewReport> {
  if (request.signal?.aborted) throw new DOMException('主题预览检查已停止','AbortError')
  if (!inspector) throw new Error('主题预览暂不可用：作者面板尚未连接')
  return inspector(request)
}
