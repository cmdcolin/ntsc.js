import { describe, expect, it } from 'vitest'

import {
  fineToTravel,
  fineToValue,
  persistToTravel,
  persistToValue,
  TRAVEL_STEP,
} from './curve'
import { fromTravel, toTravel } from './travel'

// Trail length at a track position: the decay is second-order, so how long a
// hold lasts goes as 1/(1 - retention). This is what the curve is spreading
// evenly, not the retention fraction itself.
const len = (t: number) => 1 / (1 - persistToValue(t))

describe('persistence travel', () => {
  it('pins both ends: 0 is off, 1 is the slider max', () => {
    expect(persistToValue(0)).toBe(0)
    expect(persistToValue(1)).toBeCloseTo(0.9995, 6)
    expect(persistToTravel(0)).toBe(0)
    expect(persistToTravel(0.9995)).toBeCloseTo(1, 6)
  })

  it('round-trips without creeping', () => {
    for (const v of [0, 0.3, 0.65, 0.8, 0.9, 0.99, 0.999, 0.9995]) {
      expect(persistToTravel(persistToValue(persistToTravel(v)))).toBeCloseTo(
        persistToTravel(v),
        9,
      )
      expect(persistToValue(persistToTravel(v))).toBeCloseTo(v, 9)
    }
  })

  // The whole point of the curve: equal moves are equal *ratios* of trail
  // length, not equal steps of a retention fraction nobody reads directly.
  // Trail length goes as 1/(1 - v), so thirds of the track should be a roughly
  // constant multiple apart rather than the ~1000x-in-the-last-notch a linear
  // track gave.
  it('spreads trail length evenly along the track', () => {
    const a = len(2 / 3) / len(1 / 3)
    const b = len(1) / len(2 / 3)
    expect(a).toBeGreaterThan(5)
    expect(a / b).toBeGreaterThan(0.5)
    expect(a / b).toBeLessThan(2)
  })

  it('keeps the mid-track hold in the range presets actually use', () => {
    // half travel should land in the tenths-of-a-second region, not on a hold
    // too short to see (the old linear track's midpoint) nor in the seconds
    expect(persistToValue(0.5)).toBeGreaterThan(0.9)
    expect(persistToValue(0.5)).toBeLessThan(0.995)
  })
})

// The loop's rotate, which is what the fine curve was written for: ±180° of
// travel over a mechanism whose whole repertoire is the first degree.
const ROTATE = { min: -180, max: 180, step: 0.01 }
// And an asymmetric one whose fine point is not its centre: the loop's zoom.
const ZOOM = { min: 0.2, max: 4, step: 0.001 }

describe('fine travel', () => {
  it('pins the ends and the fine point', () => {
    expect(fineToValue(ROTATE, 0, 0)).toBeCloseTo(-180, 9)
    expect(fineToValue(ROTATE, 0, 0.5)).toBe(0)
    expect(fineToValue(ROTATE, 0, 1)).toBeCloseTo(180, 9)
    expect(fineToTravel(ROTATE, 0, 0)).toBe(0.5)
    // The fine point keeps the track position it had when the map was linear,
    // so a control's rest position does not move when it takes a curve.
    expect(fineToTravel(ZOOM, 1, 1)).toBeCloseTo((1 - 0.2) / 3.8, 9)
    expect(fineToValue(ZOOM, 1, (1 - 0.2) / 3.8)).toBeCloseTo(1, 9)
    expect(fineToValue(ZOOM, 1, 0)).toBeCloseTo(0.2, 9)
    expect(fineToValue(ZOOM, 1, 1)).toBeCloseTo(4, 9)
  })

  it('round-trips without creeping', () => {
    for (const v of [-180, -31.4, -1, -0.02, 0, 0.02, 1, 31.4, 180])
      expect(fineToValue(ROTATE, 0, fineToTravel(ROTATE, 0, v))).toBeCloseTo(
        v,
        6,
      )
    for (const v of [0.2, 0.5, 0.95, 1, 1.05, 2.5, 4])
      expect(fineToValue(ZOOM, 1, fineToTravel(ZOOM, 1, v))).toBeCloseTo(v, 6)
  })

  it('is symmetric about the fine point when the span is', () => {
    for (const t of [0, 0.1, 0.37, 0.5])
      expect(fineToValue(ROTATE, 0, 0.5 - t)).toBeCloseTo(
        -fineToValue(ROTATE, 0, 0.5 + t),
        9,
      )
  })

  // The contract the curve is solved for: one notch of travel at the fine point
  // moves the value by about one of the control's own steps — the finest thing
  // it can store, and no finer, so no stretch of track is spent on moves that
  // snap back to the same number.
  it('resolves one step per notch at the fine point', () => {
    for (const [span, stock] of [
      [ROTATE, 0],
      [ZOOM, 1],
    ] as const) {
      const at = fineToTravel(span, stock, stock)
      const one = fineToValue(span, stock, at + TRAVEL_STEP) - stock
      expect(one / span.step).toBeGreaterThan(0.5)
      expect(one / span.step).toBeLessThan(2)
    }
  })

  // And what pays for it: the far end is coarse. Worth asserting because it is
  // the trade, not a defect — past rotate's redline a notch is worth degrees.
  it('coarsens toward the stops', () => {
    const near = fineToValue(ROTATE, 0, 0.5 + TRAVEL_STEP)
    const far = 180 - fineToValue(ROTATE, 0, 1 - TRAVEL_STEP)
    expect(far / near).toBeGreaterThan(100)
  })

  // Where the tuned range lands, which is the sanity check on solving k off the
  // step grid rather than hand-placing a knee: rotate's redline is ±30 of ±180,
  // and it should come out around two thirds of the way out rather than in the
  // first few pixels (linear puts it at 8%).
  it('gives the tuned range most of the track', () => {
    const t = fineToTravel(ROTATE, 0, 30)
    expect((t - 0.5) * 2).toBeGreaterThan(0.55)
    expect((t - 0.5) * 2).toBeLessThan(0.85)
  })

  // A control whose linear track already resolves its own steps gets a straight
  // one back: the curve is only ever undoing coarseness that is there.
  it('leaves an already-fine control straight', () => {
    const span = { min: -1, max: 1, step: 0.1 }
    expect(fineToValue(span, 0, 0.75)).toBeCloseTo(0.5, 9)
  })
})

describe('travel registry', () => {
  it('leaves an uncurved control linear', () => {
    const span = { min: 0, max: 4, step: 0.01 }
    expect(toTravel(span, 1)).toBeCloseTo(0.25, 9)
    expect(fromTravel(span, 0.25)).toBeCloseTo(1, 9)
  })

  it('routes a curved control through its curve', () => {
    const span = {
      min: 0,
      max: 0.9995,
      step: 0.0001,
      curve: 'persistence' as const,
    }
    expect(toTravel(span, 0.9)).toBeCloseTo(persistToTravel(0.9), 9)
    expect(fromTravel(span, 0.4)).toBeCloseTo(persistToValue(0.4), 9)
  })
})
