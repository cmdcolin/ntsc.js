import { describe, expect, it } from 'vitest'

import { ALL_SLIDERS, sliderFor } from './controls'
import {
  AUTOMAP_TARGETS,
  MOTION,
  controlOf,
  hasCaught,
  parseTarget,
  presetOf,
  presetTarget,
  spanFor,
  targetLabel,
} from './midi'

// A 0..1 control, so a knob step is 1/127 and the pickup window is 1/64.
const def = sliderFor('fbMix')

describe('hasCaught', () => {
  it('accepts the first message when nothing is on screen to catch', () => {
    expect(hasCaught(def, undefined, undefined, 0.9)).toBe(true)
  })

  it('accepts a knob that opens close to the on-screen value', () => {
    expect(hasCaught(def, 0.5, undefined, 0.51)).toBe(true)
  })

  it('rejects a knob that opens away from it', () => {
    expect(hasCaught(def, 0.5, undefined, 0.7)).toBe(false)
  })

  it('rejects movement that stays on one side', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.7)).toBe(false)
    expect(hasCaught(def, 0.5, 0.2, 0.3)).toBe(false)
  })

  it('catches once the knob sweeps through, from either direction', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.3)).toBe(true)
    expect(hasCaught(def, 0.5, 0.2, 0.7)).toBe(true)
  })

  it('catches when the knob lands exactly on the value', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.5)).toBe(true)
  })
})

// A target is a string because it keys the stored map, so taking one apart is
// the one place a stale or hand-edited storage key can turn into a binding that
// drives the wrong thing — or into a crash at the call site that indexes it.
describe('bind targets', () => {
  it('tells the three kinds apart', () => {
    expect(controlOf('fbMix')).toBe('fbMix')
    expect(controlOf(MOTION)).toBe(null)
    expect(controlOf(presetTarget('vhs'))).toBe(null)

    expect(presetOf(presetTarget('vhs'))).toBe('vhs')
    expect(presetOf('fbMix')).toBe(null)
    expect(presetOf(MOTION)).toBe(null)
  })

  it('round-trips every kind through storage', () => {
    for (const t of ['fbMix', MOTION, presetTarget('rainbow storm')])
      expect(parseTarget(t)).toBe(t)
  })

  it('drops a key that no longer names anything', () => {
    // A control renamed between versions, a preset retitled or dropped, and
    // near-misses of the two prefixes.
    expect(parseTarget('fbMixx')).toBe(null)
    expect(parseTarget('motionamount')).toBe(null)
    expect(parseTarget('presets')).toBe(null)
    expect(parseTarget('preset:')).toBe(null)
    expect(parseTarget(presetTarget('a look nobody shipped'))).toBe(null)
  })

  it('keeps a preset name whatever is in it', () => {
    // Names come from the table, not from a parser, so a space (or a colon, if
    // one ever landed in a name) survives rather than being read as structure.
    expect(presetOf(presetTarget('a: b'))).toBe('a: b')
    expect(parseTarget(presetTarget('rainbow storm'))).toBe(
      presetTarget('rainbow storm'),
    )
  })

  it('gives a control its own span and everything else a unit fader', () => {
    expect(spanFor('fbMix')).toEqual(sliderFor('fbMix'))
    expect(spanFor(MOTION)).toEqual({ min: 0, max: 1, step: 0.01 })
    expect(spanFor(presetTarget('vhs'))).toEqual({ min: 0, max: 1, step: 0.01 })
  })

  it('names each kind for the panel', () => {
    expect(targetLabel('fbMix')).toBe(sliderFor('fbMix').label)
    expect(targetLabel(MOTION)).toBe('motion amount')
    expect(targetLabel(presetTarget('vhs'))).toBe('vhs · preset')
  })
})

describe('the auto-map spine', () => {
  it('leads with the motion amount', () => {
    expect(AUTOMAP_TARGETS[0]).toBe(MOTION)
  })

  it('reaches every control exactly once', () => {
    const controls = AUTOMAP_TARGETS.flatMap(t => {
      const key = controlOf(t)
      return key === null ? [] : [key]
    })
    expect(new Set(controls).size).toBe(controls.length)
    expect(new Set(controls)).toEqual(new Set(ALL_SLIDERS.map(s => s.key)))
  })
})
