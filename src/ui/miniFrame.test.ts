import { describe, expect, it } from 'vitest'

import { WIPE_SHAPES, nudgeFor, resizeAxis, snapOffset } from './miniFrame'

// The keyboard half of a miniature, and the reason it is one function: four
// frames take this gesture, a miniature is the only way to reach the sliders it
// hides, and a family where alt resizes on three pads and does nothing on the
// fourth is a family nobody learns.
describe('nudgeFor', () => {
  const press = (key: string, mod: { shift?: boolean; alt?: boolean } = {}) => {
    let prevented = false
    const n = nudgeFor({
      key,
      shiftKey: mod.shift === true,
      altKey: mod.alt === true,
      preventDefault: () => {
        prevented = true
      },
    })
    return { n, prevented }
  }

  it('turns each arrow into its own direction', () => {
    expect(press('ArrowLeft').n).toMatchObject({ du: -1, dv: 0 })
    expect(press('ArrowRight').n).toMatchObject({ du: 1, dv: 0 })
    expect(press('ArrowUp').n).toMatchObject({ du: 0, dv: -1 })
    expect(press('ArrowDown').n).toMatchObject({ du: 0, dv: 1 })
  })

  it('goes further with shift', () => {
    expect(press('ArrowRight').n?.d).toBeCloseTo(0.005)
    expect(press('ArrowRight', { shift: true }).n?.d).toBeCloseTo(0.05)
  })

  it('reads alt as the frame’s other quantity', () => {
    expect(press('ArrowRight').n?.resize).toBe(false)
    expect(press('ArrowRight', { alt: true }).n?.resize).toBe(true)
  })

  // The half that is a side effect on purpose: an arrow the frame claims must
  // not also scroll the panel out from under it.
  it('consumes the keys it claims and leaves the rest alone', () => {
    expect(press('ArrowUp').prevented).toBe(true)
    const other = press('Enter')
    expect(other.n).toBe(null)
    expect(other.prevented).toBe(false)
  })

  // The magnifier's, which walks a fraction of what is in view rather than of
  // the picture.
  it('takes a caller’s own pair of steps', () => {
    const step = { fine: 0.05, coarse: 0.25 }
    const at = (shiftKey: boolean) =>
      nudgeFor(
        { key: 'ArrowLeft', shiftKey, altKey: false, preventDefault: () => {} },
        step,
      )?.d
    expect(at(false)).toBeCloseTo(0.05)
    expect(at(true)).toBeCloseTo(0.25)
  })
})

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
