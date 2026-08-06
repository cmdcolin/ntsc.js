import { isFocused, isFullscreen, isVisible, timelineNow } from './env'
import { watchRenderStep } from './renderstep'
import { clearFramelessStarts, recordFramelessStart, trace } from './trace'

import type { FrameStats } from '../controls'
import type { RenderStep } from './renderstep'

// Frames per stats window. Shorter windows update the readout more responsively;
// ~15 frames is roughly a quarter-second at 60 fps.
const STATS_WINDOW = 15

// Liveness watchdog, fired from a setInterval (which keeps running even when
// requestAnimationFrame does not). It handles two independent failures:
//
//  - rAF stops being delivered while the tab is visible and focused. Firefox on
//    Linux does this across fullscreen transitions and window occlusion even
//    though visibilityState stays 'visible', and re-requesting rAF does not wake
//    it. So instead of relying on rAF, we drive the render loop from setTimeout
//    (FALLBACK_MS) until rAF resumes — the picture stays live either way. The
//    fallback waits on queue completion between frames: rAF was also the only
//    backpressure against the compositor, and a fixed-interval timer without it
//    submits into a queue nothing is draining. It is also *bounded*
//    (FALLBACK_BUDGET_MS). A short rAF gap — the kind a fullscreen exit leaves
//    behind — is worth bridging. A long one usually means the compositor has
//    stopped painting this surface entirely, and then every frame the fallback
//    renders is invisible by construction: it cannot reach a screen nothing is
//    compositing. Pumping on regardless only burns GPU and keeps a stuck
//    swapchain busy, which is how a recoverable stall becomes a dead tab. So the
//    fallback gives up and leaves the cheap watchdog to notice if rAF returns.
//  - The GPU itself wedges: submitted work never completes (Firefox/Linux can
//    silently lose the device without firing device.lost). We probe queue
//    completion raced against HANG_MS; HANG_STRIKES consecutive misses means the
//    loop is spinning on a dead device, so we surface it instead of freezing.
export const WATCHDOG_MS = 2000
export const FALLBACK_MS = 33
export const FALLBACK_BUDGET_MS = 5000
export const HANG_MS = 4000
export const HANG_STRIKES = 2

// A hang strike is only honest if the main thread was running during the probe.
// Firefox resolves onSubmittedWorkDone from a main-thread timer, so a blocked
// main thread makes a perfectly healthy GPU look wedged: measured on Firefox
// Nightly, spinning the main thread for 6 s with *nothing submitted and the GPU
// idle* left the promise unresolved for 6001 ms. The timeout that scores the
// strike is on that same thread, so when it fires far past its due time that is
// the tell — the browser could not have run the completion callback either, and
// the probe says nothing about the GPU. Score the strike only if the timer was
// roughly punctual.
export const HANG_LATE_FACTOR = 1.5

// How long submitted work may sit unconfirmed before the rAF path stops adding
// to the queue.
//
// rAF is not backpressure. It paces *submission* to the display, not to the
// device: if a frame costs more GPU time than a refresh interval, every callback
// adds more work than the GPU retires and the queue grows without bound. That is
// slow and quiet — at ~21 ms a frame against a 16.7 ms budget it accumulates
// only ~4 ms per frame — which is exactly why it reads as "it freezes after a
// while" rather than as a frame-rate problem. Measured: 120 frames submit in
// 27 ms of JS and take 1121 ms of GPU to drain.
//
// This is a *wait*, and the fact that it is not a frame count is the whole
// point. A count has to be sized against Firefox's completion latency, which is
// a 100 ms poll (bug 1870699) and therefore a floor no device beats: a probe
// armed now reports on work submitted now, but only ~100 ms later, so on a
// device finishing instantly the frames submitted during *two* poll periods are
// permanently unconfirmed. That is ~12 at 60 Hz and ~29 at 144 Hz, so no single
// count leaves a fast display alone while still catching anything at 60 Hz. The
// count this replaces (12) dropped 58% of a healthy 144 Hz session, 50% at
// 120 Hz, 20% at 75 Hz, and 16% at 60 Hz whenever the poll ran 20 ms slow — all
// of it announced as "the signal path is costing more than a refresh interval",
// which was never true.
//
// A wait has no such dependency. On a device that is keeping up the probe
// settles at the poll floor however many frames went into it, so the only thing
// that carries this past its threshold is the queue genuinely taking longer to
// drain. Five times the floor: clear of poll jitter, and far enough below the
// hang watchdog's first strike (HANG_MS) that throttling always gets to act
// first.
export const MAX_QUEUE_WAIT_MS = 500

export interface RenderLoopHost {
  // Narrowed to the completion probe the loop actually uses — a real GPUDevice
  // satisfies it, and the lifecycle tests don't have to fake the rest of one.
  device: { queue: Pick<GPUQueue, 'onSubmittedWorkDone'> }
  render: () => void
  onStats: (stats: FrameStats) => void
  // The loop reports only what it can observe — submitted work that never
  // completes. Whether that is a lost device is the owner's call, and the
  // wording shown to the user is the UI's; neither belongs here.
  onHang: () => void
  // Last-ditch recovery, once per stall, when rAF has not come back on its own.
  // Re-requesting rAF is not enough — a trace caught it delivering three
  // callbacks after a hidden stretch and then stopping for good — so the owner
  // gets a chance to rebuild the presentation surface instead.
  recover: () => void
  // The picture is now frozen (true) or live again (false). Latched when the
  // fallback spends its budget, cleared when rAF comes back. Giving up used to
  // be silent, which left a tab that the compositor had abandoned looking
  // identical to a bug in the signal path — the app is fine, it just cannot
  // reach the screen, and only the user can act on that.
  onFrozen: (frozen: boolean) => void
  // Current frame number, for log breadcrumbs only.
  frameNo: () => number
}

// Drives one render callback at display rate and keeps it alive across the
// Firefox/Linux failure modes that freeze a naive rAF loop: rAF silently
// ceasing to fire while the tab is visible, and the GPU device wedging without
// firing device.lost. Pure lifecycle machinery — it knows nothing about the
// signal path it happens to be pumping.
export class RenderLoop {
  private host: RenderLoopHost
  private live = false
  private lastTime = 0
  private frameAcc = 0
  private frameCount = 0
  private gens = { render: 0, probe: 0 }
  private renderErrors = 0
  private watchdogId = 0
  private hangStrikes = 0
  private probing = false
  private rafTicks = 0
  private lastRafTicks = 0
  // A second baseline, for the recorded line only. `lastRafTicks` is the stall
  // logic's and is deliberately *not* refreshed on every beat — a hidden tab
  // returns early and leaves it standing — so reading the trace off it printed
  // a rAF delta accumulated over several beats next to a step delta measured
  // over one, which is how a hidden beat came to claim 57 frames and a dead
  // rendering step in the same line.
  private lastBeatRaf = 0
  // Second rAF chain, counting only. See startProbe.
  private probeTicks = 0
  private lastProbeTicks = 0
  private stalled = false
  private fallbackId = 0
  private pumping = false
  // When the current stall began, and whether the fallback has already spent its
  // budget on it. Both reset when rAF comes back, so a later stall gets a fresh
  // bridge rather than inheriting a spent one.
  private stallSince = 0
  private gaveUp = false
  // The completion probe the backpressure gate reads: whether one is outstanding,
  // when it was armed, and how many frames have been submitted since. The frame
  // count is not a budget — it only answers "is there anything for the device to
  // be behind on", so a probe left hanging by a blocked main thread (which is
  // where Firefox resolves it from) cannot be read as a slow GPU.
  private drainProbe = false
  private probeArmedAt = 0
  private framesSinceProbe = 0
  // Retires a probe outstanding across a stop/start, the same way the rAF chains
  // retire themselves. Without it a restart leaves the old probe live, and when
  // it settles it re-arms on top of the new one — every restart doubling the
  // number in flight, each one clobbering the arm time the gate reads.
  private drainGen = 0
  private throttled = false
  // Whether this session has *ever* been given an animation frame. A loop that
  // stalls after running is a different fault from one that was never ticked at
  // all: the first is a pause worth bridging, the second says the tab was
  // already broken when the document arrived, and no reload of that document
  // can fix what predates it.
  private everRaf = false
  // The rendering step, watched through ResizeObserver rather than rAF, and the
  // refresh driver's own clock. Together they say whether a flat rAF count means
  // the step stopped or only its animation-frame callbacks were dropped — see
  // renderstep.ts.
  private step: RenderStep | null = null
  private lastStepTicks = 0
  private lastTimeline: number | null = null

  constructor(host: RenderLoopHost) {
    this.host = host
  }

  get running(): boolean {
    return this.live
  }

  // Every field a previous run could have left dirty is reset here, so a
  // restarted loop can't inherit a stale stall flag or rAF baseline and declare
  // a phantom stall on its first watchdog tick.
  start(): void {
    this.live = true
    this.stalled = false
    this.pumping = false
    this.stallSince = 0
    this.setGaveUp(false)
    this.probing = false
    this.rafTicks = 0
    this.lastRafTicks = 0
    this.lastBeatRaf = 0
    this.probeTicks = 0
    this.lastProbeTicks = 0
    this.lastTime = 0
    this.frameAcc = 0
    this.frameCount = 0
    this.hangStrikes = 0
    this.drainProbe = false
    this.probeArmedAt = 0
    this.framesSinceProbe = 0
    this.throttled = false
    this.everRaf = false
    this.step?.stop()
    this.step = watchRenderStep()
    this.lastStepTicks = 0
    this.lastTimeline = timelineNow()
    trace.add('start')
    this.startRender()
    this.startProbe()
    this.startDrainProbe()
    this.watchdogId = setInterval(this.watchdog, WATCHDOG_MS)
  }

  // Both rAF chains run on this, and it is where the loop's central invariant
  // lives: nothing is ever cancelled.
  //
  // cancelAnimationFrame is the only operation that can leave this class with no
  // request outstanding, and it used to run on every visibility and focus
  // transition — exactly when the browser is suspending and resuming its refresh
  // driver, and exactly where a trace caught eight hidden/visible flips followed
  // by rAF never being delivered again. Cancel-then-request has to be atomic
  // against a driver doing its own bookkeeping underneath, and nothing says it
  // is. A chain retires itself instead: on its next callback it finds the loop
  // stopped, or a newer generation of its own kind, and simply declines to
  // re-arm. Starting one can therefore only ever *add*, never subtract.
  //
  // `body` runs after the re-arm, never before, so a synchronous throw in it
  // (getCurrentTexture during a fullscreen transition, a React setState in
  // onStats) cannot leave the loop un-scheduled — the classic "canvas froze,
  // controls look dead" hang.
  private startChain(kind: 'render' | 'probe', body: (time: number) => void) {
    const gen = (this.gens[kind] += 1)
    const step = (time: number): void => {
      if (this.live && gen === this.gens[kind]) {
        requestAnimationFrame(step)
        body(time)
      }
    }
    requestAnimationFrame(step)
  }

  // A chain that does nothing but count, never kicked and never touched by the
  // stall logic. When the picture stalls, `rafTicks` going flat has two possible
  // causes that want opposite fixes — the document is getting no rAF at all
  // (browser bug) or only the render chain was dropped (ours) — and this is what
  // tells them apart.
  private startProbe(): void {
    this.startChain('probe', () => {
      this.probeTicks += 1
    })
  }

  stop(): void {
    trace.add('stop', `frame ${this.host.frameNo()}`)
    trace.flush(true)
    // No cancelAnimationFrame: dropping `live` retires both chains on their next
    // callback, at a cost of one no-op call each. See startChain.
    this.live = false
    this.stalled = false
    this.pumping = false
    this.step?.stop()
    this.step = null
    clearInterval(this.watchdogId)
    clearTimeout(this.fallbackId)
    this.fallbackId = 0
  }

  private startRender(): void {
    this.startChain('render', time => {
      this.rafTicks += 1 // proof rAF is being delivered (watchdog reads it)
      if (!this.everRaf) {
        this.everRaf = true
        // This tab can be ticked, so whatever run of frameless sessions came
        // before it is over. Recorded across sessions rather than in the ring
        // because the run length is the diagnosis: see trace.ts.
        clearFramelessStarts()
      }
      if (this.stalled) {
        // Leave the fallback the instant rAF returns rather than waiting for the
        // watchdog, otherwise both drivers run frames for up to WATCHDOG_MS and
        // double the submission rate on a device that just demonstrated it was
        // struggling.
        this.stalled = false
        this.setGaveUp(false)
        trace.add('resume', `frame ${this.host.frameNo()}`)
        console.warn(
          `rAF resumed at frame ${this.host.frameNo()}; leaving fallback`,
        )
      }
      // Drop this frame rather than deepen a backlog the device is not keeping
      // up with. Dropping is the whole point: the picture is already however
      // many frames stale, and the only way back is to submit less than the GPU
      // retires. The canvas keeps showing its last presented frame, so a skipped
      // frame costs nothing visually that the backlog had not already cost.
      //
      // `lastTime` is deliberately left alone. Stats accumulate dt only on
      // rendered frames, so leaving it means the next one measures the whole gap
      // it actually waited and the readout reports the rate the user is seeing.
      // Advancing it here would charge that gap to nobody and report a serene 60
      // while the picture visibly stuttered — hiding the one symptom that says
      // the signal path has outgrown the device.
      if (this.queueLate()) {
        this.setThrottled(true)
        return
      }
      this.setThrottled(false)
      this.runFrame(time)
    })
  }

  // How long the outstanding completion probe has gone unsettled — which on a
  // device that is keeping up is Firefox's poll floor and nothing more, however
  // many frames were submitted into it. See MAX_QUEUE_WAIT_MS.
  private queueWait(): number {
    return this.drainProbe ? performance.now() - this.probeArmedAt : 0
  }

  // `framesSinceProbe`, and not as a budget: a probe is only evidence about the
  // GPU if there was work for the GPU to be behind on. Firefox resolves
  // onSubmittedWorkDone from a main-thread timer, so a main thread blocked with
  // nothing submitted leaves the probe hanging on a perfectly idle device — the
  // same lie HANG_LATE_FACTOR exists to catch on the hang watchdog. No frames
  // since it was armed means this gate has learned nothing.
  private queueLate(): boolean {
    return this.framesSinceProbe > 0 && this.queueWait() > MAX_QUEUE_WAIT_MS
  }

  // One completion probe outstanding at a time, re-armed the moment it settles,
  // so the gate always has a live reading. Re-arming on settle rather than on
  // submission matters more than it looks: once the loop is throttling it stops
  // submitting, so a probe armed only by a submission would never come back and
  // the loop would gate itself off permanently.
  //
  // Idempotent, and called from the watchdog too, so a device that refuses the
  // probe outright gets asked again every beat rather than leaving the gate
  // blind for the session.
  private startDrainProbe(): void {
    if (!this.drainProbe && this.live) {
      this.drainProbe = true
      this.probeArmedAt = performance.now()
      this.framesSinceProbe = 0
      const gen = (this.drainGen += 1)
      const settle = () => {
        if (gen === this.drainGen) {
          this.drainProbe = false
          this.startDrainProbe()
        }
      }
      try {
        void this.host.device.queue.onSubmittedWorkDone().then(settle, settle)
      } catch {
        // A device too broken to take the probe is the hang watchdog's business,
        // not this gate's. Left unarmed the gate simply reads zero and stops
        // throttling, rather than stopping the picture on top of a dead device.
        this.drainProbe = false
      }
    }
  }

  private setThrottled(v: boolean): void {
    if (this.throttled !== v) {
      this.throttled = v
      if (v) {
        const waited = Math.round(this.queueWait())
        trace.add(
          'throttle',
          `frame ${this.host.frameNo()} waited ${waited}ms on ${this.framesSinceProbe} frames`,
        )
        trace.flush(true)
        console.warn(
          `GPU work submitted ${waited}ms ago has not completed (${this.framesSinceProbe} frames since); dropping frames until it catches up (the signal path is costing more than a refresh interval)`,
        )
      } else {
        trace.add('throttleEnd', `frame ${this.host.frameNo()}`)
      }
    }
  }

  // One frame: stats + render, shared by the rAF loop and the setTimeout
  // fallback. Never throws — a bad frame must not stop whichever driver called.
  private runFrame(time: number): void {
    if (this.lastTime > 0) {
      const dt = time - this.lastTime
      this.frameAcc += dt
      this.frameCount += 1
      if (this.frameCount === STATS_WINDOW) {
        this.host.onStats({ fps: 1000 / (this.frameAcc / STATS_WINDOW) })
        this.frameAcc = 0
        this.frameCount = 0
      }
    }
    this.lastTime = time
    try {
      this.host.render()
    } catch (e) {
      this.renderErrors += 1
      if (this.renderErrors <= 3 || this.renderErrors % 120 === 0) {
        trace.add(
          'renderError',
          `#${this.renderErrors} ${e instanceof Error ? e.message : String(e)}`,
        )
        console.error(`render error #${this.renderErrors} (loop continues):`, e)
      }
    }
    // Counted here rather than at the rAF call site so the fallback pump lands
    // in the same accounting. A frame whose render threw is still counted: what
    // this answers is "was there work in this probe's window", and a frame that
    // failed part-way through can still have reached the queue.
    this.framesSinceProbe += 1
  }

  // setTimeout-driven fallback for when rAF has stopped being delivered. Runs
  // only while the watchdog has flagged a stall; `tick` clears `stalled` the
  // moment rAF resumes, and the next hop below then stops on its own. `pumping`
  // tracks the whole chain including the async wait, so a watchdog tick that
  // lands mid-flight can't start a second one.
  private startPump(): void {
    if (!this.pumping && !this.gaveUp) {
      this.pumping = true
      this.pump()
    }
  }

  // Sole writer of `gaveUp`, so the host hears every edge exactly once and can
  // hold it as plain state rather than polling for it.
  private setGaveUp(v: boolean): void {
    if (this.gaveUp !== v) {
      this.gaveUp = v
      this.host.onFrozen(v)
    }
  }

  // True while the stall is still young enough to be worth rendering into.
  // Latches `gaveUp` on the way past, so the watchdog stops restarting the pump
  // for this stall and the picture is simply left frozen until rAF returns.
  private bridging(): boolean {
    const within = performance.now() - this.stallSince < FALLBACK_BUDGET_MS
    if (!within && !this.gaveUp) {
      this.setGaveUp(true)
      // One attempt at rebuilding the surface on the way out. If it works the
      // next delivered rAF clears the stall, so a `resume` following this line
      // in the trace is the proof; nothing following it means the surface was
      // not what was stuck.
      this.host.recover()
      trace.add('fallbackGaveUp', `frame ${this.host.frameNo()}, tried recover`)
      trace.flush(true)
      console.warn(
        `rAF still not delivering after ${FALLBACK_BUDGET_MS}ms; rebuilt the presentation surface and stopped the fallback rather than submitting frames nothing is compositing`,
      )
    }
    return within
  }

  private pump = (): void => {
    this.fallbackId = 0
    if (this.live && this.stalled && this.bridging() && isVisible()) {
      this.runFrame(performance.now())
      // Wait for the frame just submitted to complete before scheduling the
      // next. rAF was the only thing pacing submission against the compositor;
      // a fixed-interval timer that ignores completion piles work onto a device
      // already too busy to give us frames, which is how a recoverable stall
      // becomes a hung GPU process — and that survives a page reload, because
      // it is not this page's process.
      try {
        void this.host.device.queue.onSubmittedWorkDone().then(
          () => {
            this.schedulePump()
          },
          () => {
            this.pumping = false
          },
        )
      } catch {
        this.pumping = false
      }
    } else {
      this.pumping = false
    }
  }

  private schedulePump(): void {
    if (this.live && this.stalled && !this.gaveUp) {
      this.fallbackId = setTimeout(this.pump, FALLBACK_MS)
    } else {
      this.pumping = false
    }
  }

  // Re-arm the loop after a transition (fullscreen exit, tab re-shown) that can
  // leave the browser having stopped delivering rAF callbacks. Safe on a healthy
  // loop and safe in a burst — see startChain.
  kick(): void {
    if (this.live) {
      this.startRender()
    }
  }

  // Detect a silently-dead device: while visible, re-arming rAF gets the loop
  // ticking again, but if the GPU itself is wedged the submitted work never
  // completes and the canvas stays frozen with no error. Probe queue completion
  // raced against a timeout; enough consecutive misses means the loop is
  // spinning on a dead device — surface it so the user gets guidance instead of
  // a frozen picture that a reload won't fix.
  private watchdog = (): void => {
    // Sampled before the early return, so a session that goes quiet records why
    // (hidden tab) instead of just stopping mid-trace. Only the qualitative half
    // is compared, so a steady session doesn't record a line every two seconds.
    const probeDelta = this.probeTicks - this.lastProbeTicks
    this.lastProbeTicks = this.probeTicks
    const rafDelta = this.rafTicks - this.lastBeatRaf
    this.lastBeatRaf = this.rafTicks
    // The rendering step and the refresh driver's clock: two readings of the
    // thing rAF rides on, taken by routes that are not rAF. Sampled every beat
    // rather than only on a stall, so a session that goes on to wedge has a run
    // of known-good readings in front of the break to compare against.
    const stepTicks = this.step?.ticks() ?? 0
    const stepDelta = this.step === null ? null : stepTicks - this.lastStepTicks
    this.lastStepTicks = stepTicks
    const now = timelineNow()
    const timeDelta =
      now === null || this.lastTimeline === null
        ? null
        : Math.round(now - this.lastTimeline)
    this.lastTimeline = now
    trace.beat(
      [
        isVisible() ? 'visible' : 'hidden',
        isFocused() ? 'focused' : 'unfocused',
        isFullscreen() ? 'fullscreen' : 'windowed',
        // Qualitative on purpose, so it costs nothing while it stays true and
        // records a line the moment it stops being true.
        stepDelta === null ? 'step?' : stepDelta > 0 ? 'step' : 'STEP-DEAD',
        this.stalled ? (this.gaveUp ? 'GAVE-UP' : 'STALLED') : 'ok',
      ].join(' '),
      `frame ${this.host.frameNo()} raf ${rafDelta}/beat probe ${probeDelta}/beat step ${stepDelta ?? '?'}/beat clock +${timeDelta ?? '?'}ms`,
    )
    trace.flush()
    // Give the observer something to deliver before the next beat reads it.
    this.step?.nudge()
    if (!this.live || !isVisible()) return
    // A device that threw the probe back synchronously left the gate unarmed and
    // therefore blind. This is the only thing still running that can offer it
    // another one.
    this.startDrainProbe()
    // The watchdog firing at all proves the main thread is alive. rAF throttling
    // while the window is unfocused/occluded is expected, so only judge rAF
    // liveness when focused: if rafTicks hasn't advanced since the last check,
    // the browser has stopped delivering rAF even though we're visible+focused
    // (Firefox/Linux does this across fullscreen transitions, and re-requesting
    // doesn't wake it). Drive the loop from setTimeout until rAF resumes.
    if (isFocused()) {
      const rafAlive = this.rafTicks !== this.lastRafTicks
      this.lastRafTicks = this.rafTicks
      if (!rafAlive) {
        if (!this.stalled) {
          this.stalled = true
          this.stallSince = performance.now()
          this.setGaveUp(false)
          // Three readings, narrowing. The probe chain separates "our render
          // chain was dropped" from "the document is getting nothing"; the
          // step witness then splits that second case into the one the
          // fallback can bridge and the one no reload can.
          const verdict =
            probeDelta > 0
              ? 'the document IS ticking, so the render chain was dropped on our side'
              : stepDelta === null
                ? 'the document is getting no rAF at all'
                : stepDelta > 0
                  ? 'the rendering step is still running, so only animation-frame callbacks are being dropped — frames the fallback draws should still reach the screen'
                  : 'the rendering step has stopped for this tab, so nothing drawn can reach the screen'
          trace.add(
            'stall',
            `frame ${this.host.frameNo()} probe ${probeDelta}/beat step ${stepDelta ?? '?'}/beat clock +${timeDelta ?? '?'}ms`,
          )
          trace.flush(true)
          console.warn(
            `rAF not delivering (frame ${this.host.frameNo()}, independent probe ${probeDelta}/beat, rendering step ${stepDelta ?? '?'}/beat, refresh clock +${timeDelta ?? '?'}ms — ${verdict}); driving via setTimeout fallback`,
          )
          // Never ticked at all, as opposed to stalled after running. Worth
          // saying separately and loudly: this is the one the user meets after
          // a reload, and the advice it wants is the opposite of "try again".
          if (!this.everRaf) {
            const run = recordFramelessStart()
            trace.add(
              'coldStall',
              `${run} frameless session${run === 1 ? '' : 's'} in a row`,
            )
            trace.flush(true)
            console.error(
              `This page has never been given an animation frame since it loaded${
                run > 1
                  ? `, and neither were the ${run - 1} before it. The fault has outlived a document, so reloading cannot clear it — open this URL in a new tab.`
                  : '. If a reload lands here again, the fault has outlived the document and only a new tab will clear it.'
              }`,
            )
          }
        }
        this.startPump()
        this.kick() // still give rAF a chance to wake on its own
      }
    } else {
      // Only the baseline is refreshed, so refocusing isn't read as a stall.
      // The stall flag deliberately survives: a recorded trace showed a visible
      // unfocused window delivering 93 rAF callbacks in a single 2s beat, so
      // losing focus is not throttling and is no reason to call a stall over.
      // Clearing it here used to stand the fallback down mid-stall the moment
      // the user clicked away — with rAF still flat at 0/beat — which is
      // exactly when the picture most needed it. rAF actually being delivered
      // is the only thing that clears a stall now, and `tick` does that.
      this.lastRafTicks = this.rafTicks
    }
    if (this.probing) return
    this.probing = true
    let settled = false
    const probeStart = performance.now()
    const strike = () => {
      if (!settled) {
        settled = true
        // Also on the rejection path, which reaches here without the deadline
        // having fired — a device that rejects the probe outright left its
        // timer armed for another HANG_MS with nothing left to say.
        clearTimeout(timer)
        this.probing = false
        // A timer that fired far past its due time proves the main thread was
        // blocked, and on Firefox the completion callback rides that same
        // thread — so the probe learned nothing about the GPU. See
        // HANG_LATE_FACTOR. Forgive the strike rather than call a healthy device
        // hung and tear the loop down under a picture that was only stuttering.
        const late = performance.now() - probeStart
        if (late > HANG_MS * HANG_LATE_FACTOR) {
          trace.add('gpuProbeLate', `${Math.round(late)}ms, not scored`)
          console.warn(
            `GPU completion probe came back ${Math.round(late)}ms late (due at ${HANG_MS}ms) — the main thread was blocked, so this says nothing about the GPU; not scoring a strike`,
          )
          return
        }
        // Only score strikes against a live loop: a probe outstanding when the
        // loop was torn down rejects on the destroyed device, which is expected
        // rather than a hang.
        if (this.live) {
          this.hangStrikes += 1
          trace.add('gpuStrike', `${this.hangStrikes}/${HANG_STRIKES}`)
          trace.flush(true)
          console.error(
            `GPU work has not completed for ~${this.hangStrikes * HANG_MS}ms (strike ${this.hangStrikes}/${HANG_STRIKES})`,
          )
          if (this.hangStrikes >= HANG_STRIKES) {
            // A full stop, not just `live = false`: the fallback pump, the
            // pending rAF and this watchdog all have to come down, and the
            // owning Engine's destroy() keys off `running` — leaving it half
            // stopped makes teardown skip the device it most needs to release.
            trace.add('hang')
            this.stop()
            this.host.onHang()
          }
        }
      }
    }
    const timer = setTimeout(strike, HANG_MS)
    try {
      void this.host.device.queue.onSubmittedWorkDone().then(() => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.probing = false
          this.hangStrikes = 0
        }
      }, strike)
    } catch {
      strike()
    }
  }
}
