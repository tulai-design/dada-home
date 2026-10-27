export const FX_RUNTIME_ERROR_EVENT = 'dada:fx-error'

/** Report vendor initialization failures after the host has installed its listeners. */
export function reportFxFailure(canvas: HTMLCanvasElement, code: 'webgl-unavailable' | 'shader-failed'): void {
  queueMicrotask(() => {
    if (canvas.isConnected) canvas.dispatchEvent(new CustomEvent(FX_RUNTIME_ERROR_EVENT, {bubbles: true, detail: {code}}))
  })
}
