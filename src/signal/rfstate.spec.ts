import { describe, expect, it } from 'vitest'

import { LINES, SAMPLES_PER_LINE } from './constants'
import { RfState } from './rfstate'

const N = SAMPLES_PER_LINE * LINES

describe('RfState', () => {
  it('is deterministic in the frame count', () => {
    const a = new RfState()
    const b = new RfState()
    for (let f = 0; f < 200; f++) {
      expect(a.update(f)).toEqual(b.update(f))
    }
  })

  it('keeps every accumulator wrapped into its domain', () => {
    const rf = new RfState()
    for (let f = 0; f < 5000; f += 7) {
      const u = rf.update(f)
      expect(u.rfAdjTau).toBeGreaterThanOrEqual(0)
      expect(u.rfAdjTau).toBeLessThan(N)
      expect(u.rfAdjPhase).toBeGreaterThanOrEqual(0)
      expect(u.rfAdjPhase).toBeLessThan(2 * Math.PI)
      expect(u.rfAdjPhaseS).toBeGreaterThanOrEqual(0)
      expect(u.rfAdjPhaseS).toBeLessThan(2 * Math.PI)
    }
  })

  it('bounds the line-rate mismatch and lets it change sign', () => {
    const rf = new RfState()
    let lo = Infinity
    let hi = -Infinity
    for (let f = 0; f < 60 * 600; f++) {
      const { rfAdjEps } = rf.update(f)
      lo = Math.min(lo, rfAdjEps)
      hi = Math.max(hi, rfAdjEps)
    }
    // |eps| stays inside +-1.6e-3 (a ~25 Hz line-rate error) ...
    expect(Math.abs(lo)).toBeLessThan(1.7e-3)
    expect(hi).toBeLessThan(1.7e-3)
    // ... the slip genuinely runs (the bars sweep) ...
    expect(hi).toBeGreaterThan(3e-4)
    // ... and over ten minutes the wander crosses zero, where the wiper
    // hangs and reverses instead of orbiting at a fixed rate.
    expect(lo).toBeLessThan(0)
  })
})
