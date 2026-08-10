import { describe, expect, it } from 'vitest'

import { advanceCrossings } from './crossings'

describe('advanceCrossings', () => {
  it('holds still for a head that is tracking properly', () => {
    // Both decks spend most of their life here — play speed on the program
    // path, a threaded loop running forward — and a pattern that crept while
    // the head was on track would put bars over a clean picture.
    expect(advanceCrossings(0, 0)).toBe(0)
    expect(advanceCrossings(12.5, 0)).toBe(12.5)
  })

  it('sweeps either way off play speed', () => {
    // Forward and back are both crossings: a loop pulled backwards is not
    // clean either, and never was on a two-head machine.
    expect(advanceCrossings(0, 3)).toBeGreaterThan(0)
    expect(advanceCrossings(0, -3)).toBeLessThan(0)
  })

  it('moves even at a standstill, because the servo still hunts', () => {
    // A pause is one bar standing still — but a transport never sits on an
    // exact multiple of play speed, so "standing still" still creeps. Without
    // the hunt term a paused deck's bar would be frozen rather than alive.
    expect(advanceCrossings(0, -1)).not.toBe(0)
  })

  it('wraps far out, so strip identities do not all reroll at once', () => {
    // The shader takes fract() of this, so any integer wrap draws the same
    // pattern — what the size buys is rarity, since the wrap is also where the
    // strip seeds jump. One reroll per 1024 crossings hides under the bars.
    let phase = 1023.9
    for (let i = 0; i < 100; i++) phase = advanceCrossings(phase, 1)
    expect(Math.abs(phase)).toBeLessThan(1024)
  })

  it('sweeps in proportion to the crossing count', () => {
    // Four bars sweep four times as fast as one, which is what makes the same
    // function serve both decks: each hands over its own speed less one, and
    // the pattern follows the count rather than which deck asked.
    // Differenced against each other rather than against a bare hunt term, so
    // the constant cancels exactly instead of nearly.
    const step = advanceCrossings(0, 2) - advanceCrossings(0, 1)
    expect(advanceCrossings(0, 4) - advanceCrossings(0, 1)).toBeCloseTo(
      3 * step,
      12,
    )
  })
})
