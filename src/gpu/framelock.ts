// The frame lock's 'auto' position: decide, from the loop's own cadence,
// whether to render every refresh or every second one. Lives outside Engine
// because it is the one part of frame pacing that is decidable without a GPU
// — a pure state machine over refresh intervals — and because its constants
// encode platform lessons that deserve tests rather than re-discovery:
//
//  - rAF delivers *catch-up callbacks* milliseconds apart after a stall, so
//    any floor that trusts the fastest interval reads every normal frame
//    after one of those as a miss.
//  - A percentile floor fails the other way: a window where most frames miss
//    reads as steady-slow and never engages.
//  - Firefox re-paces rAF between vsync and a ~60 Hz software tick depending
//    on whether refreshes present, so the handover after every divisor change
//    scores phantom misses against the mode that just started.
//
// What survived is judging each window on the spread of its own intervals:
// a loop that keeps its rate — any rate — shows p75 ~ p25, and a loop
// wavering between vsync steps shows p75 near double p25, because a skipped
// vsync doubles the interval. The spread is the stutter the eye objects to,
// and it needs no absolute refresh estimate (panels run 48, 60 or 144 as
// happily). A window that is slow but STEADY deliberately does not engage:
// the lock trades rate for steadiness, and that window has nothing to trade.

// Cadence is judged one window at a time.
export const LOCK_WINDOW = 60
export const LOCK_P_LO = 15
export const LOCK_P_HI = 45
export const LOCK_SPREAD = 1.5
// How long to hold the lock before probing full rate again. Doubles on every
// failed probe up to the cap, so a rig that is genuinely too slow settles into
// a steady half rate with a brief wobble once a minute instead of flapping.
export const LOCK_PROBE_MS = 4000
export const LOCK_PROBE_MS_MAX = 64000
// Refreshes left unjudged after every divisor change (and after a visibility
// gap): the scheduler's handover jitter is not load.
export const LOCK_GRACE = 30
// An interval this long is a hidden tab or a stalled loop, not a slow frame;
// judging it would engage the lock the moment the user tabs back.
export const LOCK_GAP_MS = 250
// Startup grace is longer than a transition's: pipeline compiles and source
// loading stutter the first seconds honestly, and locking on them would start
// every session at half rate.
export const LOCK_STARTUP_GRACE = 4 * LOCK_GRACE

export class AutoLock {
  private lastT = 0
  private dts = new Float32Array(LOCK_WINDOW)
  private n = 0
  private probeAt = 0
  private probeWait = LOCK_PROBE_MS
  private probing = false
  private grace = LOCK_STARTUP_GRACE
  private divisor = 1

  // Read-only views for the stats readout and harness traces.
  get div(): number {
    return this.divisor
  }

  get isProbing(): boolean {
    return this.probing
  }

  // One refresh: feed the current time, get the divisor to render under.
  tick(now: number): number {
    const dt = now - this.lastT
    this.lastT = now
    // While locked, the only question is whether it is time to try full rate
    // again; the locked loop's own cadence says nothing about what full rate
    // would cost.
    if (this.divisor === 2) {
      if (now >= this.probeAt) {
        this.divisor = 1
        this.probing = true
        this.grace = LOCK_GRACE
        this.n = 0
      }
      return this.divisor
    }
    // The frames right after a gap get grace too — resumption jitter is not
    // load.
    if (dt <= 0 || dt > LOCK_GAP_MS) {
      this.grace = Math.max(this.grace, LOCK_GRACE)
      this.n = 0
      return 1
    }
    if (this.grace > 0) {
      this.grace -= 1
      return 1
    }
    this.dts[this.n] = dt
    this.n += 1
    if (this.n < LOCK_WINDOW) return 1
    this.n = 0
    // Judge the completed window on the spread of its own intervals. The
    // typed array sorts numerically without a comparator — the boxing copy
    // that used to sit here was only ever buying `Array`'s lexicographic
    // default something to be talked out of.
    const sorted = this.dts.toSorted()
    if (sorted[LOCK_P_HI] > sorted[LOCK_P_LO] * LOCK_SPREAD) {
      this.divisor = 2
      // A probe that failed doubles the wait; wavering that arrived on its
      // own starts the backoff over.
      this.probeWait = this.probing
        ? Math.min(this.probeWait * 2, LOCK_PROBE_MS_MAX)
        : LOCK_PROBE_MS
      this.probeAt = now + this.probeWait
      this.probing = false
      this.grace = LOCK_GRACE
    } else if (this.probing) {
      // A clean probe window: full rate is affordable again.
      this.probing = false
      this.probeWait = LOCK_PROBE_MS
    }
    return this.divisor
  }
}
