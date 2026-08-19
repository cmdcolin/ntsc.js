import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import { rngFor } from '../core/rng'
import { GROUPS, snapToStep } from './controls'
import { crossover, mutate, spike } from './mutate'
import { toTravel } from './travel'

const SLIDERS = GROUPS.flatMap(g => g.sliders)

// Most of what is checked below is rolled off stock, where the wake gate would
// otherwise skip every control and leave the assertions passing over a board
// nothing had happened to. `wake: 1` is the stage die's own setting — every
// slider eligible — so these read the jitter itself, and the gate has tests of
// its own further down.
const ALL_AWAKE = 1

describe('mutate', () => {
  it('keeps every control within its slider range, even at extreme jitter', () => {
    for (const rand of [() => 0, () => 1, () => 0.5]) {
      const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.5, rand, ALL_AWAKE)
      for (const s of SLIDERS) {
        expect(out[s.key], s.key).toBeGreaterThanOrEqual(s.min)
        expect(out[s.key], s.key).toBeLessThanOrEqual(s.max)
      }
    }
  })

  it('snaps step-1 controls to whole values so no shader hits a fractional mode', () => {
    const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.3, () => 0.8, ALL_AWAKE)
    for (const s of SLIDERS.filter(def => def.step === 1)) {
      expect(Number.isInteger(out[s.key]), s.key).toBe(true)
    }
  })

  it('is a pure function of its rand, leaving the input untouched', () => {
    const input = { ...DEFAULT_CONTROLS }
    const a = mutate(input, SLIDERS, 0.2, () => 0.3, ALL_AWAKE)
    const b = mutate(input, SLIDERS, 0.2, () => 0.3, ALL_AWAKE)
    expect(a).toEqual(b)
    expect(input).toEqual(DEFAULT_CONTROLS)
  })

  // The button's own bug: any rate a roll could reach cuts the beam for ~95% of
  // every cycle, so half of all presses replaced the look with a flashing black
  // screen. Off zero it is a control like any other.
  it('never starts a strobe on a look that has none', () => {
    for (const rand of [() => 0, () => 1, () => 0.5, () => 0.9]) {
      expect(
        mutate(DEFAULT_CONTROLS, SLIDERS, 0.6, rand, ALL_AWAKE).strobeHz,
      ).toBe(0)
    }
  })

  it('still jitters a strobe that is already running', () => {
    const on = { ...DEFAULT_CONTROLS, strobeHz: 3.5 }
    expect(mutate(on, SLIDERS, 0.12, () => 1).strobeHz).toBeGreaterThan(3.5)
  })

  // Skipping a control must not skip its draw, or a control's roll would depend
  // on what every control before it was resting at.
  it('rolls the rest of the look the same whether the strobe is skipped or not', () => {
    const off = mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, rngFor(7), ALL_AWAKE)
    const on = mutate(
      { ...DEFAULT_CONTROLS, strobeHz: 3.5 },
      SLIDERS,
      0.12,
      rngFor(7),
      ALL_AWAKE,
    )
    for (const s of SLIDERS.filter(d => d.key !== 'strobeHz')) {
      expect(on[s.key], s.key).toBe(off[s.key])
    }
  })

  it('jitters around the current look, never more than the amount of travel', () => {
    const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, () => 0.9, ALL_AWAKE)
    for (const s of SLIDERS) {
      const moved = Math.abs(
        toTravel(s, out[s.key]) - toTravel(s, DEFAULT_CONTROLS[s.key]),
      )
      // The snap back onto the step grid is worth up to a step, which on a
      // curved control is worth more travel the flatter the track is there.
      const grid = Math.abs(
        toTravel(s, snapToStep(s, DEFAULT_CONTROLS[s.key] + s.step)) -
          toTravel(s, DEFAULT_CONTROLS[s.key]),
      )
      expect(moved, s.key).toBeLessThanOrEqual(0.12 + grid)
    }
  })

  // The nudge used to jitter the raw value, which on the persistence track is
  // not the control anyone is holding: 0.9 is a tenth of a second of afterglow
  // and 0.9995 is half a minute, and a 0.12 jitter crossed that whole distance.
  // One press in twelve off a look with any hold at all came back a smear that
  // never cleared, over whatever else the roll had done.
  it('moves a phosphor hold by a ratio rather than across the whole dial', () => {
    const held = { ...DEFAULT_CONTROLS, phosphor: 0.9 }
    for (const rand of [() => 0, () => 0.5, () => 1]) {
      const out = mutate(held, SLIDERS, 0.12, rand).phosphor
      expect(out).toBeGreaterThan(0.7)
      expect(out).toBeLessThan(0.97)
    }
  })

  // It may still introduce one — a nudge that can only deepen what is already
  // there is a poorer nudge — but the bottom of the track is short holds, so
  // what it introduces is a smear of a couple of fields.
  it('cannot nudge a look with no hold into a long one', () => {
    for (const rand of [() => 0.9, () => 1]) {
      expect(
        mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, rand, ALL_AWAKE).phosphor,
      ).toBeLessThan(0.65)
    }
  })

  // What made the button read as a fresh randomize: it woke all 230 sliders,
  // when the look it was rolling off had ten or twenty of them doing anything.
  it('wakes only a fraction of the controls sitting at stock', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = mutate(DEFAULT_CONTROLS, SLIDERS, 0.12, rngFor(seed))
      const moved = SLIDERS.filter(s => out[s.key] !== DEFAULT_CONTROLS[s.key])
      expect(moved.length).toBeGreaterThan(0)
      expect(moved.length).toBeLessThan(SLIDERS.length / 4)
    }
  })

  // The other half of the rule, and the half that makes it a nudge rather than
  // a weaker roll: whatever this look is doing, the roll is a variation on it.
  it('always jitters a control that is already off stock', () => {
    const look = { ...DEFAULT_CONTROLS, phosphor: 0.9, noiseIre: 4 }
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = mutate(look, SLIDERS, 0.12, rngFor(seed))
      expect(out.phosphor).not.toBe(look.phosphor)
      expect(out.noiseIre).not.toBe(look.noiseIre)
    }
  })
})

// The travel one step is worth around a value, for the assertions below: the
// landing is snapped onto the control's own grid, and on a coarse or curved
// control that snap is worth real travel — a four-mode toggle has a third of a
// track between its rungs, so a throw that has to cross 0.45 of travel can only
// land on 0.33 of it.
const gridAt = (s: (typeof SLIDERS)[number], v: number) =>
  Math.abs(toTravel(s, snapToStep(s, v + s.step)) - toTravel(s, v))

describe('spike', () => {
  it('throws at most the count it is given and leaves the rest exactly alone', () => {
    for (const seed of [1, 2, 3, 9, 40]) {
      const out = spike(DEFAULT_CONTROLS, SLIDERS, 2, rngFor(seed))
      const moved = SLIDERS.filter(s => out[s.key] !== DEFAULT_CONTROLS[s.key])
      expect(moved.length).toBeLessThanOrEqual(2)
      expect(moved.length).toBeGreaterThan(0)
    }
  })

  // The whole difference from `mutate`: what it touches, you can see it touched.
  it('lands what it throws a long way from where it sat', () => {
    for (const seed of [1, 2, 3, 9, 40, 77]) {
      const out = spike(DEFAULT_CONTROLS, SLIDERS, 4, rngFor(seed))
      for (const s of SLIDERS.filter(
        d => out[d.key] !== DEFAULT_CONTROLS[d.key],
      )) {
        const moved = Math.abs(
          toTravel(s, out[s.key]) - toTravel(s, DEFAULT_CONTROLS[s.key]),
        )
        expect(moved, s.key).toBeGreaterThanOrEqual(
          0.45 - gridAt(s, out[s.key]),
        )
      }
    }
  })

  // A trim thrown to the end of its track is a press that appears to have done
  // nothing, and at two controls a roll cannot afford one of them to be silent.
  it('throws look-makers, never the fine trims', () => {
    for (const seed of [1, 5, 12, 31, 64]) {
      const out = spike(DEFAULT_CONTROLS, SLIDERS, 7, rngFor(seed))
      for (const s of SLIDERS.filter(d => d.fine === true)) {
        expect(out[s.key], s.key).toBe(DEFAULT_CONTROLS[s.key])
      }
    }
  })

  it('keeps every control in range and every mode on a whole value', () => {
    for (const rand of [() => 0, () => 1, () => 0.5, rngFor(3)]) {
      const out = spike(DEFAULT_CONTROLS, SLIDERS, 12, rand)
      for (const s of SLIDERS) {
        expect(out[s.key], s.key).toBeGreaterThanOrEqual(s.min)
        expect(out[s.key], s.key).toBeLessThanOrEqual(s.max)
        if (s.step === 1) expect(Number.isInteger(out[s.key]), s.key).toBe(true)
      }
    }
  })

  // The same rule the nudge follows, and it bites harder here: a throw is what
  // this roll does, so a strobe it could reach would be thrown to a rate rather
  // than nudged toward one. See ROLL_NEVER_STARTS.
  it('never starts a strobe on a look that has none', () => {
    for (let seed = 1; seed < 60; seed++) {
      expect(spike(DEFAULT_CONTROLS, SLIDERS, 12, rngFor(seed)).strobeHz).toBe(
        0,
      )
    }
  })

  it('is a pure function of its rand, leaving the input untouched', () => {
    const input = { ...DEFAULT_CONTROLS }
    expect(spike(input, SLIDERS, 3, rngFor(11))).toEqual(
      spike(input, SLIDERS, 3, rngFor(11)),
    )
    expect(input).toEqual(DEFAULT_CONTROLS)
  })
})

describe('crossover', () => {
  const CIRCUITS = GROUPS.map(g => g.sliders)
  const rolled = mutate(DEFAULT_CONTROLS, SLIDERS, 0.4, rngFor(5))

  it('takes every control from one look or the other, never between them', () => {
    for (const seed of [1, 2, 3, 8, 21]) {
      const out = crossover(DEFAULT_CONTROLS, rolled, CIRCUITS, rngFor(seed))
      for (const s of SLIDERS) {
        expect(
          out[s.key] === DEFAULT_CONTROLS[s.key] ||
            out[s.key] === rolled[s.key],
          s.key,
        ).toBe(true)
      }
    }
  })

  // The point of crossing by circuit: a stage was tuned against itself, so it
  // arrives whole or not at all.
  it('answers for a whole circuit at a time', () => {
    for (const seed of [1, 2, 3, 8, 21]) {
      const out = crossover(DEFAULT_CONTROLS, rolled, CIRCUITS, rngFor(seed))
      for (const c of CIRCUITS) {
        const differing = c.filter(
          s => rolled[s.key] !== DEFAULT_CONTROLS[s.key],
        )
        const took = differing.filter(s => out[s.key] === rolled[s.key])
        expect(took.length === 0 || took.length === differing.length).toBe(true)
      }
    }
  })

  // A roll that can come out as no change at all is a button people press twice
  // and stop trusting — so the last coin is forced.
  it('changes something even when every flip says keep', () => {
    const out = crossover(DEFAULT_CONTROLS, rolled, CIRCUITS, () => 0.9)
    expect(out).not.toEqual(DEFAULT_CONTROLS)
  })

  it('has nothing to cross with a roll that landed on the same look', () => {
    const out = crossover(
      DEFAULT_CONTROLS,
      { ...DEFAULT_CONTROLS },
      CIRCUITS,
      () => 0.9,
    )
    expect(out).toEqual(DEFAULT_CONTROLS)
  })
})
