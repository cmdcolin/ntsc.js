import { describe, expect, it } from 'vitest'

import { persistToTravel, persistToValue } from './curve'
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

describe('travel registry', () => {
  it('leaves an uncurved control linear', () => {
    const span = { min: 0, max: 4 }
    expect(toTravel(span, 1)).toBeCloseTo(0.25, 9)
    expect(fromTravel(span, 0.25)).toBeCloseTo(1, 9)
  })

  it('routes a curved control through its curve', () => {
    const span = { min: 0, max: 0.9995, curve: 'persistence' as const }
    expect(toTravel(span, 0.9)).toBeCloseTo(persistToTravel(0.9), 9)
    expect(fromTravel(span, 0.4)).toBeCloseTo(persistToValue(0.4), 9)
  })
})
