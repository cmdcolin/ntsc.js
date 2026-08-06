import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { SLIDER_BY_KEY } from './controls'
import { RATE_MAX, RATE_MIN, modSource } from './modSlots'
import {
  PRESETS,
  blendMod,
  blendPresets,
  controlsEqual,
  matchPreset,
  presetControls,
} from './presets'

describe('blendPresets', () => {
  it('at full weight over defaults, reproduces the preset exactly', () => {
    for (const p of PRESETS) {
      const blended = blendPresets(DEFAULT_CONTROLS, new Map([[p.name, 1]]))
      expect(blended, p.name).toEqual(presetControls(p.patch))
      expect(matchPreset(blended)?.name).toBe(p.name)
    }
  })

  it('at zero weight, leaves the baseline untouched', () => {
    const base = presetControls({ noiseIre: 7, cfbMix: 0.4 })
    expect(
      blendPresets(
        base,
        new Map([
          ['vhs', 0],
          ['neon tube', 0],
        ]),
      ),
    ).toEqual(base)
  })

  it('halves a fault at half weight', () => {
    const half = blendPresets(DEFAULT_CONTROLS, new Map([['broadcast', 0.5]]))
    expect(half.ghostGain).toBe(0.05)
    expect(half.noiseIre).toBe(0.6)
  })

  it('accumulates grain across stacked presets instead of clobbering it', () => {
    const worn = presetControls({ noiseIre: 7 })
    expect(blendPresets(worn, new Map([['round tube', 1]])).noiseIre).toBe(7)
    expect(blendPresets(worn, new Map([['mixer loop', 1]])).noiseIre).toBe(8.5)
  })

  it('picks one mode rather than averaging enum controls', () => {
    const mixed = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['round tube', 0.4],
        ['green terminal', 0.6],
      ]),
    )
    expect(mixed.phosphorMode).toBe(3)
    expect(
      blendPresets(
        DEFAULT_CONTROLS,
        new Map([
          ['round tube', 0.6],
          ['green terminal', 0.4],
        ]),
      ).phosphorMode,
    ).toBe(2)
  })

  it('clamps a summed fault to the slider range', () => {
    const piled = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['dead channel', 1],
        ['worn tape', 1],
        ['mistuned rf', 1],
      ]),
    )
    // Against the schema's own ceiling, not a copy of it — the point is that
    // the sum lands inside the slider, wherever the slider now ends.
    expect(piled.noiseIre).toBeLessThanOrEqual(
      SLIDER_BY_KEY.get('noiseIre')?.max ?? 0,
    )
  })
})

describe('blendMod', () => {
  // Two presets that carry motion, whichever they happen to be — this is about
  // the rule, not about which looks were authored to move.
  const moving = PRESETS.filter(p => p.mod !== undefined)

  it('every authored routing names a real control and a real source', () => {
    expect(moving.length).toBeGreaterThan(0)
    for (const p of moving) {
      for (const m of p.mod ?? []) {
        expect(SLIDER_BY_KEY.has(m.target), `${p.name}: ${m.target}`).toBe(true)
        expect(modSource(m.source), `${p.name}: ${m.source}`).not.toBe(null)
        expect(m.depth, `${p.name} depth`).toBeGreaterThan(0)
        expect(m.depth, `${p.name} depth`).toBeLessThanOrEqual(1)
        expect(m.rateHz, `${p.name} rate`).toBeGreaterThanOrEqual(RATE_MIN)
        expect(m.rateHz, `${p.name} rate`).toBeLessThanOrEqual(RATE_MAX)
      }
    }
  })

  it('no authored routing drives a filter control', () => {
    // Modulating one of these rebuilds the whole FIR bank every frame. Fine as
    // a deliberate patch, not fine hanging off a chip someone clicked.
    const FILTER_KEYS = [
      'encChromaMHz',
      'demodMHz',
      'chromaTail',
      'lumaMHz',
      'lumaPeak',
    ]
    for (const p of moving) {
      for (const m of p.mod ?? []) {
        expect(FILTER_KEYS, `${p.name}`).not.toContain(m.target)
      }
    }
  })

  it('at full weight, reproduces the preset’s own routings', () => {
    for (const p of moving) {
      expect(blendMod(new Map([[p.name, 1]])), p.name).toEqual(p.mod)
    }
  })

  it('scales depth by how much of the preset is in', () => {
    const [p] = moving
    const half = blendMod(new Map([[p.name, 0.5]])) ?? []
    expect(half.map(m => m.depth)).toEqual(
      (p.mod ?? []).map(m => m.depth * 0.5),
    )
  })

  it('lets the heaviest preset that carries motion win outright', () => {
    // Routings are patch cables, not summable scalars: half of one bay plus
    // half of another is a third bay nobody asked for.
    const [a, b] = moving
    const out = blendMod(
      new Map([
        [a.name, 0.4],
        [b.name, 0.9],
      ]),
    )
    expect(out?.map(m => m.target)).toEqual((b.mod ?? []).map(m => m.target))
    expect(out?.map(m => m.depth)).toEqual(
      (b.mod ?? []).map(m => m.depth * 0.9),
    )
  })

  it('says nothing when no preset in the recipe carries motion', () => {
    // Which the caller reads as "leave the bay alone" — a preset with no
    // opinion about motion must not silently unpatch hand-wired routings.
    expect(blendMod(new Map([['broadcast', 1]]))).toBe(null)
    expect(blendMod(new Map())).toBe(null)
  })

  it('ignores a preset that is dialed all the way out', () => {
    const [p] = moving
    expect(blendMod(new Map([[p.name, 0]]))).toBe(null)
  })
})

describe('controlsEqual', () => {
  it('is true only when every control matches', () => {
    const base = presetControls({ noiseIre: 7 })
    expect(controlsEqual(base, presetControls({ noiseIre: 7 }))).toBe(true)
    expect(controlsEqual(base, presetControls({ noiseIre: 7.1 }))).toBe(false)
  })

  // The fills stay honest: once anything moves the look off what the mix
  // produced, controlsEqual goes false and the UI drops the weights to zero.
  it('goes false when a look diverges from its mix', () => {
    const base = presetControls({ ghostGain: 0.2 })
    const weights = new Map([['vhs', 0.5]])
    expect(controlsEqual(base, blendPresets(base, weights))).toBe(false)
    expect(
      controlsEqual(blendPresets(base, weights), blendPresets(base, weights)),
    ).toBe(true)
  })
})
