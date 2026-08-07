import { describe, expect, it } from 'vitest'

import { MAX_REBUILDS, REBUILD_WINDOW_MS, RebuildPolicy } from './rebuildPolicy'

describe('RebuildPolicy', () => {
  it('rebuilds through the first losses of a run', () => {
    const p = new RebuildPolicy()
    for (let i = 0; i < MAX_REBUILDS; i++) {
      expect(p.record(i * 1000)).toBe('rebuild')
    }
    expect(p.attempt).toBe(MAX_REBUILDS)
  })

  it('gives up once the losses keep arriving inside the window', () => {
    const p = new RebuildPolicy()
    for (let i = 0; i < MAX_REBUILDS; i++) p.record(i * 1000)
    // A device that dies, comes back and dies again: rebuilding forever would
    // hide the fault behind a picture that detonates every few seconds.
    expect(p.record(MAX_REBUILDS * 1000)).toBe('give-up')
  })

  it('starts a fresh count after a rebuild that held', () => {
    const p = new RebuildPolicy()
    for (let i = 0; i < MAX_REBUILDS; i++) p.record(i * 1000)

    // A laptop that sleeps four times in a day-long session has had four one-off
    // losses, not a loop — each was genuinely handled, and ending the session on
    // the fourth would be wrong. This is the reason it is not a lifetime budget.
    const later = MAX_REBUILDS * 1000 + REBUILD_WINDOW_MS + 1
    expect(p.record(later)).toBe('rebuild')
    expect(p.attempt).toBe(1)
  })

  it('treats a loss on the window boundary as still part of the run', () => {
    const p = new RebuildPolicy()
    p.record(0)
    // Exactly REBUILD_WINDOW_MS later is not *more* than the window, so it
    // stacks. The reset needs a gap strictly longer than the window, or a device
    // failing on a period that happens to match it would rebuild forever.
    expect(p.attempt).toBe(1)
    p.record(REBUILD_WINDOW_MS)
    expect(p.attempt).toBe(2)
    p.record(REBUILD_WINDOW_MS * 2 + 1)
    expect(p.attempt).toBe(1)
  })

  it('counts a first loss as attempt one wherever the clock happens to be', () => {
    // `performance.now()` is whatever it is when the device goes; a session that
    // has been up for an hour and one that just started must both read their
    // first loss as the first.
    for (const t of [0, 1, REBUILD_WINDOW_MS, 3_600_000]) {
      const p = new RebuildPolicy()
      expect(p.record(t)).toBe('rebuild')
      expect(p.attempt).toBe(1)
    }
  })

  it('rebuilds indefinitely through faults a reset vouches for', () => {
    const p = new RebuildPolicy()
    // A card that suspends five seconds into a hidden tab hangs again every time
    // the user comes back, which on an alt-tab cadence is well inside the
    // window. Each one was handled — the caller says so by resetting — so the
    // count must never build, however many arrive or how fast.
    for (let i = 0; i < MAX_REBUILDS * 3; i++) {
      p.reset()
      expect(p.record(i * 1000)).toBe('rebuild')
      expect(p.attempt).toBe(1)
    }
    // A reset leaves the policy exactly as it was constructed, `attempt`
    // included. The verdict alone does not pin that down — `lastAt` at -Infinity
    // already forces the fresh branch on the next record — but a reader who
    // resets and then reads `attempt` should not be told about a run that has
    // been forgiven.
    p.reset()
    expect(p.attempt).toBe(0)
  })

  it('still gives up on faults no reset vouches for', () => {
    const p = new RebuildPolicy()
    // The other half of the same rule: a replacement device that never completed
    // any work is not vouched for, so it stacks and the escalation stays
    // bounded. Interleaved with vouched-for ones to prove the reset only
    // forgives the fault it was called about.
    p.reset()
    expect(p.record(0)).toBe('rebuild')
    for (let i = 1; i <= MAX_REBUILDS; i++) {
      expect(p.record(i * 10)).toBe(i === MAX_REBUILDS ? 'give-up' : 'rebuild')
    }
  })

  it('keeps counting past the limit so the verdict stays give-up', () => {
    const p = new RebuildPolicy()
    for (let i = 0; i <= MAX_REBUILDS; i++) p.record(i * 10)
    // A loss arriving after the session already gave up must not wrap back
    // around to a rebuild.
    expect(p.record(MAX_REBUILDS * 10 + 10)).toBe('give-up')
    expect(p.record(MAX_REBUILDS * 10 + 20)).toBe('give-up')
  })
})
