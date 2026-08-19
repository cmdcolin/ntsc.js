import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import {
  barInert,
  barPosition,
  barThrow,
  deckLoad,
  takeAt,
  wipeEngaged,
} from './deck'

import type { Controls } from '../core/controls'

const at = (over: Partial<Controls>): Controls => ({
  ...DEFAULT_CONTROLS,
  ...over,
})

describe('the T-bar', () => {
  it('throws the crossfade when no pattern is armed', () => {
    expect(barThrow(at({ bGenlock: 1 }), 0.4).bGain).toBe(0.4)
  })

  it('leaves A alone on the genlocked path, where the shader ignores it', () => {
    // mix_b's clean branch is mix(a, b, gate * bGain) — aGain is not read, so
    // writing it would move a slider that cannot change the picture.
    expect(barThrow(at({ bGenlock: 1, aGain: 1 }), 0.4).aGain).toBe(1)
  })

  it('takes A down as it brings B up on the dirty sum', () => {
    const next = barThrow(at({ bGenlock: 0 }), 0.25)
    expect(next.bGain).toBe(0.25)
    expect(next.aGain).toBe(0.75)
  })

  it('becomes the wipe lever once a pattern is armed, on either path', () => {
    for (const bGenlock of [0, 1]) {
      const next = barThrow(at({ bGenlock, wipeMode: 3, bGain: 1 }), 0.6)
      expect(next.wipePos).toBe(0.6)
      expect(next.bGain).toBe(1)
      expect(next.aGain).toBe(DEFAULT_CONTROLS.aGain)
    }
  })

  it('reads its position back off whichever control it is throwing', () => {
    expect(barPosition(at({ bGain: 0.3 }))).toBe(0.3)
    expect(barPosition(at({ wipeMode: 1, wipePos: 0.7, bGain: 0.3 }))).toBe(0.7)
  })

  it('clamps a gain outside the fader into the bar it can draw', () => {
    // bGain runs to ±3 for the polarity trick; the bar is a 0..1 throw.
    expect(barPosition(at({ bGain: -2 }))).toBe(0)
    expect(barPosition(at({ bGain: 2.5 }))).toBe(1)
  })

  it('clamps a throw rather than writing past the ends of the travel', () => {
    expect(barThrow(at({ bGenlock: 1 }), 1.4).bGain).toBe(1)
    expect(barThrow(at({ bGenlock: 1 }), -0.2).bGain).toBe(0)
  })

  it('says so when it is wiping into a shut fader', () => {
    expect(barInert(at({ wipeMode: 1, bGain: 0 }))).toBe(true)
    expect(barInert(at({ wipeMode: 1, bGain: 0.5 }))).toBe(false)
    // no pattern: the bar *is* the fader, so a shut one is where it sits
    expect(barInert(at({ wipeMode: 0, bGain: 0 }))).toBe(false)
  })

  it('reads the pattern enum on the same band the shader does', () => {
    expect(wipeEngaged(0)).toBe(false)
    expect(wipeEngaged(1)).toBe(true)
  })
})

describe('the auto-take', () => {
  it('runs the bar at a constant rate to the far end', () => {
    expect(takeAt(0, 1, 0, 2)).toBe(0)
    expect(takeAt(0, 1, 1, 2)).toBe(0.5)
    expect(takeAt(0, 1, 2, 2)).toBe(1)
  })

  it('stops at the end rather than overshooting a late frame', () => {
    expect(takeAt(0, 1, 9, 2)).toBe(1)
    expect(takeAt(1, 0, 9, 2)).toBe(0)
  })

  it('is a cut at zero duration', () => {
    expect(takeAt(0, 1, 0, 0)).toBe(1)
  })
})

// What the box on the map wears while the deck is shut. Not a count of controls
// off stock — every control the deck draws is already counted on the stage that
// owns it, so the number would be the same edits marked twice on one drawing.
// What it counts is which of the deck's gestures are engaged, which is a fact
// about the take that has no other box to be shown on.
describe('what the deck is holding', () => {
  it('is holding nothing at rest, and says nothing', () => {
    expect(deckLoad(at({}))).toEqual({ n: 0, say: '' })
  })

  // A resting deck is not the same as a resting rig: shuttleX rests at 1 and
  // timeScale at 1, so "off stock" for these two is a value either side of one
  // rather than anything above zero.
  it('counts a gesture off its own rest, not off zero', () => {
    expect(deckLoad(at({ shuttleX: 1 })).n).toBe(0)
    expect(deckLoad(at({ shuttleX: 0 })).say).toBe('the tape off play')
    expect(deckLoad(at({ timeScale: 1 })).n).toBe(0)
    expect(deckLoad(at({ timeScale: 0 })).say).toBe('the picture held')
    // Slowed is a different statement from stopped, and the deck's hold button
    // only makes the second one.
    expect(deckLoad(at({ timeScale: 0.25 })).say).toBe('the picture slowed')
  })

  // A wipe is armed by a *pattern*, not by the lever: wipeMode 0 is a dissolve,
  // which is the transition doing what it does with nothing selected.
  it('is a wipe only once a pattern is picked', () => {
    expect(deckLoad(at({ wipeMode: 0, wipePos: 0.5 })).n).toBe(0)
    expect(deckLoad(at({ wipeMode: 2 })).say).toBe('a wipe armed')
  })

  it('reads as a sentence when more than one is live', () => {
    expect(deckLoad(at({ tapeMix: 0.5, trackAmt: 0.3 }))).toEqual({
      n: 2,
      say: 'the loop threaded and the head off track',
    })
    expect(deckLoad(at({ pipMix: 1, tapeMix: 0.5, timeScale: 0 })).say).toBe(
      'the inset up, the loop threaded and the picture held',
    )
  })
})
