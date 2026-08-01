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
  private rafId = 0
  private renderErrors = 0
  private watchdogId = 0
  private hangStrikes = 0
  private probing = false
  private rafTicks = 0
  private lastRafTicks = 0
  private stalled = false
  private fallbackId = 0
  private pumping = false
  // When the current stall began, and whether the fallback has already spent its
  // budget on it. Both reset when rAF comes back, so a later stall gets a fresh
  // bridge rather than inheriting a spent one.
  private stallSince = 0
  private gaveUp = false

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
    this.gaveUp = false
    this.probing = false
    this.rafTicks = 0
    this.lastRafTicks = 0
    this.lastTime = 0
    this.frameAcc = 0
    this.frameCount = 0
    this.hangStrikes = 0
    trace.add('start')
    this.rafId = requestAnimationFrame(this.tick)
    this.watchdogId = window.setInterval(this.watchdog, WATCHDOG_MS)
  }

  stop(): void {
    trace.add('stop', `frame ${this.host.frameNo()}`)
    trace.flush(true)
    this.live = false
    this.stalled = false
    this.pumping = false
    cancelAnimationFrame(this.rafId)
    clearInterval(this.watchdogId)
    clearTimeout(this.fallbackId)
    this.fallbackId = 0
  }

  private tick = (time: number): void => {
    if (this.live) {
      // Re-arm the next frame FIRST, before any work. A synchronous throw below
      // (e.g. getCurrentTexture during a fullscreen/visibility transition, or a
      // React setState in onStats) then can't leave the loop un-scheduled — the
      // classic "canvas froze, controls look dead" hang after exiting fullscreen.
      this.rafId = requestAnimationFrame(this.tick)
      this.rafTicks += 1 // proof rAF is actually being delivered (watchdog reads it)
      if (this.stalled) {
        // Leave the fallback the instant rAF returns rather than waiting for the
        // watchdog to notice, otherwise both drivers run frames for up to
        // WATCHDOG_MS and double the submission rate on a device that just
        // demonstrated it was struggling.
        this.stalled = false
        this.gaveUp = false
        trace.add('resume', `frame ${this.host.frameNo()}`)
        console.warn(
          `rAF resumed at frame ${this.host.frameNo()}; leaving fallback`,
        )
      }
      this.runFrame(time)
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

  // True while the stall is still young enough to be worth rendering into.
  // Latches `gaveUp` on the way past, so the watchdog stops restarting the pump
  // for this stall and the picture is simply left frozen until rAF returns.
  private bridging(): boolean {
    const within = performance.now() - this.stallSince < FALLBACK_BUDGET_MS
    if (!within && !this.gaveUp) {
      this.gaveUp = true
      trace.add('fallbackGaveUp', `frame ${this.host.frameNo()}`)
      trace.flush(true)
      console.warn(
        `rAF still not delivering after ${FALLBACK_BUDGET_MS}ms; stopping the fallback rather than submitting frames nothing is compositing`,
      )
    }
    return within
  }

  private pump = (): void => {
    this.fallbackId = 0
    if (
      this.live &&
      this.stalled &&
      this.bridging() &&
      document.visibilityState === 'visible'
    ) {
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
      this.fallbackId = window.setTimeout(this.pump, FALLBACK_MS)
    } else {
      this.pumping = false
    }
  }

  // Re-arm the loop after a transition (fullscreen exit, tab re-shown) that can
  // leave the browser having stopped delivering rAF callbacks. Idempotent: it
  // cancels any pending frame first, so calling it when the loop is healthy is a
  // no-op rather than a double-schedule.
  kick(): void {
    if (this.live) {
      cancelAnimationFrame(this.rafId)
      this.rafId = requestAnimationFrame(this.tick)
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
    trace.beat(
      [
        document.visibilityState,
        document.hasFocus() ? 'focused' : 'unfocused',
        document.fullscreenElement === null ? 'windowed' : 'fullscreen',
        this.stalled ? (this.gaveUp ? 'GAVE-UP' : 'STALLED') : 'ok',
      ].join(' '),
      `frame ${this.host.frameNo()} raf ${this.rafTicks - this.lastRafTicks}/beat`,
    )
    trace.flush()
    if (!this.live || document.visibilityState !== 'visible') return
    // The watchdog firing at all proves the main thread is alive. rAF throttling
    // while the window is unfocused/occluded is expected, so only judge rAF
    // liveness when focused: if rafTicks hasn't advanced since the last check,
    // the browser has stopped delivering rAF even though we're visible+focused
    // (Firefox/Linux does this across fullscreen transitions, and re-requesting
    // doesn't wake it). Drive the loop from setTimeout until rAF resumes.
    if (document.hasFocus()) {
      const rafAlive = this.rafTicks !== this.lastRafTicks
      this.lastRafTicks = this.rafTicks
      if (!rafAlive) {
        if (!this.stalled) {
          this.stalled = true
          this.stallSince = performance.now()
          this.gaveUp = false
          trace.add('stall', `frame ${this.host.frameNo()}`)
          trace.flush(true)
          console.warn(
            `rAF not delivering (frame ${this.host.frameNo()}); driving via setTimeout fallback`,
          )
        }
        this.startPump()
        this.kick() // still give rAF a chance to wake on its own
      }
    } else {
      this.lastRafTicks = this.rafTicks // keep baseline fresh so refocus isn't a false stall
      this.stalled = false // unfocused throttling is expected; let the fallback stop
    }
    if (this.probing) return
    this.probing = true
    let settled = false
    const strike = () => {
      if (!settled) {
        settled = true
        this.probing = false
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
