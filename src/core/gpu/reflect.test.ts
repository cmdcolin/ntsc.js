import { describe, expect, it } from 'vitest'

import { reflectBindings } from './reflect'
import decode from './shaders/decode.wgsl?raw'
import feed from './shaders/feed.wgsl?raw'

const shaders = import.meta.glob('./shaders/*.wgsl', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('reflectBindings', () => {
  it('reads every shader as one dense group-0 binding list', () => {
    for (const [file, src] of Object.entries(shaders)) {
      const b = reflectBindings(src)
      expect(b.length, file).toBeGreaterThan(0)
      b.forEach((x, i) => {
        expect(x.group, `${file} ${x.name}`).toBe(0)
        expect(x.binding, `${file} ${x.name}`).toBe(i)
      })
      expect(new Set(b.map(x => x.name)).size, file).toBe(b.length)
    }
  })

  it('classifies spaces from the qualifier and the type', () => {
    expect(reflectBindings(decode).map(b => `${b.name}:${b.space}`)).toEqual([
      'P:uniform',
      'filters:storage',
      'comp:storage',
      'lineInfo:storage',
      'timing:storage',
      'outTex:storage_texture',
      'held:storage',
      'heldNext:storage_rw',
      'audio:storage',
    ])
    expect(reflectBindings(feed).map(b => b.name)).toEqual(['P', 'src', 'dst'])
  })

  it('ignores declarations inside comments', () => {
    const src = `// @group(0) @binding(9) var<storage, read> ghost: array<f32>;
@group(0) @binding(0) var<uniform> P: Params;`
    expect(reflectBindings(src).map(b => b.name)).toEqual(['P'])
  })
})
