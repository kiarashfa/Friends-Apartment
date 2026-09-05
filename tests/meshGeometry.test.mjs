import assert from 'node:assert/strict'
import test from 'node:test'

const { MeshData, toGeometry } = await import('../src/lib/mesh.ts')

function values(geometry, name) {
  return Array.from(geometry.getAttribute(name).array)
}

test('toGeometry preserves quad triangulation and attributes', () => {
  const mesh = MeshData.from(
    [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
    ],
    [[0, 1, 2, 3]],
  )
  mesh.shading = { mode: 'smooth', angle: 32 }
  mesh.uvs = [[
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]]
  mesh.colors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
  ]
  mesh.colorName = 'vertexColor'

  const geometry = toGeometry(mesh)
  assert.equal(geometry.getAttribute('position').count, 6)
  assert.deepEqual(values(geometry, 'position'), [
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ])
  assert.deepEqual(values(geometry, 'normal'), [
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ])
  assert.deepEqual(values(geometry, 'uv'), [
    0, 0,
    1, 0,
    1, 1,
    0, 0,
    1, 1,
    0, 1,
  ])
  assert.deepEqual(values(geometry, 'vertexColor'), [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
    1, 0, 0,
    0, 0, 1,
    1, 1, 1,
  ])
})

test('toGeometry handles empty flat meshes without optional attributes', () => {
  const geometry = toGeometry(new MeshData())
  assert.equal(geometry.getAttribute('position').count, 0)
  assert.equal(geometry.getAttribute('normal').count, 0)
  assert.equal(geometry.getAttribute('uv'), undefined)
})

