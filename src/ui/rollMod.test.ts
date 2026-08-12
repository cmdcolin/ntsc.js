import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { rngFor } from '../rng'
import { MUTATE_SLIDERS, SLIDER_BY_KEY, VIEW_KEYS, sliderFor } from './controls'
import { EMPTY_SLOT, N_SLOTS, RATE_MAX, RATE_MIN } from './modSlots'
import { AUTHORED_DEPTH, depthBudget, rollBay } from './rollMod'

import type { ControlKey, Controls } from '../controls'
import type { UiSlot } from './modSlots'
import type { MutateAmount } from './mutate'
import type { RollBayArgs } from './rollMod'

const args = (patch: Partial<RollBayArgs> = {}): RollBayArgs => ({
  amount: 'normal',
  sliders: MUTATE_SLIDERS,
  controls: DEFAULT_CONTROLS,
  audioLive: false,
  ...patch,
})

// The routings a roll produced, with the empty target narrowed away — every
// claim below is about a slot that got patched, and `target` is a ControlKey
// once it has.
const patched = (
  slots: readonly UiSlot[],
): (UiSlot & { target: ControlKey })[] =>
  slots.flatMap(s => (s.target === '' ? [] : [{ ...s, target: s.target }]))

// Every roll of a given amount, over enough seeds that a one-in-a-hundred draw
// shows up. Cheaper than a property-test runner and it reads as what it is: the
// rules below are claims about every roll, not about one.
const rolls = (n: number, patch: Partial<RollBayArgs> = {}): UiSlot[][] =>
  Array.from({ length: n }, (_, i) => rollBay(args(patch), rngFor(i + 1)))

describe('rollBay', () => {
  it('hands back a full positional bay, padded with empties', () => {
    const bay = rollBay(args({ amount: 'gentle' }), rngFor(1))
    expect(bay).toHaveLength(N_SLOTS)
    expect(patched(bay)).toHaveLength(1)
    expect(bay.slice(1)).toEqual(Array(N_SLOTS - 1).fill(EMPTY_SLOT))
  })

  it('cables more the harder the roll', () => {
    const counts = (['gentle', 'normal', 'wild', 'turbo'] as const).map(
      amount => patched(rollBay(args({ amount }), rngFor(7))).length,
    )
    expect(counts).toEqual([1, 2, 3, 5])
  })

  // The rule VIEW_KEYS exists for, asserted here as well as at the jitter: a
  // rolled routing on `timeScale` presents as the dead rendering step of ADR
  // 0004, and on the magnifier it reads as the app yanking the frame.
  it('never drives a view control', () => {
    for (const bay of rolls(200, { amount: 'turbo' })) {
      for (const s of patched(bay)) {
        expect(VIEW_KEYS.has(s.target)).toBe(false)
      }
    }
  })

  it('never rolls a source that would sit there doing nothing', () => {
    for (const bay of rolls(200, { amount: 'turbo' })) {
      for (const s of patched(bay)) {
        // `trig` waits to be played; the followers wait for sound that is not
        // on the wire in this roll.
        expect(['trig', 'level', 'hit']).not.toContain(s.source)
      }
    }
  })

  it('draws the audio followers once something is feeding them', () => {
    const sources = new Set(
      rolls(120, { amount: 'wild', audioLive: true }).flatMap(bay =>
        patched(bay).map(s => s.source),
      ),
    )
    expect(sources.has('level') || sources.has('hit')).toBe(true)
    expect(sources.has('trig')).toBe(false)
  })

  it('keeps every rolled slot inside the bay’s own ranges', () => {
    for (const bay of rolls(200, { amount: 'turbo' })) {
      for (const s of patched(bay)) {
        expect(s.rateHz).toBeGreaterThanOrEqual(RATE_MIN)
        expect(s.rateHz).toBeLessThanOrEqual(RATE_MAX)
        expect(s.depth).toBeGreaterThan(0)
        expect(s.depth).toBeLessThanOrEqual(1)
        expect(s.on).toBe(true)
        // A rolled lock would be a statement about the beat that nobody made.
        expect(s.syncDiv).toBeUndefined()
      }
    }
  })

  it('never spends two slots on one control', () => {
    for (const bay of rolls(150, { amount: 'turbo' })) {
      const targets = patched(bay).map(s => s.target)
      expect(new Set(targets).size).toBe(targets.length)
    }
  })

  // Drift, not buzz: a gentle roll is the pace of a circuit warming up. The
  // ceiling is per amount, so this is the claim that the ladder means something
  // for rates as well as for depths.
  it('keeps a gentle roll slow', () => {
    for (const bay of rolls(100, { amount: 'gentle' })) {
      for (const s of patched(bay)) expect(s.rateHz).toBeLessThanOrEqual(0.25)
    }
  })

  // The mean rather than the deepest, because the top of the ladder is meant to
  // hit the ceiling: turbo runs five times the budget, so its deepest draws
  // clamp at a full span — the same rail turbo lands controls against
  // everywhere else. What still has to hold across the whole ladder is that a
  // harder roll moves more.
  it('goes deeper the harder the roll', () => {
    const mean = (amount: MutateAmount) => {
      const depths = rolls(60, { amount }).flatMap(bay =>
        patched(bay).map(s => s.depth),
      )
      return depths.reduce((a, b) => a + b, 0) / depths.length
    }
    expect(mean('gentle')).toBeLessThan(mean('normal'))
    expect(mean('normal')).toBeLessThan(mean('wild'))
    expect(mean('wild')).toBeLessThan(mean('turbo'))
  })

  // A mode select modulated slides between modes on thresholds rather than
  // breathing, so it is a wreck rather than a fault — which is what turbo is
  // and what nothing below it should be.
  it('leaves mode selects alone below turbo', () => {
    for (const bay of rolls(200, { amount: 'wild' })) {
      for (const s of patched(bay)) {
        expect(SLIDER_BY_KEY.get(s.target)?.choices).toBeUndefined()
      }
    }
  })

  // The weighting that makes the button answer the look on the board rather
  // than the app: a control the current look has moved is in a circuit that is
  // doing something, and a wobble there is one you can see.
  it('favours controls the look is already using', () => {
    const moved: Controls = { ...DEFAULT_CONTROLS, fbMix: 0.7, fbGain: 0.9 }
    const hits = rolls(200, { amount: 'normal', controls: moved }).flatMap(
      bay =>
        patched(bay).filter(s => s.target === 'fbMix' || s.target === 'fbGain'),
    ).length
    const flat = rolls(200, { amount: 'normal' }).flatMap(bay =>
      patched(bay).filter(s => s.target === 'fbMix' || s.target === 'fbGain'),
    ).length
    expect(hits).toBeGreaterThan(flat)
  })

  it('is the same roll for the same seed', () => {
    expect(rollBay(args({ amount: 'wild' }), rngFor(42))).toEqual(
      rollBay(args({ amount: 'wild' }), rngFor(42)),
    )
  })
})

describe('depthBudget', () => {
  it('takes the hand-tuned depth where a preset has written one', () => {
    // bendUs carries three authored routings (0.3, 0.1, 0.04); the deepest is
    // the one still inside what somebody found usable.
    expect(AUTHORED_DEPTH.get('bendUs')).toBe(0.3)
    expect(depthBudget(sliderFor('bendUs'))).toBe(0.3)
  })

  it('measures a widened control against the range it was tuned to', () => {
    const wide = MUTATE_SLIDERS.find(
      s => s.redline !== undefined && !AUTHORED_DEPTH.has(s.key),
    )
    expect(wide).toBeDefined()
    if (wide === undefined) return
    const plain = { ...wide, redline: undefined }
    expect(depthBudget(wide)).toBeLessThan(depthBudget(plain))
  })

  it('holds back on a control whose mechanism is all in the first percent', () => {
    const curved = MUTATE_SLIDERS.find(
      s => s.curve === 'zero' && !AUTHORED_DEPTH.has(s.key),
    )
    expect(curved).toBeDefined()
    if (curved === undefined) return
    expect(depthBudget(curved)).toBeLessThan(
      depthBudget({ ...curved, curve: undefined }),
    )
  })

  it('gives every control a budget that can actually be seen', () => {
    for (const def of MUTATE_SLIDERS) {
      expect(depthBudget(def)).toBeGreaterThan(0)
      expect(depthBudget(def)).toBeLessThanOrEqual(1)
    }
  })
})
