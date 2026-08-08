import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import {
  barInert,
  barPosition,
  barThrow,
  shuttleToTravel,
  takeAt,
  travelToShuttle,
  wipeEngaged,
} from './deck'

import type { Controls } from '../controls'

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

describe('the shuttle ring', () => {
  it('lands the detents where the deck has them', () => {
    expect(travelToShuttle(0)).toBe(0)
    expect(travelToShuttle(1)).toBeCloseTo(32, 6)
    expect(travelToShuttle(-1)).toBeCloseTo(-32, 6)
  })

  it('round-trips a speed through the ring without creeping', () => {
    for (const v of [-32, -8, -1, 0, 0.5, 1, 4, 32]) {
      expect(travelToShuttle(shuttleToTravel(v))).toBeCloseTo(v, 9)
    }
  })

  it('spends real travel on the speeds you can still watch', () => {
    // The half-way point of a linear ring is 16x — long past the picture. Here
    // it is under 6x, so play-to-double gets a throw you can aim.
    expect(travelToShuttle(0.5)).toBeLessThan(6)
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
