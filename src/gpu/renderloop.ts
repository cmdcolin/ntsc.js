import { isFocused, isFullscreen, isVisible } from './env'
import { trace } from './trace'

import type { FrameStats } from '../controls'

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

// How many submitted-but-unconfirmed frames the rAF path may run ahead by.
//
// rAF is not backpressure. It paces *submission* to the display, not to the
// device: if a frame costs more GPU time than a refresh interval, every callback
// adds more work than the GPU retires and the queue grows without bound. That is
// slow and quiet — at ~21 ms a frame against a 16.7 ms budget it accumulates
// only ~4 ms per frame — which is exactly why it reads as "it freezes after a
// while" rather than as a frame-rate problem. Measured: 120 frames submit in
// 27 ms of JS and take 1121 ms of GPU to drain.
//
// The cap has to clear Firefox's completion latency or it would throttle a
// healthy session. Firefox polls wgpu from a 100 ms timer (bug 1870699), so
// onSubmittedWorkDone resolves in ~100 ms even on an idle queue — about six
// frames' worth at 60 Hz. Twelve leaves 2x headroom over that floor while still
// bounding the backlog at a fifth of a second instead of unbounded.
export const MAX_QUEUED_FRAMES = 12

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
  // Frames handed to the device, and how many of those the device has confirmed
  // finished. The difference is the backlog the rAF path is allowed to build.
  // Monotonic rather than a live count because onSubmittedWorkDone resolves for
  // *everything submitted before it was called*, so the only thing a resolution
  // proves is a high-water mark.
  private submitted = 0
  private confirmed = 0
  private drainProbe = false
  private throttled = false

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
    this.probeTicks = 0
    this.lastProbeTicks = 0
    this.lastTime = 0
    this.frameAcc = 0
    this.frameCount = 0
    this.hangStrikes = 0
    this.submitted = 0
    this.confirmed = 0
    this.drainProbe = false
    this.throttled = false
    trace.add('start')
    this.startRender()
    this.startProbe()
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
    clearInterval(this.watchdogId)
    clearTimeout(this.fallbackId)
    this.fallbackId = 0
  }

  private startRender(): void {
    this.startChain('render', time => {
      this.rafTicks += 1 // proof rAF is being delivered (watchdog reads it)
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
      if (this.backlog() >= MAX_QUEUED_FRAMES) {
        this.setThrottled(true)
        this.startDrainProbe()
        return
      }
      this.setThrottled(false)
      this.runFrame(time)
    })
  }

  // Submitted-but-unconfirmed frames. See MAX_QUEUED_FRAMES.
  private backlog(): number {
    return this.submitted - this.confirmed
  }

  private noteSubmission(): void {
    this.submitted += 1
    this.startDrainProbe()
  }

  // One completion probe outstanding at a time, re-armed while a backlog
  // remains. Re-arming matters more than it looks: once the loop is throttling
  // it stops submitting, so if the probe that would clear the backlog were only
  // started by a submission the loop would gate itself off permanently.
  private startDrainProbe(): void {
    if (!this.drainProbe && this.backlog() > 0) {
      this.drainProbe = true
      const mark = this.submitted
      const settle = () => {
        this.drainProbe = false
        // max(), never assignment: probes can settle out of order, and a stale
        // one must not walk the high-water mark backwards into a phantom
        // backlog that throttles a healthy loop.
        this.confirmed = Math.max(this.confirmed, mark)
        this.startDrainProbe()
      }
      try {
        void this.host.device.queue.onSubmittedWorkDone().then(settle, settle)
      } catch {
        // A device too broken to take the probe is the hang watchdog's business,
        // not this gate's; leaving the backlog uncleared would only stop the
        // picture on top of it.
        this.drainProbe = false
        this.confirmed = mark
      }
    }
  }

  private setThrottled(v: boolean): void {
    if (this.throttled !== v) {
      this.throttled = v
      if (v) {
        trace.add(
          'throttle',
          `frame ${this.host.frameNo()} backlog ${this.backlog()}`,
        )
        trace.flush(true)
        console.warn(
          `GPU is ${this.backlog()} frames behind; dropping frames until it catches up (the signal path is costing more than a refresh interval)`,
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
    // in the same accounting. The pump's own gate keeps it a frame deep at most,
    // but if rAF resumes mid-stall the backlog it inherits has to be real.
    // A frame whose render threw is still counted: the probe that clears it does
    // not care whether anything reached the queue, and guessing wrong in the
    // other direction would gate the loop off permanently.
    this.noteSubmission()
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
    trace.beat(
      [
        isVisible() ? 'visible' : 'hidden',
        isFocused() ? 'focused' : 'unfocused',
        isFullscreen() ? 'fullscreen' : 'windowed',
        this.stalled ? (this.gaveUp ? 'GAVE-UP' : 'STALLED') : 'ok',
      ].join(' '),
      `frame ${this.host.frameNo()} raf ${this.rafTicks - this.lastRafTicks}/beat probe ${probeDelta}/beat`,
    )
    trace.flush()
    if (!this.live || !isVisible()) return
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
          // The probe delta is the diagnosis, and the two readings want
          // opposite fixes.
          const verdict =
            probeDelta === 0
              ? 'the document is getting no rAF at all'
              : 'the document IS ticking, so the render chain was dropped on our side'
          trace.add(
            'stall',
            `frame ${this.host.frameNo()} probe ${probeDelta}/beat`,
          )
          trace.flush(true)
          console.warn(
            `rAF not delivering (frame ${this.host.frameNo()}, independent probe ${probeDelta}/beat — ${verdict}); driving via setTimeout fallback`,
          )
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
      clearTimeout(timer)
      strike()
    }
  }
}
