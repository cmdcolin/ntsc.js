import { describe, expect, it } from 'vitest'

import {
  ZOOM_MAX,
  boxToLens,
  lensView,
  panLens,
  pictureUv,
  zoomAtTravel,
  zoomToBox,
  zoomTravel,
} from './lens'

// A 4:3 window, so the picture fills it and canvas UV is picture UV.
const SQUARE = { width: 400, height: 300 }
// Wider than 4:3: the picture is 400 wide, centred, with 100px of black each side.
const WIDE = { width: 600, height: 300 }

describe('pictureUv', () => {
  it('maps the centre and corners of a 4:3 window', () => {
    expect(pictureUv(SQUARE, 200, 150)).toEqual({ u: 0.5, v: 0.5 })
    expect(pictureUv(SQUARE, 0, 0)).toEqual({ u: 0, v: 0 })
    expect(pictureUv(SQUARE, 400, 300)).toEqual({ u: 1, v: 1 })
  })
  it('reports the letterbox as outside 0..1', () => {
    expect(pictureUv(WIDE, 300, 150)).toEqual({ u: 0.5, v: 0.5 })
    expect(pictureUv(WIDE, 100, 150).u).toBeCloseTo(0)
    expect(pictureUv(WIDE, 50, 150).u).toBeLessThan(0)
  })
})

describe('lensView', () => {
  it('covers the whole picture at 1x', () => {
    expect(lensView(1, 0.2, 0.9)).toEqual({ size: 1, x: 0.5, y: 0.5 })
  })
  it('holds the lens inside the picture', () => {
    expect(lensView(4, 0, 1)).toEqual({ size: 0.25, x: 0.125, y: 0.875 })
  })
})

describe('the magnifier travel', () => {
  it('runs from 1x to all the way in — pulling back is not on the track', () => {
    expect(zoomAtTravel(0)).toBe(1)
    expect(zoomAtTravel(1)).toBe(ZOOM_MAX)
  })
  it('round-trips a magnification at or above 1x', () => {
    for (const z of [1, 1.3, 4, 12]) {
      expect(zoomAtTravel(zoomTravel(z))).toBeCloseTo(z)
    }
  })
  it('parks at the low end for a magnification below 1x, unreachable by travel', () => {
    for (const z of [0.25, 0.4, 0.8]) {
      expect(zoomTravel(z)).toBe(0)
    }
  })
  it('is gradual where it matters: a fifth of the way in is barely magnified', () => {
    const fifth = zoomAtTravel(0.2)
    expect(fifth).toBeGreaterThan(1.1)
    expect(fifth).toBeLessThan(1.3)
  })
})

describe('panLens', () => {
  it('moves the glass with the pointer, scaled by the magnification', () => {
    // Dragging right by a tenth of the picture at 4x pulls the lens left by a
    // fortieth: the glass follows the hand, not the screen.
    expect(panLens({ zoom: 4, x: 0.5, y: 0.5 }, 0.1, 0).x).toBeCloseTo(0.475)
  })
  it('leaves the magnification alone', () => {
    expect(panLens({ zoom: 3, x: 0.5, y: 0.5 }, 0.2, 0.2).zoom).toBe(3)
  })
})

describe('boxToLens', () => {
  it('reads the box as the view outright: a quarter of the glass is 4x', () => {
    const lens = boxToLens({ u: 0.25, v: 0.25 }, { u: 0.5, v: 0.5 })
    expect(lens.zoom).toBeCloseTo(4)
    expect(lens.x).toBeCloseTo(0.375)
    expect(lens.y).toBeCloseTo(0.375)
  })
  it('takes the longer edge, so everything boxed stays in view', () => {
    expect(boxToLens({ u: 0.5, v: 0 }, { u: 0.6, v: 1 }).zoom).toBeCloseTo(1)
  })
  it('does not compound — the same box means the same view every time', () => {
    const a = { u: 0.5, v: 0.5 }
    const b = { u: 0.75, v: 0.75 }
    expect(boxToLens(a, b)).toEqual(boxToLens(a, b))
    expect(boxToLens(a, b).zoom).toBeCloseTo(4)
  })
  it('stops at full magnification for a box smaller than the lens can hold', () => {
    expect(boxToLens({ u: 0.5, v: 0.5 }, { u: 0.501, v: 0.501 }).zoom).toBe(
      ZOOM_MAX,
    )
  })
  it('never pulls back: any box is at least the whole picture', () => {
    expect(boxToLens({ u: 0, v: 0 }, { u: 1, v: 1 }).zoom).toBeCloseTo(1)
  })
})

describe('zoomToBox', () => {
  it('magnifies by the fraction of the picture the box covers', () => {
    const box = zoomToBox(
      { zoom: 1, x: 0.5, y: 0.5 },
      { u: 0.25, v: 0.25 },
      { u: 0.5, v: 0.5 },
    )
    expect(box.zoom).toBeCloseTo(4)
    expect(box.x).toBeCloseTo(0.375)
    expect(box.y).toBeCloseTo(0.375)
  })
  it('takes the longer edge, so everything drawn stays in view', () => {
    const box = zoomToBox(
      { zoom: 1, x: 0.5, y: 0.5 },
      { u: 0.5, v: 0.5 },
      { u: 0.6, v: 1 },
    )
    expect(box.zoom).toBeCloseTo(2)
  })
  it('compounds on the view already magnified', () => {
    const lens = { zoom: 2, x: 0.5, y: 0.5 }
    const half = { u: 0.25, v: 0.25 }
    const box = zoomToBox(lens, half, { u: 0.75, v: 0.75 })
    expect(box.zoom).toBeCloseTo(4)
    // the box was centred, so the lens does not move
    expect(box.x).toBeCloseTo(0.5)
  })
})
