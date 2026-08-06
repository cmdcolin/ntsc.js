import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { aFeedOn, bFeedOn, bOn, bWaveOn, FEEDS, feedFaults } from './feedgates'

import type { Controls } from '../controls'

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
  { aDropoutRate: 10 },
  { aPause: 0.8 },
  { bScramble: 1 },
  { bTermination: -1 },
  { bNoiseIre: 5 },
  { bPolarity: 1 },
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
})
