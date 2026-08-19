import { describe, expect, it } from 'vitest'

import {
  AutoLock,
  LOCK_GRACE,
  LOCK_PROBE_MS,
  LOCK_PROBE_MS_MAX,
  LOCK_STARTUP_GRACE,
  LOCK_WINDOW,
} from './framelock'

// Drive the lock with a sequence of refresh intervals, returning the divisor
// each tick chose. Time is synthetic and absolute, so the tests own the clock.
function feed(
  lock: AutoLock,
  t0: number,
  dts: number[],
): { divs: number[]; t: number } {
  let t = t0
  const divs = dts.map(dt => {
    t += dt
    return lock.tick(t)
  })
  return { divs, t }
}

// Enough steady frames to burn the startup grace and settle one full window.
const WARM = LOCK_STARTUP_GRACE + LOCK_WINDOW

// A 48 Hz panel's kept refresh, and the doubled interval of a skipped one.
const KEPT = 21
const SKIPPED = 42

describe('AutoLock', () => {
  it('never engages on a steady cadence', () => {
    const lock = new AutoLock()
    const { divs } = feed(
      lock,
      0,
      Array.from({ length: WARM * 3 }, () => KEPT),
    )
    expect(divs.every(d => d === 1)).toBe(true)
  })

  it('never engages on a cadence that is slow but steady', () => {
    // The lock trades rate for steadiness; a loop already steady at half rate
    // has nothing to trade, and halving it again would only hurt.
    const lock = new AutoLock()
    const { divs } = feed(
      lock,
      0,
      Array.from({ length: WARM * 3 }, () => SKIPPED),
    )
    expect(divs.every(d => d === 1)).toBe(true)
  })

  it('engages on a wavering cadence', () => {
    const lock = new AutoLock()
    const wavering = Array.from({ length: WARM }, (_, i) =>
      i % 2 === 0 ? KEPT : SKIPPED,
    )
    const { divs } = feed(lock, 0, wavering)
    expect(divs.at(-1)).toBe(2)
  })

  it("shrugs off rAF's catch-up callbacks", () => {
    // After a stall, rAF delivers the next callback milliseconds later. A
    // floor built on the fastest interval reads everything after one of those
    // as a miss; the quartile spread must not.
    const lock = new AutoLock()
    const dts: number[] = []
    for (let i = 0; i < WARM * 3; i++) {
      // one stall-plus-catch-up pair per window, steady otherwise
      const inWindow = i % LOCK_WINDOW
      dts.push(inWindow === 20 ? 60 : inWindow === 21 ? 2 : KEPT)
    }
    const { divs } = feed(lock, 0, dts)
    expect(divs.every(d => d === 1)).toBe(true)
  })

  it('treats a long gap as a hidden tab, not as load', () => {
    const lock = new AutoLock()
    const steady = Array.from({ length: WARM }, () => KEPT)
    const { t } = feed(lock, 0, steady)
    // Tab hidden for five seconds, then steady again: the gap and the frames
    // behind it must not engage the lock.
    const { divs } = feed(lock, t, [5000, ...steady])
    expect(divs.every(d => d === 1)).toBe(true)
  })

  it('probes full rate after the wait, and unlocks on a clean window', () => {
    const lock = new AutoLock()
    const wavering = Array.from({ length: WARM }, (_, i) =>
      i % 2 === 0 ? KEPT : SKIPPED,
    )
    let { t } = feed(lock, 0, wavering)
    expect(lock.div).toBe(2)
    // Sit locked until the probe fires: locked ticks return 2 until probeAt.
    while (lock.tick((t += KEPT)) === 2) {
      expect(t).toBeLessThan(LOCK_PROBE_MS * 3)
    }
    expect(lock.isProbing).toBe(true)
    // Full rate is affordable now: a grace period plus one clean window ends
    // the probe and the lock stays off.
    const { divs } = feed(
      lock,
      t,
      Array.from({ length: LOCK_GRACE + LOCK_WINDOW }, () => KEPT),
    )
    expect(divs.every(d => d === 1)).toBe(true)
    expect(lock.isProbing).toBe(false)
    expect(lock.div).toBe(1)
  })

  it('doubles the wait on a failed probe, up to the cap', () => {
    const lock = new AutoLock()
    const waveringWindow = () =>
      Array.from({ length: LOCK_GRACE + LOCK_WINDOW }, (_, i) =>
        i % 2 === 0 ? KEPT : SKIPPED,
      )
    let { t } = feed(lock, 0, [
      ...Array.from({ length: LOCK_STARTUP_GRACE }, () => KEPT),
      ...waveringWindow(),
    ])
    expect(lock.div).toBe(2)
    // Fail probe after probe; each relock must wait at least as long as the
    // last, and the wait must never pass the cap.
    let lastWait = 0
    for (let round = 0; round < 8; round++) {
      const lockedAt = t
      while (lock.tick((t += KEPT)) === 2) {
        expect(t - lockedAt).toBeLessThanOrEqual(LOCK_PROBE_MS_MAX + KEPT)
      }
      const wait = t - lockedAt
      expect(wait).toBeGreaterThanOrEqual(lastWait)
      lastWait = wait
      // the probe meets the same wavering and relocks
      t = feed(lock, t, waveringWindow()).t
      expect(lock.div).toBe(2)
    }
    expect(lastWait).toBeLessThanOrEqual(LOCK_PROBE_MS_MAX + KEPT)
    expect(lastWait).toBeGreaterThan(LOCK_PROBE_MS * 4)
  })
})
