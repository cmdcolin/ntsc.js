import { describe, expect, it, vi } from 'vitest'

import { Fault, cutFrameOf, faultDepth } from './fault'

// Every frame of a span, so a shape can be asserted as a shape rather than as
// three sampled points.
const run = (frames: number, cut: number) => {
  const at = cutFrameOf(frames, cut)
  return Array.from({ length: frames }, (_, f) => faultDepth(f, frames, at))
}

describe('faultDepth', () => {
  it('starts and ends on an untouched board, and peaks exactly once', () => {
    const d = run(20, 0.5)
    expect(d[0]).toBe(0)
    expect(d[d.length - 1]).toBe(0)
    expect(d.filter(v => v === 1)).toHaveLength(1)
  })

  it('rises to the cut frame and falls after it', () => {
    const frames = 21
    const at = cutFrameOf(frames, 0.5)
    const d = run(frames, 0.5)
    expect(at).toBe(10)
    for (let f = 1; f <= at; f++) expect(d[f]).toBeGreaterThan(d[f - 1])
    for (let f = at + 1; f < frames; f++) expect(d[f]).toBeLessThan(d[f - 1])
  })

  // The half that makes it two curves rather than one shape slid sideways: an
  // off-centre cut re-times both halves, so the peak still lands on the cut and
  // both ends still reach zero. `dub` is the shelf entry that needs this — its
  // wear has to ride the incoming clip, so it cuts at 0.35 and spends the
  // remaining two thirds healing.
  it('re-times both halves when the cut is off centre', () => {
    const frames = 41
    const at = cutFrameOf(frames, 0.25)
    expect(at).toBe(10)
    const d = run(frames, 0.25)
    expect(d[at]).toBe(1)
    expect(d[0]).toBe(0)
    expect(d[frames - 1]).toBe(0)
    // The whole point of moving the cut: the healing takes longer than the
    // breaking, so most of the fault is on the incoming clip. Counted as frames
    // spent above half rather than compared at a fixed offset either side —
    // sampling `at ± n` measures how far up two *differently scaled* ramps that
    // offset is, which is a real quantity and not this one.
    const above = d.map(v => v > 0.5)
    expect(above.slice(at + 1).filter(Boolean).length).toBeGreaterThan(
      above.slice(0, at).filter(Boolean).length,
    )
  })

  it('eases rather than ramping, so it reads as something coming loose', () => {
    const frames = 21
    const d = run(frames, 0.5)
    // Smoothstep sits below the line early and above it late; a linear ramp
    // would sit on it at both.
    expect(d[2]).toBeLessThan(2 / 10)
    expect(d[8]).toBeGreaterThan(8 / 10)
  })

  // Both degenerate cuts are reachable and neither is on the shelf — see the
  // note on `faultDepth`. They are asserted because "reachable" is a claim.
  it('a cut at the very start is an attack that only heals', () => {
    const d = run(10, 0)
    expect(d[0]).toBe(1)
    expect(d[9]).toBe(0)
  })

  it('a cut at the very end is a break that never heals', () => {
    const d = run(10, 1)
    expect(d[0]).toBe(0)
    expect(d[9]).toBe(1)
  })

  it('is off outside its own span', () => {
    expect(faultDepth(-1, 10, 5)).toBe(0)
    expect(faultDepth(10, 10, 5)).toBe(0)
  })
})

describe('Fault', () => {
  const plan = (frames: number, cut: number, onCut = () => {}) => ({
    peak: { vSize: 0.2 },
    frames,
    cut,
    onCut,
  })

  it('runs for exactly its span and then stops', () => {
    const f = new Fault()
    f.start(plan(5, 0.5))
    for (let i = 0; i < 5; i++) expect(f.step()).not.toBeNull()
    expect(f.step()).toBeNull()
    expect(f.running).toBe(false)
  })

  it('fires the cut once, on the frame the peak lands', () => {
    const onCut = vi.fn()
    const f = new Fault()
    f.start(plan(11, 0.5, onCut))
    const depths = Array.from({ length: 11 }, () => {
      const before = onCut.mock.calls.length
      const step = f.step()
      return { depth: step?.depth, fired: onCut.mock.calls.length > before }
    })
    expect(onCut).toHaveBeenCalledTimes(1)
    const cutAt = depths.findIndex(d => d.fired)
    expect(depths[cutAt].depth).toBe(1)
  })

  it('hands back the peak so the caller never reaches into the plan', () => {
    const f = new Fault()
    f.start(plan(4, 0.5))
    expect(f.step()?.peak).toEqual({ vSize: 0.2 })
  })

  // A hand that hits a second transition mid-flight has said which one it
  // wants. The board is handed back by the frame that ran, not by this one, so
  // replacing cannot strand a control off its resting value.
  it('replaces a fault in flight rather than refusing', () => {
    const f = new Fault()
    f.start(plan(60, 0.5))
    f.step()
    f.start({ peak: { dubGens: 4 }, frames: 4, cut: 0.5, onCut: () => {} })
    expect(f.step()?.peak).toEqual({ dubGens: 4 })
    expect(f.step()?.depth).toBeGreaterThan(0)
  })

  it('stops on request, for a take that is about to rewind the counter', () => {
    const f = new Fault()
    f.start(plan(60, 0.5))
    f.stop()
    expect(f.step()).toBeNull()
  })

  // Rounded and floored on the way in, so a span asked for in a hurry is brief
  // rather than absent and a fractional one cannot land between two frames.
  it('is at least one frame long', () => {
    const f = new Fault()
    f.start(plan(0, 0.5))
    expect(f.step()?.depth).toBe(1)
    expect(f.step()).toBeNull()
  })
})
