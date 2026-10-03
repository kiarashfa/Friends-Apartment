/** Scene image assets and their one-time loading barrier.
 *
 * Materials receive the same Texture object that the preloader starts. This
 * lets network/decode work overlap dynamic module loading and procedural scene
 * construction while keeping image readiness part of the scene's upfront
 * warmup contract.
 */
import { TextureLoader } from 'three/webgpu'
import type { Texture } from 'three/webgpu'
import type { ApartmentId } from '../scenes/types'

export const SCENE_ASSETS: Readonly<Record<ApartmentId, readonly string[]>> = Object.freeze({
  '19': Object.freeze(['/Laurel_and_Hardy_poster.jpeg', '/Vendetta_poster.jpg', '/die_hard.jpeg']),
  '20': Object.freeze(['/poster.jpg']),
  perk: Object.freeze(['/status_of_liberty_painting.png', '/central_perk_sticker.png']),
})

interface TextureRecord {
  texture: Texture
  ready: Promise<Texture>
}

const records = new Map<string, TextureRecord>()
let loader: TextureLoader | null = null

function getLoader(): TextureLoader {
  return loader ??= new TextureLoader()
}

function recordFor(path: string): TextureRecord {
  const existing = records.get(path)
  if (existing) return existing

  let resolveReady: (texture: Texture) => void = () => undefined
  let rejectReady: (error: unknown) => void = () => undefined
  const ready = new Promise<Texture>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const fail = (error: unknown): void => {
    records.delete(path)
    rejectReady(error instanceof Error ? error : new Error(`Failed to load texture ${path}`))
  }
  const texture = getLoader().load(
    path,
    (loaded) => {
      // TextureLoader's callback means the image loaded. Decode explicitly so
      // the compile barrier also covers the browser's image decode work.
      try {
        const decode = loaded.image.decode?.()
        if (decode) void decode.then(() => resolveReady(loaded), fail)
        else resolveReady(loaded)
      } catch (error) {
        fail(error)
      }
    },
    undefined,
    fail,
  )
  const record = { texture, ready }
  records.set(path, record)
  return record
}

/** Get the stable texture object used by a material builder. */
export function sceneTexture(path: string): Texture {
  return recordFor(path).texture
}

/** Start and await every image used by a selected apartment. */
export async function preloadSceneAssets(id: ApartmentId): Promise<void> {
  await Promise.all(SCENE_ASSETS[id].map((path) => recordFor(path).ready))
}

/** Exposed for tests and diagnostics; returns a copy so callers cannot mutate the manifest. */
export function sceneAssetPaths(id: ApartmentId): string[] {
  return [...SCENE_ASSETS[id]]
}
