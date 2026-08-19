import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import { Glide } from '../core/signal/glide'
import { morphTo } from './morph'

import type { ControlKey, Controls } from '../core/controls'

const NO_COARSE: ReadonlySet<ControlKey> = new Set<ControlKey>()

// The board halfway through a one-second morph to `to`. Halfway in time is
// halfway in eased travel — smoothstep is symmetric — so what this shows is the
// path, not the easing.
const halfway = (to: Partial<Controls>): Controls => {
  const live = { ...DEFAULT_CONTROLS }
  const g = new Glide(NO_COARSE)
  g.start(live, morphTo({ ...DEFAULT_CONTROLS, ...to }, 1), 0)
  g.apply(live, 500)
  return live
}

describe('morphTo', () => {
  // Linear in the value, half of the way to a radar tube is 0.496 — a hold of
  // two fields, which is to say nothing yet — and the whole journey from a
  // visible trail to seconds of afterglow happens in the last breath of the
  // morph. That is the opposite of what a morph is for.
  it('crosses a phosphor hold by ratio rather than in the last breath', () => {
    const mid = halfway({ phosphor: 0.99 }).phosphor
    expect(mid).toBeGreaterThan(0.85)
    expect(mid).toBeLessThan(0.95)
  })

  // The other side of the same rule: what a detune does lives either side of
  // lock, so half a morph out to 3 kHz is nowhere near 1.5 kHz.
  it('gives a detune the crawl either side of lock rather than the hash', () => {
    const mid = halfway({ hDetuneHz: 3000 }).hDetuneHz
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(750)
  })

  it('still crosses a linear control at half way', () => {
    expect(halfway({ noiseIre: 10 }).noiseIre).toBeCloseTo(5, 5)
  })
})
