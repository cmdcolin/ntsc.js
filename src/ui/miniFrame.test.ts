import { describe, expect, it } from 'vitest'

import { WIPE_SHAPES, resizeAxis, snapOffset } from './miniFrame'

describe('resizeAxis', () => {
  it('pins the opposite edge', () => {
    const r = resizeAxis(0.5, 0.4, 1, 0.9)
    expect(r.size).toBeCloseTo(0.6)
    expect(r.center - r.size / 2).toBeCloseTo(0.3)
  })
  it('pins the far edge when the near one moves', () => {
    const r = resizeAxis(0.5, 0.4, -1, 0.1)
    expect(r.size).toBeCloseTo(0.6)
    expect(r.center + r.size / 2).toBeCloseTo(0.7)
  })
  it('holds the minimum size instead of collapsing or flipping', () => {
    expect(resizeAxis(0.5, 0.4, 1, 0.31).size).toBeCloseTo(0.1)
    expect(resizeAxis(0.5, 0.4, 1, 0.0).size).toBeCloseTo(0.3)
  })
  it('never exceeds the full picture', () => {
    expect(resizeAxis(0.5, 0.9, 1, 3).size).toBe(1)
  })
})

describe('snapOffset', () => {
  it('lands a near point on its guide', () => {
    expect(snapOffset([0.505], true)).toBeCloseTo(-0.005)
    expect(snapOffset([0.008], true)).toBeCloseTo(-0.008)
  })
  it('takes the closest of several dragged points', () => {
    expect(snapOffset([0.505, 0.752], true)).toBeCloseTo(-0.002)
  })
  it('leaves distant points and precision drags alone', () => {
    expect(snapOffset([0.44], true)).toBe(0)
    expect(snapOffset([0.505], false)).toBe(0)
  })
})

// These mirror the pattern generator in mix_b.wgsl — if the shader's distance
// functions change, the miniature's drag mapping has to move with them.
describe('WIPE_SHAPES', () => {
  const pos = (mode: number, u: number, v: number) => {
    const shape = WIPE_SHAPES.get(mode)
    return shape === undefined ? NaN : shape.pos(u, v)
  }
  it('h and v read the axis under the cursor', () => {
    expect(pos(1, 0.3, 0.9)).toBeCloseTo(0.3)
    expect(pos(2, 0.9, 0.3)).toBeCloseTo(0.3)
  })
  it('box reads twice the chebyshev distance from center', () => {
    expect(pos(3, 0.3, 0.5)).toBeCloseTo(0.4)
    expect(pos(3, 0.5, 0.5)).toBeCloseTo(0)
    expect(pos(3, 0, 0)).toBeCloseTo(1)
  })
  it('diamond reads the manhattan distance from center', () => {
    expect(pos(4, 0.3, 0.4)).toBeCloseTo(0.3)
    expect(pos(4, 0.5, 0.5)).toBeCloseTo(0)
  })
  it('draws a region whose edge sits at the lever position', () => {
    const num = (v: string | number | undefined) => parseFloat(String(v))
    expect(num(WIPE_SHAPES.get(1)?.region(0.4).width)).toBeCloseTo(40)
    expect(num(WIPE_SHAPES.get(3)?.region(0.4).left)).toBeCloseTo(30)
    expect(num(WIPE_SHAPES.get(4)?.region(0.3).width)).toBeCloseTo(60)
  })
})
