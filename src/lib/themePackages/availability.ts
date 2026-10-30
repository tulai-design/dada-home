import type {ThemeEntry} from '../workspace'
import {isThemeRenderer} from '../themeCatalog'
import {samePackage, type ThemePackageAvailability} from './contracts'
import {getThemeDependencyGeneration, getThemePackageRecords, isThemePackageChanging} from './state'

/** 依赖可用性不改请求记录，也不触发I/O。所有本地字体引用都检查，独立个人主题亦然。 */
export function getThemePackageAvailability(theme: ThemeEntry): ThemePackageAvailability {
  const generation = getThemeDependencyGeneration(theme)
  if (theme.packageRef) {
    if (theme.opaqueDesign || theme.rendererContract?.schemaVersion !== 1) return {status: 'unsupported', reason: '当前宿主不支持该主题数据 schema；原设计已保留', generation}
    if (!isThemeRenderer(theme.skin, theme.shell) || theme.rendererContract.skinVersion !== 1 || theme.rendererContract.shellVersion !== 1) return {status: 'incompatible', reason: '宿主缺少所需造型/外壳合同；设计已保留', generation}
    const row = getThemePackageRecords().find(item => samePackage(item.manifest, theme.packageRef!))
    if (!row) return {status: 'missing', reason: '此设备缺少精确版本/摘要的主题包，请导入对应文件', generation}
    if (row.state === 'unsupported') return {status: 'unsupported', reason: '主题包类型不受支持；原始 metadata 已保留', generation}
    if (isThemePackageChanging(theme.packageRef)) return {status: 'disabled', reason: '主题包状态正在更新', generation}
    if (!row.enabled) return {status: 'disabled', reason: '本机主题包已停用；设计及请求引用保留', generation}
    if (!row.manifest.contributions.some(item => item.id === theme.packageRef!.themeId)) return {status: 'resource-error', reason: '主题包中没有该贡献', generation}
  }
  for (const font of theme.fonts ?? []) if (font.resource) {
    const installed = getThemePackageRecords().find(item => samePackage(item.manifest, font.resource!))
    if (!installed) return {status: 'missing', reason: '主题字体依赖包尚未安装', generation}
    if (isThemePackageChanging(font.resource)) return {status: 'disabled', reason: '字体依赖包状态正在更新', generation}
    if (!installed.enabled) return {status: 'disabled', reason: '主题字体依赖包已停用', generation}
    const descriptor = installed.manifest.resources.find(item => item.id === font.resource!.resourceId && item.sha256 === font.resource!.sha256)
    if (!descriptor || !installed.resources.some(item => item.id === descriptor.id && item.bytes.byteLength === descriptor.bytes)) return {status: 'resource-error', reason: '主题包本地字体资源缺失', generation}
  }
  return {status: 'available', generation}
}
