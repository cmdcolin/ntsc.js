import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import { sliderFor } from './controls'
import {
  TRANSITION_NAMES,
  TRANSITIONS,
  faultPlan,
  transitionOf,
} from './transitions'

import type { ControlKey } from '../core/controls'

const keysOf = (peak: object) => Object.keys(peak) as ControlKey[]

describe('the shelf', () => {
  it('has an entry for every name, and no name without one', () => {
    expect(TRANSITIONS.map(t => t.name)).toEqual([...TRANSITION_NAMES])
  })

  // The recipes are the reason this shelf is cheap — every value is one a hand
  // could dial — so the test is that a hand *could*. A peak outside a slider's
  // range is a control the panel can never show you the fault at, and the two
  // would drift silently: the range lives in the slider schema and the peak
  // lives here.
  it('peaks at values the sliders themselves allow', () => {
    for (const t of TRANSITIONS) {
      for (const key of keysOf(t.peak)) {
        // Total by construction — every control has exactly one slider, which
        // controls.test.ts holds — so this throws rather than asserting.
        const def = sliderFor(key)
        const v = t.peak[key] as number
        expect(v, `${t.name}.${key}`).toBeGreaterThanOrEqual(def.min)
        expect(v, `${t.name}.${key}`).toBeLessThanOrEqual(def.max)
      }
    }
  })

  // A "fault" that lands on the resting value is not one. This is the check
  // that would catch a recipe left pointing at a control whose default moved
  // under it — the peak would still be in range and would do nothing at all.
  it('every key it drives actually leaves stock', () => {
    for (const t of TRANSITIONS) {
      expect(keysOf(t.peak).length, t.name).toBeGreaterThan(0)
      for (const key of keysOf(t.peak)) {
        expect(t.peak[key], `${t.name}.${key}`).not.toBe(DEFAULT_CONTROLS[key])
      }
    }
  })

  // The mix path is the board's to say — see the note above TRANSITIONS. A
  // recipe that forced it would take the most interesting choice in the deck
  // away at the moment it is most interesting.
  it('leaves the mix path alone', () => {
    for (const t of TRANSITIONS) {
      expect(keysOf(t.peak), t.name).not.toContain('bGenlock')
    }
  })

  it('cuts inside its own span, and lasts long enough to read', () => {
    for (const t of TRANSITIONS) {
      expect(t.cut, t.name).toBeGreaterThan(0)
      expect(t.cut, t.name).toBeLessThan(1)
      expect(t.seconds, t.name).toBeGreaterThanOrEqual(0.5)
      expect(t.seconds, t.name).toBeLessThanOrEqual(4)
    }
  })

  it('reads a name back, and answers nothing for one it does not have', () => {
    expect(transitionOf('roll')?.label).toBe('roll')
    expect(transitionOf('wipe')).toBeUndefined()
  })

  // A strip row draws the glyph rather than the word, because six controls
  // share 190px and the words pushed the ✕ off the card. Two properties make
  // that safe, and both are what the entry has to promise: one character, so
  // the chip cannot resize as the ring steps under a stationary pointer, and a
  // distinct one, so the chip says *which* fault is armed rather than only
  // that one is.
  it('gives every entry one distinct character for the row card', () => {
    for (const t of TRANSITIONS) {
      expect(Array.from(t.glyph), t.name).toHaveLength(1)
    }
    expect(new Set(TRANSITIONS.map(t => t.glyph)).size).toBe(TRANSITIONS.length)
  })

  // The plain cut's own glyph is the arrow `transitionLabel` falls back on, and
  // an entry wearing it would make "armed" and "not armed" the same card.
  it('and none of them is the plain cut’s arrow', () => {
    expect(TRANSITIONS.map(t => t.glyph)).not.toContain('↷')
  })
})

describe('faultPlan', () => {
  it('counts the entry’s seconds in frames of the simulation', () => {
    const t = transitionOf('collapse')
    expect(t).toBeDefined()
    const plan = faultPlan(t!, () => {})
    expect(plan.frames).toBe(Math.round(t!.seconds * 60))
    expect(plan.cut).toBe(t!.cut)
    expect(plan.peak).toBe(t!.peak)
  })
})
