import { describe, expect, it } from 'vitest'

import { stalledAt } from './frames.mjs'

// The judgement, without a browser — which is the only way it gets tested at
// all, since the alternative is covering up a window by hand and watching what
// happens. What has to be right is that a throttled window trips it, a healthy
// one does not, and a slow moment is not a verdict.
describe('stalledAt', () => {
  // 60fps for `secs` seconds, one sample a second.
  const at = (secs, fps) =>
    Array.from({ length: secs + 1 }, (_, i) => ({
      at: 1000 * i,
      frames: Math.round(i * fps),
    }))

  it('says nothing about a window being drawn normally', () => {
    expect(stalledAt(at(10, 60))).toBeNull()
  })

  // The number that matters: an occluded window on this platform is throttled
  // to about 1 Hz rather than stopped, so a check for "no frames at all" would
  // watch it happen and say nothing.
  it('catches a window throttled to about 1Hz', () => {
    expect(stalledAt(at(10, 1))).toMatch(/frames a second/)
  })

  it('catches one stopped outright', () => {
    expect(stalledAt(at(10, 0))).not.toBeNull()
  })

  // A run that has only just started has not earned an opinion yet.
  it('waits for the grace window before judging', () => {
    expect(stalledAt(at(2, 0), { graceMs: 6000 })).toBeNull()
    expect(stalledAt(at(7, 0), { graceMs: 6000 })).not.toBeNull()
  })

  // The case every other fixture here was hiding. Sampling once a second
  // against a 6000ms grace lands exactly on the window's edge, and the first
  // version of this function only fired on that exact tie — so it passed every
  // test above and could not fire at all in a real run, which polls at 200ms.
  // Spacing that does not divide the grace period is the whole point of it.
  it('judges on spacing that does not divide the grace window', () => {
    const starved = Array.from({ length: 40 }, (_, i) => ({
      at: 200 * i,
      frames: 100,
    }))
    expect(stalledAt(starved, { graceMs: 1500 })).not.toBeNull()
  })

  it('and on spacing coarser than the window', () => {
    const starved = [
      { at: 0, frames: 10 },
      { at: 4000, frames: 10 },
      { at: 8000, frames: 10 },
    ]
    expect(stalledAt(starved, { graceMs: 1500 })).not.toBeNull()
  })

  it('says nothing at all with one sample or none', () => {
    expect(stalledAt([])).toBeNull()
    expect(stalledAt([{ at: 0, frames: 0 }])).toBeNull()
  })

  // A dropped second inside an otherwise healthy run: the rate over the window
  // is what counts, not the worst gap in it. Otherwise every GC pause is a
  // stall and the watchdog becomes the thing people turn off.
  it('is not tripped by one bad second in a healthy run', () => {
    const samples = at(10, 60)
    for (let i = 5; i < samples.length; i++) samples[i].frames -= 55
    expect(stalledAt(samples)).toBeNull()
  })

  // A navigation restarts the page's counter, so the delta across the join is
  // negative. Reported as a rate that read `-47.0 animation frames a second`,
  // which is how the bug was found — and it would have killed `poolcheck` at
  // the deliberate reload it does to prove the shelf survives one.
  it('does not read a new document as a stalled one', () => {
    const before = at(8, 60)
    const after = [
      { at: 9000, frames: 3 },
      { at: 10_000, frames: 63 },
    ]
    expect(stalledAt([...before, ...after])).toBeNull()
  })

  // And the other direction: a window that recovers is judged on where it is
  // now, not on the worst it has been, so the run carries on.
  it('clears once the frames come back', () => {
    const dead = Array.from({ length: 8 }, (_, i) => ({
      at: 1000 * i,
      frames: i,
    }))
    const back = Array.from({ length: 8 }, (_, i) => ({
      at: 8000 + 1000 * i,
      frames: 8 + i * 60,
    }))
    expect(stalledAt([...dead, ...back])).toBeNull()
  })
})
