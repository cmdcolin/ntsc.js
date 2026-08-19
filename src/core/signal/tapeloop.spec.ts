import { describe, expect, it } from 'vitest'

import { rngFor } from '../rng'
import {
  LINES,
  SAMPLES_PER_LINE,
  TAPE_FRAMES,
  TAPE_MM_PER_S,
} from './constants'
import {
  TAPE_FORWARD,
  TAPE_REVERSE,
  TAPE_SCRUB,
  TAPE_STOPPED,
  TapeState,
} from './tapeloop'

import type { TapeControls, TapeUniforms } from './tapeloop'

const N = SAMPLES_PER_LINE * LINES
const still = {
  tapeLoopMm: 33.35, // exactly one second of tape
  tapeWowPct: 0,
  tapeColourFrame: 1,
  tapeMix: 0.5,
  tapeRecord: 1,
  tapeTransport: 2, // forward
  tapeShuttle: 1, // play speed
}
// Mirrors the read in tape_play.wgsl: where round the loop window a head at
// distance `d` is lifting sample `n` from, as an offset off the window's base.
const wrapRing = (p: number) =>
  ((p % (TAPE_FRAMES * N)) + TAPE_FRAMES * N) % (TAPE_FRAMES * N)
const readOff = (u: TapeUniforms, d: number, n = 0) => {
  const loop = delayOf(u)
  const phase = u.tapeHoldFrames * N + u.tapeHoldRem
  return ((phase + n + loop - d) % loop) - loop
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

  it('parks the loop window on the tape it is laying down while recording', () => {
    // With the window on the current frame at zero phase, the shader's wrap
    // reduces to "trail the write pointer by the head's distance" — which is
    // what keeps a recording loop bit-identical to having no hold at all.
    const tape = new TapeState()
    for (const f of [0, 7, 130]) {
      const u = tape.update(still, f)
      expect(u.tapeHoldSlot).toBe(u.tapeSlot)
      expect(u.tapeHoldFrames * N + u.tapeHoldRem).toBe(0)
      for (const n of [0, 1000, N - 1]) {
        expect(readOff(u, delayOf(u), n)).toBe(n - delayOf(u))
      }
    }
  })

  it('walks a held loop round its own length, not off the back of it', () => {
    // Lifting the record head does not stop the tape. The heads have to keep
    // wrapping inside the stretch that was recorded, or after one lap they
    // start reading whatever the ring held before the loop was laid down.
    const tape = new TapeState()
    tape.update(still, 0)
    const held = { ...still, tapeRecord: 0 }
    const frozen = tape.update(held, 1).tapeHoldSlot
    const offs = []
    for (let f = 2; f < 200; f++) {
      const u = tape.update(held, f)
      expect(u.tapeHoldSlot).toBe(frozen) // the window does not move
      const off = readOff(u, delayOf(u))
      expect(off).toBeGreaterThanOrEqual(-delayOf(u))
      expect(off).toBeLessThan(0)
      offs.push(off)
    }
    // one second of tape at 60 fps: the same oxide comes round every 60 frames
    for (let i = 0; i + 60 < offs.length; i++) {
      expect(offs[i + 60]).toBe(offs[i])
    }
    expect(new Set(offs).size).toBe(60)
  })

  it('holds the tape it just recorded, not the tape one frame short of it', () => {
    // tapePlay runs before tapeRec, so while recording frame f the newest tape
    // on the loop is f-1. If the window does not step on once more as the head
    // lifts it closes just short of frame f, and the last thing recorded is the
    // one thing that never comes back. Pin it by comparison: for its first lap
    // a held loop has to read exactly what a still-recording one would, and
    // only then repeat instead of moving on.
    const L = 60 // frames, from the one-second fixture
    const live = new TapeState()
    const held = new TapeState()
    const read = (u: TapeUniforms, n: number) =>
      wrapRing(u.tapeHoldSlot * N + readOff(u, delayOf(u), n))
    for (let f = 0; f < 40; f++) {
      live.update(still, f)
      held.update(still, f)
    }
    const lifted = { ...still, tapeRecord: 0 }
    for (let f = 40; f < 40 + L; f++) {
      const a = live.update(still, f)
      const b = held.update(lifted, f)
      for (const n of [0, 12345, N - 1]) {
        expect(read(b, n), `frame ${f}, sample ${n}`).toBe(read(a, n))
      }
    }
    // past a lap it must repeat rather than follow the live one into new tape
    const a = live.update(still, 40 + L)
    const b = held.update(lifted, 40 + L)
    expect(read(b, 0)).not.toBe(read(a, 0))
  })

  it('runs a held loop backwards a whole frame at a time', () => {
    // Reverse walks the window's phase backwards while samples still run
    // forward inside each frame — frames come off in reverse order, each one
    // whole, which is reverse play on a helical machine rather than the tape
    // being dragged backwards past a fixed head.
    const tape = new TapeState()
    tape.update(still, 0)
    const back = { ...still, tapeRecord: 0, tapeTransport: 0 }
    tape.update(back, 1)
    const seen = []
    for (let f = 2; f < 40; f++) seen.push(readOff(tape.update(back, f), 0))
    const loop = delayOf(tape.update(back, 40))
    for (let i = 1; i < seen.length; i++) {
      // each step is one frame of tape earlier, modulo the loop
      expect(wrapRing(seen[i - 1] - seen[i])).toBe(N)
    }
    expect(seen.every(o => o >= -loop && o < 0)).toBe(true)
  })

  it('parks the tape when the transport is stopped', () => {
    // Tape still, drum still turning: the same sweep is re-read, which is a
    // frozen frame rather than a frozen sample.
    const tape = new TapeState()
    tape.update(still, 0)
    const stop = { ...still, tapeRecord: 0, tapeTransport: 1 }
    tape.update(stop, 1)
    const first = readOff(tape.update(stop, 2), 0)
    for (let f = 3; f < 30; f++) {
      expect(readOff(tape.update(stop, f), 0)).toBe(first)
    }
  })

  it('runs the splice backwards with the tape, and stops it with the tape', () => {
    const at = (c: TapeControls, frames: number) => {
      const tape = new TapeState()
      tape.update(still, 0)
      const seen = []
      for (let f = 1; f <= frames; f++) {
        const u = tape.update(c, f)
        seen.push(u.tapeSpliceFrames * N + u.tapeSpliceRem)
      }
      return seen
    }
    const fwd = at({ ...still, tapeRecord: 0, tapeTransport: 2 }, 5)
    const rev = at({ ...still, tapeRecord: 0, tapeTransport: 0 }, 5)
    const stopped = at({ ...still, tapeRecord: 0, tapeTransport: 1 }, 5)
    expect(wrapRing(fwd[1] - fwd[0])).toBe(N)
    expect(wrapRing(rev[0] - rev[1])).toBe(N)
    expect(new Set(stopped).size).toBe(1)
  })

  it('ignores the transport switch while the record head is down', () => {
    // You cannot record into a loop you are pulling backwards through the
    // heads: laying tape down is forward by definition.
    const fwd = new TapeState()
    const back = new TapeState()
    for (let f = 0; f < 10; f++) {
      const a = fwd.update(still, f)
      const b = back.update({ ...still, tapeTransport: 0 }, f)
      expect(b.tapeHoldSlot).toBe(a.tapeHoldSlot)
      expect(b.tapeHoldFrames * N + b.tapeHoldRem).toBe(
        a.tapeHoldFrames * N + a.tapeHoldRem,
      )
      expect(b.tapeSpliceFrames).toBe(a.tapeSpliceFrames)
    }
  })

  it('reads in tape order only when the drum is stalled', () => {
    const tape = new TapeState()
    const held = (t: number) => ({ ...still, tapeRecord: 0, tapeTransport: t })
    expect(tape.update(held(TAPE_SCRUB), 1).tapeScrub).toBe(1)
    expect(tape.update(held(TAPE_REVERSE), 2).tapeScrub).toBe(0)
    expect(tape.update(held(TAPE_STOPPED), 3).tapeScrub).toBe(0)
    expect(tape.update(held(TAPE_FORWARD), 4).tapeScrub).toBe(0)
    // laying tape down is forward past a turning drum, whatever the switch says
    expect(
      tape.update({ ...still, tapeTransport: TAPE_SCRUB }, 5).tapeScrub,
    ).toBe(0)
  })

  it('pulls the tape backwards to scrub, same as reverse does', () => {
    // The capstan is doing the same thing in both; what differs is the drum,
    // so the window has to walk back at the same rate either way.
    const rev = new TapeState()
    const scrub = new TapeState()
    rev.update(still, 0)
    scrub.update(still, 0)
    for (let f = 1; f < 20; f++) {
      const a = rev.update(
        { ...still, tapeRecord: 0, tapeTransport: TAPE_REVERSE },
        f,
      )
      const b = scrub.update(
        { ...still, tapeRecord: 0, tapeTransport: TAPE_SCRUB },
        f,
      )
      expect(b.tapeHoldFrames * N + b.tapeHoldRem).toBe(
        a.tapeHoldFrames * N + a.tapeHoldRem,
      )
      expect(b.tapeSpliceFrames).toBe(a.tapeSpliceFrames)
    }
  })

  it('crosses tracks whenever the loop is off play speed', () => {
    // |speed - 1| crossings a sweep, the deck's own count: none at play, one
    // standing still (the paused-VHS bar), two running backwards, four cueing
    // at five times. Nothing here is a special case for pause.
    const bars = (t: number, x: number) =>
      new TapeState().update(
        { ...still, tapeRecord: 0, tapeTransport: t, tapeShuttle: x },
        1,
      ).tapeShuttleBars
    expect(bars(TAPE_FORWARD, 1)).toBe(0)
    expect(bars(TAPE_STOPPED, 1)).toBe(-1)
    expect(bars(TAPE_REVERSE, 1)).toBe(-2)
    expect(bars(TAPE_FORWARD, 5)).toBe(4)
    expect(bars(TAPE_REVERSE, 3)).toBe(-4)
    // the wheel cannot un-stop a stopped transport
    expect(bars(TAPE_STOPPED, 8)).toBe(-1)
  })

  it('runs a held loop at the shuttle speed', () => {
    const stepAt = (t: number, x: number) => {
      const tape = new TapeState()
      tape.update(still, 0)
      const held = { ...still, tapeRecord: 0, tapeTransport: t, tapeShuttle: x }
      tape.update(held, 1)
      const a = tape.update(held, 2)
      const b = tape.update(held, 3)
      const phase = (u: TapeUniforms) => u.tapeHoldFrames * N + u.tapeHoldRem
      return wrapRing(phase(b) - phase(a))
    }
    expect(stepAt(TAPE_FORWARD, 1)).toBe(N)
    expect(stepAt(TAPE_FORWARD, 3)).toBe(3 * N)
    expect(stepAt(TAPE_FORWARD, 0.5)).toBe(N / 2)
    expect(stepAt(TAPE_STOPPED, 4)).toBe(0)
    expect(wrapRing(-stepAt(TAPE_REVERSE, 2))).toBe(2 * N)
  })

  it('leaves the shuttle inert while the record head is down', () => {
    const u = new TapeState().update({ ...still, tapeShuttle: 6 }, 1)
    expect(u.tapeShuttleBars).toBe(0)
    expect(u.tapeHoldFrames * N + u.tapeHoldRem).toBe(0)
  })

  it('treats a shut fader as the record head being up', () => {
    // The loop is out of circuit at mix 0, so nothing reaches the tape however
    // the record switch is set — a window that advanced through that would hand
    // the heads tape nobody recorded.
    const tape = new TapeState()
    tape.update(still, 0)
    const out = { ...still, tapeMix: 0 }
    // one last step-on as the head comes up, to take in the frame just laid
    // down, and then the window stays where it is
    const frozen = tape.update(out, 1).tapeHoldSlot
    for (let f = 2; f < 8; f++) {
      expect(tape.update(out, f).tapeHoldSlot).toBe(frozen)
    }
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

  // The half of docs/EDITOR.md › _Take state_ that lives on the CPU: the
  // capstan is the one thing on this deck that rolls, and a take hands it a
  // seeded generator so a re-render's tape wanders the same way. Two decks on
  // the same seed against the same controls have to agree frame for frame —
  // and the unseeded pair below is the control, since a wander that repeated
  // anyway would make the seeded arm prove nothing.
  it('wanders identically from the same dice, and differently without', () => {
    const wobble = { ...still, tapeWowPct: 5, tapeColourFrame: 0 }
    const run = (tape: TapeState) => {
      const seen = []
      for (let f = 0; f < 300; f++) seen.push(delayOf(tape.update(wobble, f)))
      return seen
    }
    expect(run(new TapeState(rngFor(7)))).toEqual(run(new TapeState(rngFor(7))))
    expect(run(new TapeState(rngFor(7)))).not.toEqual(
      run(new TapeState(rngFor(8))),
    )
  })
})
