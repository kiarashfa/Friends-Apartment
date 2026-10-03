import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'

const assets = await import('../src/core/sceneAssets.ts')
const { SCENE_ASSETS, sceneAssetPaths, preloadSceneAssets, sceneTexture } = assets

test('scene asset manifests include every image-backed material exactly once', () => {
  assert.deepEqual(sceneAssetPaths('19'), [
    '/Laurel_and_Hardy_poster.jpeg',
    '/Vendetta_poster.jpg',
    '/die_hard.jpeg',
  ])
  assert.deepEqual(sceneAssetPaths('20'), ['/poster.jpg'])
  assert.deepEqual(sceneAssetPaths('perk'), [
    '/status_of_liberty_painting.png',
    '/central_perk_sticker.png',
  ])

  const copy = sceneAssetPaths('20')
  copy.push('/unexpected.png')
  assert.deepEqual(sceneAssetPaths('20'), ['/poster.jpg'])
  assert.equal(Object.keys(SCENE_ASSETS).length, 3)
})

test('preload and material builders share one decoded texture request', async () => {
  const originalLoad = THREE.TextureLoader.prototype.load
  let calls = 0
  THREE.TextureLoader.prototype.load = function (path, onLoad) {
    calls++
    const texture = new THREE.Texture()
    texture.image = { decode: () => Promise.resolve() }
    queueMicrotask(() => onLoad?.(texture))
    return texture
  }
  try {
    await preloadSceneAssets('20')
    const fromMaterial = sceneTexture('/poster.jpg')
    const fromSecondLookup = sceneTexture('/poster.jpg')
    assert.strictEqual(fromMaterial, fromSecondLookup)
    assert.equal(calls, 1)
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad
  }
})
