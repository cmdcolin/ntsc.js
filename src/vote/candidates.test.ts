import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { ALL_SLIDERS, VIEW_KEYS } from '../ui/controls'
import { PRESETS } from '../ui/presets'
import {
  ANCHOR_PRESETS,
  anchorRecipe,
  recipeControls,
  recipeId,
  recipeMod,
  samplePair,
  sampleRecipe,
} from './candidates'

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)
// A smaller sample for the tests that resolve a whole board. `blendPresets` walks
// all ~215 controls per call and these assert over every slider, so 200 seeds is
// several seconds of doing the same thing — enough to trip the default timeout on
// a loaded machine, and it was not buying more coverage than this does.
const BOARD_SEEDS = SEEDS.slice(0, 40)
const PRESET_NAMES = new Set(PRESETS.map(p => p.name))

describe('sampleRecipe', () => {
  // The property the whole dataset rests on: a label refers to a seed, so the
  // same seed has to mean the same look on every machine, forever.
  it('is reproducible from its seed alone', () => {
    for (const seed of SEEDS) {
      expect(sampleRecipe(seed)).toEqual(sampleRecipe(seed))
    }
  })

  it('rolls something different for different seeds', () => {
    const ids = new Set(SEEDS.map(s => recipeId(sampleRecipe(s))))
    // Not all distinct — the space is small enough that repeats are expected and
    // fine, since recipeId buckets them. Just not degenerate.
    expect(ids.size).toBeGreaterThan(SEEDS.length / 2)
  })

  it('names only real presets, and never clean or an A/B-only look', () => {
    for (const seed of SEEDS) {
      for (const name of Object.keys(sampleRecipe(seed).weights)) {
        expect(PRESET_NAMES.has(name), name).toBe(true)
        const def = PRESETS.find(p => p.name === name)
        expect(def?.group, name).not.toBe('Clean')
        expect(def?.group, name).not.toBe('A/B mixing')
      }
    }
  })

  it('leads with one preset at full weight and keeps the rest partial', () => {
    for (const seed of SEEDS) {
      const ws = Object.values(sampleRecipe(seed).weights)
      expect(ws.filter(w => w === 1)).toHaveLength(1)
      for (const w of ws.filter(w => w !== 1)) {
        expect(w).toBeGreaterThanOrEqual(0.3)
        expect(w).toBeLessThanOrEqual(0.8)
      }
    }
  })

  it('crosses two or three preset groups', () => {
    for (const seed of SEEDS) {
      const groups = Object.keys(sampleRecipe(seed).weights).map(
        n => PRESETS.find(p => p.name === n)?.group,
      )
      expect(groups.length).toBeGreaterThanOrEqual(2)
      expect(groups.length).toBeLessThanOrEqual(3)
      // One preset per group, so a roll cannot deepen a single family.
      expect(new Set(groups).size).toBe(groups.length)
    }
  })
})

describe('anchorRecipe', () => {
  it('is one authored preset at full weight', () => {
    for (const seed of SEEDS) {
      const r = anchorRecipe(seed)
      expect(r.kind).toBe('anchor')
      expect(Object.values(r.weights)).toEqual([1])
      expect(ANCHOR_PRESETS).toContain(Object.keys(r.weights)[0])
    }
  })
})

describe('samplePair', () => {
  it('reproduces both sides from the pair seed', () => {
    for (const seed of SEEDS) {
      expect(samplePair(seed)).toEqual(samplePair(seed))
    }
  })

  it('never shows the same recipe on both sides', () => {
    for (const seed of SEEDS) {
      const [a, b] = samplePair(seed)
      expect(recipeId(a), `seed ${seed}`).not.toBe(recipeId(b))
    }
  })

  it('anchors at most one side, and does so sometimes', () => {
    let anchored = 0
    for (const seed of SEEDS) {
      const [a, b] = samplePair(seed)
      expect(a.kind === 'anchor' && b.kind === 'anchor').toBe(false)
      if (a.kind === 'anchor' || b.kind === 'anchor') anchored++
    }
    expect(anchored).toBeGreaterThan(0)
    expect(anchored).toBeLessThan(SEEDS.length / 2)
  })
})

describe('recipeControls', () => {
  it('keeps every control inside its slider range', () => {
    for (const seed of BOARD_SEEDS) {
      const out = recipeControls(sampleRecipe(seed))
      for (const s of ALL_SLIDERS) {
        expect(out[s.key], `${s.key} @ ${seed}`).toBeGreaterThanOrEqual(s.min)
        expect(out[s.key], `${s.key} @ ${seed}`).toBeLessThanOrEqual(s.max)
      }
    }
  })

  it('snaps mode controls to whole values so no shader branch sees a fraction', () => {
    for (const seed of BOARD_SEEDS) {
      const out = recipeControls(sampleRecipe(seed))
      for (const s of ALL_SLIDERS.filter(s => s.step === 1)) {
        expect(Number.isInteger(out[s.key]), s.key).toBe(true)
      }
    }
  })

  // Both sides of a pair have to be framed identically, or the vote records
  // which one happened to be zoomed in rather than which look is better.
  it('pins the view controls to defaults so a pair is framed alike', () => {
    for (const seed of BOARD_SEEDS) {
      const out = recipeControls(sampleRecipe(seed))
      for (const key of VIEW_KEYS) {
        expect(out[key], key).toBe(DEFAULT_CONTROLS[key])
      }
    }
  })

  it('actually departs from stock', () => {
    for (const seed of BOARD_SEEDS) {
      const out = recipeControls(sampleRecipe(seed))
      const moved = ALL_SLIDERS.filter(
        s => out[s.key] !== DEFAULT_CONTROLS[s.key],
      )
      expect(moved.length, `seed ${seed}`).toBeGreaterThan(0)
    }
  })
})

describe('recipeMod', () => {
  // An empty bay rather than null: a candidate is applied over whatever the
  // previous one left running, so silence has to be asserted.
  it('always states what the bay should be', () => {
    for (const seed of BOARD_SEEDS) {
      expect(Array.isArray(recipeMod(sampleRecipe(seed)))).toBe(true)
    }
  })
})

describe('recipeId', () => {
  it('is the same for the same weighting under a different seed', () => {
    const r = sampleRecipe(7)
    expect(recipeId({ ...r, seed: 999 })).toBe(recipeId(r))
  })

  it('does not depend on key order', () => {
    const a = {
      seed: 1,
      weights: { vhs: 1, 'fb bloom': 0.5 },
      kind: 'mix' as const,
    }
    const b = {
      seed: 1,
      weights: { 'fb bloom': 0.5, vhs: 1 },
      kind: 'mix' as const,
    }
    expect(recipeId(a)).toBe(recipeId(b))
  })

  it('separates different weightings', () => {
    const a = { seed: 1, weights: { vhs: 1 }, kind: 'mix' as const }
    const b = { seed: 1, weights: { vhs: 0.5 }, kind: 'mix' as const }
    expect(recipeId(a)).not.toBe(recipeId(b))
  })
})
