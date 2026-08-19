import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { aFeedOn, bFeedOn, bOn, bWaveOn, FEEDS, feedFaults } from './feedgates'

import type { Controls } from '../controls'

// The feed table's own field names — what a per-source fault is declared as,
// independent of which input's control key it resolves to.
type FeedFault = keyof (typeof FEEDS)['a']

const at = (patch: Partial<Controls>): Controls => ({
  ...DEFAULT_CONTROLS,
  ...patch,
})

// Every way a control can turn a gate on, so a combination nobody thought to
// try by hand is still covered. Each entry is one control off its default.
const KNOBS: Partial<Controls>[] = [
  {},
  { aScramble: 1 },
  { aTermination: -1 },
  { aTermination: 1 },
  { aNoiseIre: 5 },
  { aPolarity: 1 },
  { aHumIre: 12 },
  { aHumIre: -12 },
  { aConnector: 0.5 },
  { aDropoutRate: 10 },
  { aPause: 0.8 },
  { bScramble: 1 },
  { bTermination: -1 },
  { bNoiseIre: 5 },
  { bPolarity: 1 },
  { bHumIre: 12 },
  { bHumIre: -12 },
  { bConnector: 0.5 },
  { bDropoutRate: 10 },
  { bPause: 0.8 },
  { bGain: 0.5 },
  { bGain: -0.5 },
  { bRing: 0.5 },
  { aGain: 0.5 },
  { pipMix: 0.7 },
  { bGenlock: 1 },
  { bGenlock: 1, bGain: 0.5 },
  { bGenlock: 1, bGain: -0.5 },
  { bGenlock: 1, bPause: 0.8 },
  { bGenlock: 1, bRing: 0.5 },
  { bGenlock: 1, bNoiseIre: 5 },
  { bGain: 0.5, bPause: 0.8, bScramble: 1 },
]

describe('feed gates', () => {
  // The invariant the pass graph rests on. bFeedOn dispatching without bWaveOn
  // would damage a buffer nothing reads; bWaveOn without bOn would leave mix_b
  // resampling a bComp that no encode wrote this frame, which is a stale frame
  // on screen rather than an error anything reports.
  it('nests the three B gates', () => {
    for (const patch of KNOBS)
      for (const bEnabled of [false, true]) {
        const c = at(patch)
        const where = `${JSON.stringify(patch)} bEnabled=${bEnabled}`
        if (bFeedOn(c, bEnabled))
          expect(bWaveOn(c, bEnabled), `bFeedOn ⊄ bWaveOn: ${where}`).toBe(true)
        if (bWaveOn(c, bEnabled))
          expect(bOn(c, bEnabled), `bWaveOn ⊄ bOn: ${where}`).toBe(true)
      }
  })

  // Source B switched off is the whole B chain switched off — but not A's feed,
  // which is the cable into the program bus and owes B nothing. That asymmetry
  // is why Feed A sits on the Source spine and Feed B in the A/B section.
  it('keeps A’s feed independent of source B', () => {
    for (const patch of KNOBS) {
      const c = at(patch)
      expect(bOn(c, false)).toBe(false)
      expect(bWaveOn(c, false)).toBe(false)
      expect(bFeedOn(c, false)).toBe(false)
      expect(aFeedOn(c)).toBe(aFeedOn(c))
    }
    expect(aFeedOn(at({ aPause: 0.8 }))).toBe(true)
    expect(aFeedOn(at({ aNoiseIre: 5 }))).toBe(true)
  })

  it('leaves a clean board dispatching nothing', () => {
    const c = at({})
    expect(aFeedOn(c)).toBe(false)
    expect(bOn(c, true)).toBe(false)
    for (const src of ['a', 'b'] as const)
      expect(feedFaults(c, src)).toBe(false)
  })

  // Genlock implies a time-base corrector, so it strips the paused deck's
  // timing damage — the button becomes a plain freeze frame and feedB has
  // nothing to do. Amplitude damage still rides through the clean dissolve.
  it('strips a held deck’s damage on the genlocked path only', () => {
    const held = { bGain: 0.5, bPause: 0.8 }
    expect(bFeedOn(at(held), true)).toBe(true)
    expect(bFeedOn(at({ ...held, bGenlock: 1 }), true)).toBe(false)
    expect(bFeedOn(at({ ...held, bGenlock: 1, bNoiseIre: 5 }), true)).toBe(true)
  })

  // The fader is clamped to [0,1] by the genlocked branch, so a negative bGain
  // is a closed fader — dispatching a full re-encode of B for it produced a
  // frame identical to the one A had already written.
  it('treats a negative fader as closed when genlocked', () => {
    expect(bWaveOn(at({ bGain: -0.5 }), true)).toBe(true)
    expect(bWaveOn(at({ bGain: -0.5, bGenlock: 1 }), true)).toBe(false)
    expect(bOn(at({ bGain: -0.5, bGenlock: 1 }), true)).toBe(false)
  })

  // The feeds decorrelate their noise from the program bus and from each other
  // by gen seed; two feeds sharing one would make A's snow and B's identical.
  it('gives each feed its own generation seed', () => {
    expect(FEEDS.a.gen).not.toBe(FEEDS.b.gen)
  })

  // The failure this exists for: a fault added to the FEEDS table and to
  // feed.wgsl but not to feedFaults dispatches no pass, so its slider does
  // nothing until some *other* fault on the same input happens to be up — which
  // reads as an intermittent bug rather than a missing line. Every field in the
  // table has to be classified here, so adding one forces the choice rather
  // than defaulting to silence.
  //
  // OFF_GATE is everything that cannot open it on its own: `gen` is a seed,
  // scrambleMode / connectorMode / dropoutLen shape a fault some other field
  // turns on, and `pause` is deliberately outside feedFaults (see its comment).
  const OFF_GATE = [
    'gen',
    'scrambleMode',
    'connectorMode',
    'dropoutLen',
    'pause',
  ]
  // One value off default per trigger, in each direction the control travels:
  // the two signed ones only open the gate on !== 0, so a > 0 test would let a
  // daisy-chained terminator or the opposite mains leg through silently.
  const OPENS: [Exclude<FeedFault, 'gen'>, number[]][] = [
    ['scramble', [1]],
    ['termination', [-1, 1]],
    ['noise', [5]],
    ['polarity', [1]],
    ['hum', [12, -12]],
    ['connector', [0.5]],
    ['dropoutRate', [10]],
  ]

  it('classifies every field of the feed table', () => {
    for (const src of ['a', 'b'] as const)
      expect(Object.keys(FEEDS[src]).toSorted()).toEqual(
        [...OFF_GATE, ...OPENS.map(([field]) => field)].toSorted(),
      )
  })

  it('opens the gate for every fault the table names', () => {
    for (const src of ['a', 'b'] as const)
      for (const [field, values] of OPENS)
        for (const v of values) {
          const c: Controls = { ...DEFAULT_CONTROLS, [FEEDS[src][field]]: v }
          expect(feedFaults(c, src), `${src}.${field} = ${v}`).toBe(true)
          // and it is this input's fault alone — the other feed stays clean,
          // which is the whole point of a per-source feed
          expect(feedFaults(c, src === 'a' ? 'b' : 'a')).toBe(false)
        }
  })
})
