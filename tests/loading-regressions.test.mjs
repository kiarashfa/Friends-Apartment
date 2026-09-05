import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const night = await readFile(new URL('../src/scenes/night.ts', import.meta.url), 'utf8')
const [joeyMaterials, monicaLiving, perkMaterials] = await Promise.all([
  readFile(new URL('../src/scenes/joey/materials.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/scenes/monica/living.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/scenes/perk/materials.ts', import.meta.url), 'utf8'),
])

test('startup awaits the shared pipeline promise and compiles through the configured pass', () => {
  assert.match(main, /const sharedPipelineReady=\(async\(\)=>[\s\S]*?\}\)\(\)/)
  assert.match(main, /const compileScenePass=async\(\):Promise<void>=>[\s\S]*?await scenePass\.compileAsync\(renderer\)/)
  assert.doesNotMatch(main, /await renderer\.compileAsync\(world\.scene,camera\)/)
})

test('scene loading keeps image and seating work inside the upfront barrier', () => {
  assert.match(main, /const assetsReady=preloadSceneAssets\(id\)/)
  assert.match(main, /Promise\.all\(\[definitionRequest,assetsReady,sharedPipelineReady\]\)/)
  assert.match(main, /const seatingModule=loadSeatingModule\(\)/)
  assert.match(main, /await activateApartment\(apartment,seatingModule\)/)
  for (const materials of [joeyMaterials, monicaLiving, perkMaterials]) {
    assert.doesNotMatch(materials, /new THREE\.TextureLoader\(\)/)
  }
})

test('shadow warmup uses scene-only renders before one final post-process render', () => {
  assert.match(main, /const renderScenePassOnly=\(\):void=>/)
  assert.match(main, /renderScenePassOnly\(\)/)
  assert.match(main, /postProcessing\.render\(\)\n      await nextFrame\(\)\n    }finally\{scenePass\.scene=previousScene\}/)
})

test('night environment uses one lazy texture identity for every scene', () => {
  assert.match(night, /let sharedIbl: \{ texture: THREE\.DataTexture; avg: V3 \} \| null = null/)
  assert.match(night, /return sharedIbl \?\?= bakeIbl\(\)/)
  assert.match(night, /const ibl = getSharedNightIbl\(\)/)
})
