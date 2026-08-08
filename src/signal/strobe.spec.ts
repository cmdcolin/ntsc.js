import { describe, expect, it } from 'vitest'

import { StrobeGate } from './strobe'

describe('StrobeGate', () => {
  it('leaves the beam scanning when it is off', () => {
    const g = new StrobeGate()
    for (let t = 0; t < 500; t += 16) {
      expect(g.step({ hz: 0, ms: 40 }, t)).toBe(0)
    }
  })

  it('cuts the beam outside the flash', () => {
    const g = new StrobeGate()
    const plan = { hz: 2, ms: 100 } // 500ms period
    g.step(plan, 0) // claims cycle 0's guaranteed flash
    expect(g.step(plan, 50)).toBe(0) // still inside the 100ms flash
    expect(g.step(plan, 150)).toBe(1) // past it: dark
    expect(g.step(plan, 499)).toBe(1)
  })

  // The rule borrowed from stab.ts: a flash shorter than the gap between frames
  // still lands, or the picture just goes dark and the rate control looks broken.
  it('guarantees one lit frame per cycle however short the flash', () => {
    const g = new StrobeGate()
    const plan = { hz: 4, ms: 1 } // 250ms period, 1ms flash — far under a frame
    let lit = 0
    // 60fps for two seconds: eight cycles, so eight flashes
    for (let f = 0; f < 120; f++) {
      if (g.step(plan, f * (1000 / 60)) === 0) lit++
    }
    expect(lit).toBe(8)
  })

  it('holds its phase across a rate change rather than restarting', () => {
    const g = new StrobeGate()
    g.step({ hz: 2, ms: 100 }, 0)
    // same cycle, longer flash: still lit, not re-triggered
    expect(g.step({ hz: 2, ms: 200 }, 150)).toBe(0)
    expect(g.step({ hz: 2, ms: 200 }, 250)).toBe(1)
  })

  it('starts a fresh train after being parked', () => {
    const g = new StrobeGate()
    const plan = { hz: 2, ms: 10 }
    g.step(plan, 0)
    expect(g.step(plan, 100)).toBe(1)
    g.step({ hz: 0, ms: 10 }, 200) // parked: cycle count cleared
    // back on mid-cycle, and the flash lands now rather than waiting for the
    // next period boundary
    expect(g.step(plan, 300)).toBe(0)
  })
})
