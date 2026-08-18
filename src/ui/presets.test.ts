import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS, DEFAULT_CONTROLS } from '../controls'
import { SLIDER_BY_KEY, VIEW_KEYS } from './controls'
import { RATE_MAX, RATE_MIN, modSource } from './modSlots'
import {
  PRESETS,
  blendMod,
  blendPresets,
  controlsEqual,
  matchPreset,
  presetControls,
  randomPresetMix,
  rollControls,
} from './presets'

// `useMix.applyPreset` reads an empty patch as "this click is the reset" and
// wipes the bay and the stab gate on it. A second preset written with an empty
// patch would silently become a second reset button.
describe('the empty patch', () => {
  it('belongs to "clean" and to nothing else', () => {
    const empty = PRESETS.filter(p => Object.keys(p.patch).length === 0)
    expect(empty.map(p => p.name)).toEqual(['clean'])
  })
})

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
          ['neonTube', 0],
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
    expect(blendPresets(worn, new Map([['roundTube', 1]])).noiseIre).toBe(7)
    expect(blendPresets(worn, new Map([['mixerLoop', 1]])).noiseIre).toBe(8.5)
  })

  // Retention does not add: two phosphors in front of each other hold light as
  // long as the slower one. Summed, a lead at 0.9 with a quarter of a follower
  // on top ran off the end of the dial — the top of that track is half a minute
  // of smear over whatever else the roll had just stacked up.
  it('takes the longest hold rather than summing two phosphors', () => {
    const both = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['stuckTape', 1],
        ['roundTube', 0.25],
      ]),
    )
    expect(both.phosphor).toBe(0.9)
    // The rest of what those two bring still stacks, this trim included —
    // 0.15 stock plus a quarter of the follower's 0.05, on a 0.01 grid.
    expect(both.phosphorBleed).toBe(0.16)
  })

  it('lets a follower carry the hold when the lead brought none', () => {
    const mixed = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['broadcast', 1],
        ['greenTerminal', 0.5],
      ]),
    )
    expect(mixed.phosphor).toBeCloseTo(0.495, 4)
  })

  it('keeps a hold the board already had, rather than adding to it', () => {
    const held = presetControls({ phosphor: 0.99 })
    expect(blendPresets(held, new Map([['stuckTape', 1]])).phosphor).toBe(0.99)
  })

  it('never starts a strobe on a board that has none', () => {
    // Every rate a roll can reach cuts the beam for ~95% of each cycle, so a
    // roll that starts one hides everything else it just did behind a
    // full-field flash a few times a second — and random nudge already refuses
    // to. This was the hole: the preset roll could pick the strobed tube as a
    // lead at 3.5 Hz or scale it down to 0.9 as a follower, on 3% of presses.
    for (const w of [1, 0.5, 0.25]) {
      const rolled = rollControls(
        new Map([['strobedTube', w]]),
        DEFAULT_CONTROLS,
      )
      expect(rolled.strobeHz).toBe(0)
      // The rest of that tube is a look, and it still arrives.
      expect(rolled.phosphor).toBeGreaterThan(0)
    }
  })

  it('leaves a strobe alone on a board that is already running one', () => {
    const strobing = presetControls({ strobeHz: 2 })
    expect(rollControls(new Map([['strobedTube', 1]]), strobing).strobeHz).toBe(
      3.5,
    )
  })

  it('picks one mode rather than averaging enum controls', () => {
    const mixed = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['roundTube', 0.4],
        ['greenTerminal', 0.6],
      ]),
    )
    expect(mixed.phosphorMode).toBe(3)
    expect(
      blendPresets(
        DEFAULT_CONTROLS,
        new Map([
          ['roundTube', 0.6],
          ['greenTerminal', 0.4],
        ]),
      ).phosphorMode,
    ).toBe(2)
  })

  it('clamps a summed fault to the slider range', () => {
    const piled = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['deadChannel', 1],
        ['wornTape', 1],
        ['mistunedRf', 1],
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
        expect(FILTER_KEYS, p.name).not.toContain(m.target)
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

// A cycling generator rather than Math.random, so a failure names a roll
// somebody can reproduce.
const seq = (values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

const movedBy = (name: string) => {
  const full = blendPresets(DEFAULT_CONTROLS, new Map([[name, 1]]))
  return CONTROL_KEYS.filter(k => full[k] !== DEFAULT_CONTROLS[k])
}

describe('randomPresetMix', () => {
  it('leads with one preset whole and dials the rest partly in', () => {
    for (let s = 0; s < 200; s++) {
      const roll = [...randomPresetMix(true).values()]
      expect(roll[0]).toBe(1)
      for (const w of roll.slice(1)) {
        expect(w).toBeGreaterThanOrEqual(0.25)
        expect(w).toBeLessThan(0.5)
      }
    }
  })

  // The whole point of crossing families: two presets from the same group
  // deepen one fault instead of stacking two.
  it('never draws twice from one group', () => {
    for (let s = 0; s < 200; s++) {
      const groups = [...randomPresetMix(true).keys()].map(
        n => PRESETS.find(p => p.name === n)?.group,
      )
      expect(new Set(groups).size).toBe(groups.length)
    }
  })

  // What keeps a roll off the summing edge of blendPresets: a follower may meet
  // the lead on a control or two, but not argue with it up and down the board.
  it('will not stack a follower that treads on what is already claimed', () => {
    for (let s = 0; s < 300; s++) {
      const names = [...randomPresetMix(true).keys()]
      const claimed = new Set(movedBy(names[0]))
      for (const n of names.slice(1)) {
        const keys = movedBy(n)
        expect(keys.filter(k => claimed.has(k)).length).toBeLessThanOrEqual(2)
        for (const k of keys) claimed.add(k)
      }
    }
  })

  // 'Full board' presets are complete looks. One can lead; layering a second
  // whole board over a look is the mush this roll is supposed to avoid.
  it('keeps whole-board presets out of the follower slots', () => {
    for (let s = 0; s < 300; s++) {
      const groups = [...randomPresetMix(true).keys()]
        .slice(1)
        .map(n => PRESETS.find(p => p.name === n)?.group)
      expect(groups).not.toContain('Full board')
    }
  })

  it('drops the A/B presets when there is no second source', () => {
    for (let s = 0; s < 200; s++) {
      const groups = [...randomPresetMix(false).keys()].map(
        n => PRESETS.find(p => p.name === n)?.group,
      )
      expect(groups).not.toContain('A/B mixing')
    }
  })

  // Threading the generator is what lets a roll be written down and rolled
  // again — the seeded sampler in vote/candidates.ts wants this shape.
  it('is reproducible from its generator', () => {
    const draw = () => randomPresetMix(true, seq([0.11, 0.42, 0.73, 0.28, 0.9]))
    expect([...draw().entries()]).toEqual([...draw().entries()])
  })
})

describe('rollControls', () => {
  // The bug this exists to make impossible: a roll that draws a view preset
  // ('nose against the glass' winds the magnifier to 5) moving your eye. Both
  // roll paths go through here, so one test covers both.
  it('never lets a roll move a view control', () => {
    const framed = { ...DEFAULT_CONTROLS, crtZoom: 3.5, crtZoomX: 0.2 }
    for (let s = 0; s < 300; s++) {
      const out = rollControls(randomPresetMix(true), framed)
      for (const key of VIEW_KEYS) expect(out[key], key).toBe(framed[key])
    }
  })

  // Every preset by name, not just the ones a random roll happened to draw:
  // a view preset added later has to be caught by this on the first run.
  it('holds for every authored preset at full weight', () => {
    const framed = { ...DEFAULT_CONTROLS, crtZoom: 2 }
    for (const p of PRESETS) {
      const out = rollControls(new Map([[p.name, 1]]), framed)
      for (const key of VIEW_KEYS)
        expect(out[key], `${p.name} ${key}`).toBe(framed[key])
    }
  })

  // What the reset lands on, and the reason it goes through here rather than
  // writing DEFAULT_CONTROLS: no recipe at all is stock everywhere but the
  // view, which stays where the viewer aimed it.
  it('is stock under an empty recipe, view apart', () => {
    const framed = { ...DEFAULT_CONTROLS, crtZoom: 2, timeScale: 0.5 }
    expect(rollControls(new Map(), framed)).toEqual(framed)
    expect(rollControls(new Map(), DEFAULT_CONTROLS)).toEqual(DEFAULT_CONTROLS)
  })

  // Everything that is not the view still arrives, or the pin would be a way of
  // quietly dropping half a preset.
  it('leaves everything outside the view to the recipe', () => {
    const weights = new Map([['vhs', 1]])
    const out = rollControls(weights, DEFAULT_CONTROLS)
    expect(out).toEqual(blendPresets(DEFAULT_CONTROLS, weights))
  })
})
