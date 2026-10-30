import type {ShellAdapter, ShellCapabilities, ShellPresentation} from './contracts'

export function validateShellCapabilities(value: ShellCapabilities): boolean {
  return !!value && !!value.settings && ['sidebar', 'wide'].includes(value.settings.header)
    && typeof value.settings.avatar === 'boolean' && ['dock', 'launcher', 'taskbar'].includes(value.navigation)
}
export function createShellRegistry(adapters: readonly ShellAdapter[]): ReadonlyMap<string, ShellAdapter> {
  const registry = new Map<string, ShellAdapter>()
  for (const adapter of adapters) {
    if (!adapter.id || registry.has(adapter.id)) throw new Error(`重复或空外壳 ID：${adapter.id}`)
    if (!validateShellCapabilities(adapter.capabilities) || typeof adapter.Chrome !== 'function') throw new Error(`外壳合同无效：${adapter.id}`)
    registry.set(adapter.id, adapter)
  }
  return registry
}
export function validateShellPresentation(value: ShellPresentation): boolean {
  return !!value && ['visible', 'launcher', 'minimized', 'closed'].includes(value.content)
    && typeof value.maximized === 'boolean' && ['page', 'shell'].includes(value.backdrop)
    && !!value.reserves && ['top', 'right', 'bottom', 'left'].every((key) => {
      const number = value.reserves[key as keyof typeof value.reserves]
      return Number.isFinite(number) && number >= 0 && number <= 4096
    })
}
export function equalPresentation(a: ShellPresentation, b: ShellPresentation): boolean {
  return a.content === b.content && a.maximized === b.maximized && a.backdrop === b.backdrop
    && a.reserves.top === b.reserves.top && a.reserves.right === b.reserves.right
    && a.reserves.bottom === b.reserves.bottom && a.reserves.left === b.reserves.left
}
