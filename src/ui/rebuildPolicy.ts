// How many lost devices in a row a session rebuilds through before it gives up.
//
// What this guards against is a *loop* — a device that dies, comes back, and
// dies again — because silently rebuilding through that hides the fault behind a
// picture that detonates every few seconds, and each rebuild costs the user
// everything VRAM was holding (phosphor trails, the frame store, the tape loop).
//
// It is deliberately **not** a lifetime budget, and that is the whole subtlety:
// a laptop that sleeps four times across a day-long session has suffered four
// one-off losses, each of which the rebuild genuinely handles, and telling that
// user the session is over on the fourth would be wrong. A rebuild that held for
// `windowMs` did its job, so the next loss starts a fresh count; only losses
// that keep arriving inside the window stack up toward giving in.
//
// Pulled out of useEngine's mount effect because it is the one piece of that
// closure that is pure policy — everything around it is refs, timers and React
// state, which is why the behaviour could previously only be exercised by
// driving a real browser at it (scripts/deviceloss.mjs).

export const MAX_REBUILDS = 3
export const REBUILD_WINDOW_MS = 60_000

export type LossVerdict = 'rebuild' | 'give-up'

export class RebuildPolicy {
  private count = 0
  // "No loss yet". Nothing turns on the value — with `count` at 0 the first
  // record yields 1 down either branch — but -Infinity says that in a way a 0
  // read off the same clock as `now` does not.
  private lastAt = -Infinity
  private readonly max: number
  private readonly windowMs: number

  constructor(max = MAX_REBUILDS, windowMs = REBUILD_WINDOW_MS) {
    this.max = max
    this.windowMs = windowMs
  }

  // Record a lost device and say whether to replace it. `now` is passed in
  // rather than read, so the caller owns the clock and this stays testable.
  record(now: number): LossVerdict {
    this.count = now - this.lastAt > this.windowMs ? 1 : this.count + 1
    this.lastAt = now
    return this.count > this.max ? 'give-up' : 'rebuild'
  }

  // Forget the run so far: the next fault starts a fresh count.
  //
  // The window above asks "did the replacement hold for long enough", which is
  // the only proof available for a device that goes away. A hang has a better
  // one — whether the device ever completed any work at all — and it needs it,
  // because the fault that feeds the hang path most often is a discrete card
  // suspending under a hidden tab, whose cadence is tab-switching rather than
  // anything about the GPU. Four of those inside `windowMs` are four one-off
  // faults the rebuild handled, not a device that came back wrong, and the
  // caller with that evidence says so here. See useEngine's `rebuild`.
  reset(): void {
    this.count = 0
    this.lastAt = -Infinity
  }

  // Which attempt the loss just recorded is, for the console breadcrumb and the
  // "replaced N times" wording on the fatal screen.
  get attempt(): number {
    return this.count
  }

  get limit(): number {
    return this.max
  }
}
