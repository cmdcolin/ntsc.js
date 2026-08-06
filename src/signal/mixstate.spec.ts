import { describe, expect, it } from 'vitest'

import { LINES, SAMPLES_PER_LINE } from './constants'
import { MixState } from './mixstate'

import type { MixControls } from './mixstate'

const STILL: MixControls = {
  aPause: 0,
  bLineHz: 0,
  bDetuneHz: 0,
  bRollLps: 0,
  bPause: 0,
  wipePos: 0.5,
  wipeRateHz: 0,
}

const step = (m: MixState, c: Partial<MixControls>, n: number) => {
  let out = m.update({ ...STILL, ...c })
  for (let i = 1; i < n; i++) out = m.update({ ...STILL, ...c })
  return out
}

describe('MixState', () => {
  it('holds source B still when nothing is detuned', () => {
    const m = new MixState()
    const out = step(m, {}, 30)
    expect(out.bShift0).toBe(0)
    expect(out.bShiftLine).toBe(0)
    expect(out.bPhase0).toBe(0)
    expect(out.bRowOff).toBe(0)
    expect(out.wipePos).toBe(0.5)
  })

  it('skews B by its line-rate offset, a little more on each line', () => {
    const m = new MixState()
    // one frame of a +Hz line offset advances the accumulated shift by exactly
    // LINES times the per-line skew, which is what makes B lean rather than
    // just translate
    const out = step(m, { bLineHz: 1 }, 1)
    expect(out.bShift0).toBeCloseTo(out.bShiftLine * LINES, 6)
    expect(out.bShiftLine).toBeGreaterThan(0)
  })

  it('wraps the horizontal slip into one line rather than growing', () => {
    const m = new MixState()
    const out = step(m, { bLineHz: 8 }, 400)
    expect(out.bShift0).toBeGreaterThanOrEqual(0)
    expect(out.bShift0).toBeLessThan(SAMPLES_PER_LINE)
  })

  it('wraps a negative line offset positive instead of going negative', () => {
    const m = new MixState()
    const out = step(m, { bLineHz: -8 }, 50)
    expect(out.bShift0).toBeGreaterThanOrEqual(0)
    expect(out.bShift0).toBeLessThan(SAMPLES_PER_LINE)
  })

  it('keeps the subcarrier beat inside one turn', () => {
    const m = new MixState()
    for (let i = 0; i < 200; i++) {
      const out = m.update({ ...STILL, bDetuneHz: 400 })
      expect(out.bPhase0).toBeGreaterThanOrEqual(0)
      expect(out.bPhase0).toBeLessThan(2 * Math.PI + 1e-9)
    }
  })

  it('rolls B vertically by whole lines, wrapped into the raster', () => {
    const m = new MixState()
    const out = step(m, { bRollLps: 3 }, 500)
    expect(Number.isInteger(out.bRowOff)).toBe(true)
    expect(out.bRowOff).toBeGreaterThanOrEqual(0)
    expect(out.bRowOff).toBeLessThan(LINES)
  })

  it('ping-pongs the swept wipe inside 0..1 and reverses direction', () => {
    const m = new MixState()
    const seen: number[] = []
    for (let i = 0; i < 300; i++) {
      seen.push(m.update({ ...STILL, wipePos: 0, wipeRateHz: 1 }).wipePos)
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...seen)).toBeLessThanOrEqual(1)
    // a pure sawtooth would never decrease; the fold has to send it back down
    expect(seen.some((v, i) => i > 0 && v < seen[i - 1])).toBe(true)
    expect(seen.some((v, i) => i > 0 && v > seen[i - 1])).toBe(true)
  })

  it('wanders the timing and walks the stripe only while paused', () => {
    const m = new MixState()
    // in play, the deck is steady: no wobble reaches the feed
    expect(step(m, {}, 10).decks.b.shift).toBe(0)
    // held, the defeated servo wanders the shift and the stripe stays a row
    const held = new Set<number>()
    for (let i = 0; i < 60; i++) {
      const deck = m.update({ ...STILL, bPause: 1 }).decks.b
      held.add(deck.shift)
      expect(deck.bar).toBeGreaterThanOrEqual(0)
      expect(deck.bar).toBeLessThan(LINES)
      expect(deck.pause).toBe(1)
    }
    expect(held.size).toBeGreaterThan(1)
    // releasing the button stops the wander where the accumulators stand
    expect(m.update({ ...STILL }).decks.b.pause).toBe(0)
  })

  // The two decks are independent machines: A's button must not move B's
  // servo, which is what makes "the house deck held under a clean B" a
  // different picture from "a held B under a clean house deck".
  it('keeps the two decks off each other', () => {
    const m = new MixState()
    const held = step(m, { aPause: 1 }, 30)
    expect(held.decks.a.pause).toBe(1)
    expect(held.decks.a.shift).not.toBe(0)
    expect(held.decks.b.pause).toBe(0)
    expect(held.decks.b.shift).toBe(0)
  })

  // You stop a sweep because you like where it is, so the boundary stays there
  // rather than snapping back to the lever.
  it('parks the sweep where it stopped', () => {
    const m = new MixState()
    const swept = step(m, { wipePos: 0.5, wipeRateHz: 1 }, 20).wipePos
    expect(swept).not.toBeCloseTo(0.5, 3)
    // rate to zero, lever untouched: the boundary holds, frame after frame
    expect(step(m, { wipePos: 0.5 }, 5).wipePos).toBeCloseTo(swept, 6)
  })

  // ...but the lever is still a lever. Touching it while stopped drops the
  // parked offset, so a drag reads as an absolute position instead of one
  // measured from wherever the sweep left off.
  it('hands the boundary back to the lever when the lever moves', () => {
    const m = new MixState()
    step(m, { wipePos: 0.5, wipeRateHz: 1 }, 20)
    step(m, { wipePos: 0.5 }, 2)
    expect(m.update({ ...STILL, wipePos: 0.8 }).wipePos).toBeCloseTo(0.8, 6)
  })

  // While the sweep is running the lever still offsets it, which is how a
  // switcher's auto-transition behaves with a hand on the bar.
  it('keeps offsetting the sweep when the lever moves under it', () => {
    const m = new MixState()
    const a = step(m, { wipePos: 0.5, wipeRateHz: 1 }, 10).wipePos
    const b = m.update({ ...STILL, wipePos: 0.7, wipeRateHz: 1 }).wipePos
    expect(b).not.toBeCloseTo(a, 3)
  })
})
