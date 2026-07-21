import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROLS } from '../controls'
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
    for (const s of SLIDERS.filter(s => s.step === 1)) {
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
