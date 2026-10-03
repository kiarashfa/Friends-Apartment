import assert from 'node:assert/strict'
import test from 'node:test'

const {
  COMPILE_BATCH_SIZE,
  compileBatches,
  freezeShadowUpdates,
  shadowWarmupLights,
} = await import('../src/core/loading.ts')

test('compile batches cover every mesh exactly once', () => {
  assert.equal(COMPILE_BATCH_SIZE, 24)
  assert.deepEqual(compileBatches(0), [])
  assert.deepEqual(compileBatches(50), [
    { start: 0, end: 24 },
    { start: 24, end: 48 },
    { start: 48, end: 50 },
  ])

  assert.throws(() => compileBatches(-1), RangeError)
  assert.throws(() => compileBatches(4, 0), RangeError)
})

test('shadow warmup freezes only shadow-casting lights', () => {
  const shadowed = { castShadow: true, shadow: { autoUpdate: true, needsUpdate: true } }
  const unshadowed = { castShadow: false, shadow: { autoUpdate: true, needsUpdate: true } }
  const absent = { castShadow: true, shadow: null }
  const lights = [shadowed, unshadowed, absent]

  freezeShadowUpdates(lights)
  assert.deepEqual(shadowed.shadow, { autoUpdate: false, needsUpdate: false })
  assert.deepEqual(unshadowed.shadow, { autoUpdate: true, needsUpdate: true })
  assert.deepEqual(shadowWarmupLights(lights), [shadowed])
})

