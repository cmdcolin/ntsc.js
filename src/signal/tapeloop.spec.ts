import { describe, expect, it } from 'vitest'

import {
  LINES,
  SAMPLES_PER_LINE,
  TAPE_FRAMES,
  TAPE_MM_PER_S,
} from './constants'
import { TapeState } from './tapeloop'

import type { TapeUniforms } from './tapeloop'

const N = SAMPLES_PER_LINE * LINES
const still = {
  tapeLoopMm: 33.35, // exactly one second of tape
  tapeWowPct: 0,
  tapeColourFrame: 1,
}
const delayOf = (u: { tapeDelayFrames: number; tapeDelaySamples: number }) =>
  u.tapeDelayFrames * N + u.tapeDelaySamples
// How far the splice has run from the record head. A head at distance d meets
// it when the two draw level, so `d - past` is the sample within this frame
// that head sees the joint at — the arithmetic tape_play.wgsl does per head.
const spliceRun = (u: { tapeSpliceFrames: number; tapeSpliceRem: number }) =>
  u.tapeSpliceFrames * N + u.tapeSpliceRem
const spliceAtHead = (u: TapeUniforms, d: number) => {
  // modulo the loop: the far head is at the whole loop length, so it draws
  // level with the joint exactly as the joint reaches the record head again
  const loop = delayOf(u)
  const m = (((d - spliceRun(u)) % loop) + loop) % loop
  return m < N ? m : -1
}

describe('TapeState', () => {
  it('turns a length of tape into a delay at the transport speed', () => {
    const u = new TapeState().update(still, 0)
    // one second of tape at 60 fps, give or take the colour-framing round
    expect(delayOf(u) / N).toBeCloseTo(60, 3)
  })

  it('walks the ring slot with the frame and wraps at the end of the bin', () => {
    const tape = new TapeState()
    expect(tape.update(still, 7).tapeSlot).toBe(7)
    expect(tape.update(still, TAPE_FRAMES).tapeSlot).toBe(0)
    expect(tape.update(still, TAPE_FRAMES + 5).tapeSlot).toBe(5)
  })

  it('never asks the play head for tape the record head has not written', () => {
    const tape = new TapeState()
    for (const tapeLoopMm of [0, 0.01, 0.6]) {
      const u = tape.update({ ...still, tapeLoopMm }, 0)
      expect(delayOf(u)).toBeGreaterThanOrEqual(N)
      expect(u.tapeDelayFrames).toBeGreaterThanOrEqual(1)
    }
  })

  it('never asks for tape past the far end of the bin', () => {
    const u = new TapeState().update({ ...still, tapeLoopMm: 1e6 }, 0)
    expect(delayOf(u)).toBeLessThanOrEqual(TAPE_FRAMES * N)
  })

  it('holds the delay on a whole subcarrier cycle when colour framed', () => {
    // Every quarter-cycle of delay is 90 degrees of hue, so a colour-framed
    // delay has to be a multiple of four samples at any loop length.
    for (let mm = 1; mm < 60; mm += 0.37) {
      const u = new TapeState().update({ ...still, tapeLoopMm: mm }, 0)
      expect(delayOf(u) % 4).toBe(0)
    }
  })

  it('lets the delay off the lattice when colour framing is off', () => {
    const off = { ...still, tapeColourFrame: 0 }
    const offLattice = []
    for (let mm = 1; mm < 60; mm += 0.37) {
      offLattice.push(new TapeState().update({ ...off, tapeLoopMm: mm }, 0))
    }
    expect(offLattice.some(u => delayOf(u) % 4 !== 0)).toBe(true)
  })

  it('splits the delay so neither half overruns what it is packed into', () => {
    // tapeDelaySamples reaches the GPU as an f32, which counts integers singly
    // only below 2^24; the whole-frame part carries the rest as a u32.
    for (let mm = 1; mm < 66; mm += 0.29) {
      const u = new TapeState().update({ ...still, tapeLoopMm: mm }, 0)
      expect(u.tapeDelaySamples).toBeGreaterThanOrEqual(0)
      expect(u.tapeDelaySamples).toBeLessThan(N)
      expect(Number.isInteger(u.tapeDelayFrames)).toBe(true)
      expect(u.tapeDelayFrames).toBeLessThanOrEqual(TAPE_FRAMES)
    }
  })

  it('passes the splice over the far head once a lap', () => {
    // A two-second loop at 60 fps: the joint should come round every 120 frames.
    const tape = new TapeState()
    const loop = { ...still, tapeLoopMm: 2 * TAPE_MM_PER_S }
    const hits = []
    for (let f = 0; f < 500; f++) {
      const u = tape.update(loop, f)
      if (spliceAtHead(u, delayOf(u)) >= 0) hits.push(f)
    }
    expect(hits.length).toBe(5)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i] - hits[i - 1]).toBe(120)
    }
  })

  it('meets each head in turn, so the bump ticks out the tap pattern', () => {
    // Three heads at even subdivisions of a two-second loop: the joint should
    // reach each of them once a lap, spaced a third of the loop apart.
    const tape = new TapeState()
    const loop = { ...still, tapeLoopMm: 2 * TAPE_MM_PER_S }
    const hits: number[] = []
    for (let f = 0; f < 400; f++) {
      const u = tape.update(loop, f)
      const loopLen = delayOf(u)
      for (const k of [1, 2, 3]) {
        if (spliceAtHead(u, (loopLen * k) / 3) >= 0) hits.push(f)
      }
    }
    const gaps = hits.slice(1).map((f, i) => f - hits[i])
    // three arrivals a lap, evenly spaced: 40 frames apart at 120 per lap
    expect(hits.length).toBeGreaterThanOrEqual(9)
    for (const g of gaps) expect(g).toBe(40)
  })

  it('walks the splice down the raster when the loop is not a whole frame', () => {
    // A loop half a frame past a whole one hands the head the joint half a
    // picture lower each lap, instead of parking it on one line forever.
    const tape = new TapeState()
    const loop = {
      ...still,
      tapeColourFrame: 0,
      tapeLoopMm: (TAPE_MM_PER_S * 10.5) / 60,
    }
    const at = []
    for (let f = 0; f < 400; f++) {
      const u = tape.update(loop, f)
      const s = spliceAtHead(u, delayOf(u))
      if (s >= 0) at.push(s)
    }
    expect(at.length).toBeGreaterThan(20)
    expect(
      new Set(at.map(s => Math.round(s / SAMPLES_PER_LINE))).size,
    ).toBeGreaterThan(1)
  })

  it('breathes the delay when the capstan wanders', () => {
    const tape = new TapeState()
    const wobble = { ...still, tapeWowPct: 5, tapeColourFrame: 0 }
    const seen = []
    for (let f = 0; f < 300; f++) seen.push(delayOf(tape.update(wobble, f)))
    const spread = Math.max(...seen) - Math.min(...seen)
    // a fixed length of tape over a wandering speed is a wandering delay
    expect(spread).toBeGreaterThan(N / 10)
  })

  it('holds the delay steady with no wander', () => {
    const tape = new TapeState()
    const seen = []
    for (let f = 0; f < 300; f++) seen.push(delayOf(tape.update(still, f)))
    expect(Math.max(...seen) - Math.min(...seen)).toBe(0)
  })
})
