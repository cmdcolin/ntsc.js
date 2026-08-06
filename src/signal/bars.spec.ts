import { describe, expect, it } from 'vitest'

import { SMPTE_BAR_RGB } from '../sources/pattern'
import { BAR_FULL_SCALE, BAR_LEVEL, BAR_TARGETS } from './constants'

// The vectorscope's graticule is generated from BAR_TARGETS (see prelude.ts),
// so nothing downstream can disagree with it — but a *self*-consistent wrong
// derivation would still draw boxes in the wrong places, and an instrument that
// lies is worse than no instrument. So these check against published NTSC
// values rather than against the code: the six graticule angles a vectorscope
// face has been printed with since the 1950s.
const deg = ([u, v]: readonly [number, number]) =>
  ((Math.atan2(v, u) * 180) / Math.PI + 360) % 360

describe('colour-bar vectorscope targets', () => {
  // red, yellow, green, cyan, blue, magenta — the order BAR_TARGETS is in.
  const published = [103.5, 167.1, 240.7, 283.5, 347.1, 60.7]

  it('lands on the published NTSC graticule angles', () => {
    BAR_TARGETS.forEach((t, i) => {
      expect(deg(t), `target ${i}`).toBeCloseTo(published[i], 1)
    })
  })

  // A bar and its complement are the same colour difference with the sign
  // flipped, so they are exactly opposite. If a matrix change ever breaks this
  // the graticule has stopped being a hexagon and something is badly wrong.
  it('puts complementary bars opposite each other', () => {
    for (const [a, b] of [
      [0, 3],
      [1, 4],
      [2, 5],
    ]) {
      expect(BAR_TARGETS[a][0]).toBeCloseTo(-BAR_TARGETS[b][0], 6)
      expect(BAR_TARGETS[a][1]).toBeCloseTo(-BAR_TARGETS[b][1], 6)
    }
  })

  // The boxes are deliberately not on a ring: yellow and blue carry about a
  // third of the chroma red and cyan do. Drawing them equidistant would be the
  // easy mistake, and it would put four of the six targets in the wrong place.
  it('keeps the targets at their own radii, not on a ring', () => {
    const r = BAR_TARGETS.map(t => Math.hypot(...t))
    expect(r[0]).toBeCloseTo(0.474, 3) // red
    expect(r[1]).toBeCloseTo(0.335, 3) // yellow
    expect(r[2]).toBeCloseTo(0.443, 3) // green
    expect(Math.max(...r) / Math.min(...r)).toBeGreaterThan(1.4)
  })

  // Full scale is 100% bars, so 75% bars sit comfortably inside the circle —
  // which is what leaves room for an overdriven picture to be visibly outside.
  it('puts 75% bars inside the display and 100% on its edge', () => {
    expect(Math.max(...BAR_TARGETS.map(t => Math.hypot(...t)))).toBeCloseTo(
      BAR_FULL_SCALE * BAR_LEVEL,
      6,
    )
    expect(BAR_FULL_SCALE * BAR_LEVEL).toBeLessThan(BAR_FULL_SCALE)
  })
})

describe('the pattern the app actually generates', () => {
  // The graticule is a standard, not a readout of our own test pattern, so
  // these are allowed to differ — but only by less than the target box, or the
  // bars would visibly miss boxes drawn for them. This is what would catch
  // smpteBars() being changed to 100% (or to something else entirely) without
  // the scope's calibration being reconsidered.
  const BOX_HALF = 0.055 * BAR_FULL_SCALE

  it('lands its bars inside the graticule boxes', () => {
    // pattern.ts draws the top band as grey then the six chroma bars, in the
    // graticule's order rotated: yellow, cyan, green, magenta, red, blue.
    const order = [1, 3, 2, 5, 0, 4]
    SMPTE_BAR_RGB.slice(1).forEach(([r, g, b], i) => {
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      const u = 0.492 * (b - y)
      const v = 0.877 * (r - y)
      const [tu, tv] = BAR_TARGETS[order[i]]
      expect(Math.hypot(u - tu, v - tv), `bar ${i}`).toBeLessThan(BOX_HALF)
    })
  })
})
