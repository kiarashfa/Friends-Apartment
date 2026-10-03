import type { WebGPURenderer } from 'three/webgpu'

export interface RendererFailure {
  kind: 'device-lost' | 'gpu-error'
  type: string
  message: string
}

interface DeviceLostInfo {
  reason?: string
  message?: string
}

interface RendererFailureHooks {
  onDeviceLost?: (info: DeviceLostInfo) => void
}

interface UncapturedErrorEventLike extends Event {
  error?: {
    constructor?: { name?: string }
    message?: string
  }
}

interface DeviceWithErrors {
  addEventListener(
    type: 'uncapturederror',
    listener: (event: UncapturedErrorEventLike) => void,
  ): void
}

/**
 * Three r182 forwards device loss through renderer.onDeviceLost but does not
 * forward GPUDevice uncaptured errors. Patch the former before init and return
 * a one-shot installer for the device listener that becomes available after
 * init. Both paths are diagnostic only: this WebGPU-only project does not
 * silently downgrade or attempt to reuse a lost device.
 */
export function installRendererFailureHandlers(
  renderer: WebGPURenderer,
  onFailure: (failure: RendererFailure) => void,
): () => void {
  const hooks = renderer as unknown as RendererFailureHooks
  const defaultDeviceLost = hooks.onDeviceLost?.bind(renderer)
  hooks.onDeviceLost = (info) => {
    defaultDeviceLost?.(info)
    onFailure({
      kind: 'device-lost',
      type: info.reason ?? 'unknown',
      message: info.message ?? 'The WebGPU device was lost.',
    })
  }

  let installed = false
  return () => {
    if (installed) return
    const device = (renderer.backend as { device?: DeviceWithErrors }).device
    if (!device) throw new Error('WebGPU device unavailable after renderer initialization')
    installed = true
    device.addEventListener('uncapturederror', (event) => {
      const error = event.error
      onFailure({
        kind: 'gpu-error',
        type: error?.constructor?.name ?? 'GPUError',
        message: error?.message ?? 'Uncaptured WebGPU error.',
      })
    })
  }
}
