/** Small, renderer-independent loading helpers.
 *
 * Keeping these decisions outside main.ts makes the loading contract easy to
 * exercise without constructing a WebGPU renderer. The helpers deliberately
 * describe state transitions only; they do not change scene content or
 * rendering quality.
 */

export const COMPILE_BATCH_SIZE = 24

export interface CompileBatch {
  start: number
  end: number
}

/** Return contiguous, non-empty ranges covering [0, meshCount). */
export function compileBatches(meshCount: number, batchSize = COMPILE_BATCH_SIZE): CompileBatch[] {
  if (!Number.isInteger(meshCount) || meshCount < 0) {
    throw new RangeError(`meshCount must be a non-negative integer: ${meshCount}`)
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`batchSize must be a positive integer: ${batchSize}`)
  }
  const batches: CompileBatch[] = []
  for (let start = 0; start < meshCount; start += batchSize) {
    batches.push({ start, end: Math.min(meshCount, start + batchSize) })
  }
  return batches
}

export interface ShadowWarmupState {
  castShadow?: boolean
  shadow?: {
    autoUpdate: boolean
    needsUpdate: boolean
  } | null
}

/** Freeze automatic shadow-map rendering while material pipelines compile. */
export function freezeShadowUpdates(lights: readonly ShadowWarmupState[]): void {
  for (const light of lights) {
    if (!light.castShadow || !light.shadow) continue
    light.shadow.autoUpdate = false
    light.shadow.needsUpdate = false
  }
}

/** Select only lights that own a shadow map and therefore need a warm pass. */
export function shadowWarmupLights<T extends ShadowWarmupState>(lights: readonly T[]): T[] {
  return lights.filter((light) => light.castShadow === true && light.shadow !== null && light.shadow !== undefined)
}

