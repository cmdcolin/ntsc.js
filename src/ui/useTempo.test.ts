import { describe, expect, it } from 'vitest'

import { bpmFromTaps } from './useTempo'

// Taps at a fixed spacing, in the ms the hook reads off performance.now().
const at = (gapMs: number, n: number) =>
  Array.from({ length: n }, (_, i) => 1000 + i * gapMs)

describe('bpmFromTaps', () => {
  it('says nothing until there are two taps to make a gap', () => {
    expect(bpmFromTaps([])).toBe(null)
    expect(bpmFromTaps([1000])).toBe(null)
  })

  it('reads two taps half a second apart as 120', () => {
    expect(bpmFromTaps(at(500, 2))).toBe(120)
  })

  it('averages the run rather than reading the last gap', () => {
    // A hand that lands 470, 530, 500 apart is beating 120, and taking the last
    // gap alone would have called it 120, 113 and 120 on three consecutive taps.
    expect(bpmFromTaps([0, 470, 1000, 1500])).toBe(120)
  })

  it('rounds to the tenth the readout shows', () => {
    // 7 taps 431ms apart is 139.21…, which has to round to what the field will
    // display or the number cannot be typed back in unchanged.
    expect(bpmFromTaps(at(431, 7))).toBe(139.2)
  })

  it('clamps a frantic or a glacial run into what a tempo can be', () => {
    expect(bpmFromTaps(at(50, 3))).toBe(300)
    expect(bpmFromTaps(at(60000, 2))).toBe(20)
  })

  it('refuses a run with no time in it rather than dividing by zero', () => {
    expect(bpmFromTaps([1000, 1000])).toBe(null)
  })
})
