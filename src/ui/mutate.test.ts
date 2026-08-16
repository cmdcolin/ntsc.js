import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { rngFor } from '../rng'
import { GROUPS } from './controls'
import { mutate } from './mutate'

const SLIDERS = GROUPS.flatMap(g => g.sliders)

describe('mutate', () => {
  it('keeps every control within its slider range, even at extreme jitter', () => {
    for (const rand of [() => 0, () => 1, () => 0.5]) {
      const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.5, rand)
      for (const s of SLIDERS) {
        expect(out[s.key], s.key).toBeGreaterThanOrEqual(s.min)
        expect(out[s.key], s.key).toBeLessThanOrEqual(s.max)
      }
    }
  })

  it('snaps step-1 controls to whole values so no shader hits a fractional mode', () => {
    const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.3, () => 0.8)
    for (const s of SLIDERS.filter(def => def.step === 1)) {
      expect(Number.isInteger(out[s.key]), s.key).toBe(true)
    }
  })

  it('is a pure function of its rand, leaving the input untouched', () => {
    const input = { ...DEFAULT_CONTROLS }
    const a = mutate(input, SLIDERS, 0.2, () => 0.3)
    const b = mutate(input, SLIDERS, 0.2, () => 0.3)
    expect(a).toEqual(b)
    expect(input).toEqual(DEFAULT_CONTROLS)
  })

  // The button's own bug: any rate a roll could reach cuts the beam for ~95% of
  // every cycle, so half of all presses replaced the look with a flashing black
  // screen. Off zero it is a control like any other.
  it('never starts a strobe on a look that has none', () => {
    for (const rand of [() => 0, () => 1, () => 0.5, () => 0.9]) {
      expect(mutate(DEFAULT_CONTROLS, SLIDERS, 0.6, rand).strobeHz).toBe(0)
    }
  })

  it('still jitters a strobe that is already running', () => {
    const on = { ...DEFAULT_CONTROLS, strobeHz: 3.5 }
    expect(mutate(on, SLIDERS, 0.12, () => 1).strobeHz).toBeGreaterThan(3.5)
  })

  // Skipping a control must not skip its draw, or a control's roll would depend
  // on what every control before it was resting at.
  it('rolls the rest of the look the same whether the strobe is skipped or not', () => {
    const off = mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, rngFor(7))
    const on = mutate(
      { ...DEFAULT_CONTROLS, strobeHz: 3.5 },
      SLIDERS,
      0.12,
      rngFor(7),
    )
    for (const s of SLIDERS.filter(d => d.key !== 'strobeHz')) {
      expect(on[s.key], s.key).toBe(off[s.key])
    }
  })

  it('jitters around the current look, never more than the amount times range', () => {
    const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, () => 0.9)
    for (const s of SLIDERS) {
      const bound = 0.12 * (s.max - s.min) + s.step
      expect(
        Math.abs(out[s.key] - DEFAULT_CONTROLS[s.key]),
        s.key,
      ).toBeLessThanOrEqual(bound)
    }
  })
})
