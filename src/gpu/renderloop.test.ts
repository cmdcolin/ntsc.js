import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_BUDGET_MS,
  FALLBACK_MS,
  HANG_LATE_FACTOR,
  HANG_MS,
  HANG_STRIKES,
  MAX_QUEUED_FRAMES,
  RenderLoop,
  WATCHDOG_MS,
} from './renderloop'

// The loop only does interesting work when the browser misbehaves, so the
// harness models the two misbehaviours directly: rAF callbacks are queued but
// delivered only when a test says so, and queue completion resolves only when a
// test says so. Both "never happens" cases are just declining to call them.
function harness({ noDocument = false } = {}) {
  let rafSeq = 0
  let frames = 0
  let focused = true
  let visibility = 'visible'
  const rafCbs = new Map<number, FrameRequestCallback>()
  const workDone: (() => void)[] = []
  let hangs = 0
  let recoveries = 0
  const frozenEdges: boolean[] = []

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafSeq += 1
    rafCbs.set(rafSeq, cb)
    return rafSeq
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCbs.delete(id)
  })
  // `noDocument` is the worker case: there is no document to read visibility or
  // focus from, and the loop has to run anyway rather than mistake the absence
  // for a hidden tab.
  if (!noDocument) {
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility
      },
      hasFocus: () => focused,
    })
  }
  vi.stubGlobal('window', globalThis)

  // The loop reads the clock to judge how late a timer was, which is how it
  // tells a blocked main thread from a wedged GPU. Fake timers move the clock
  // and the timers together, so a test needs a way to slip them apart: skew is
  // wall-clock time passing with no callback getting to run, which is precisely
  // what a blocked main thread looks like from inside the page.
  const realNow = performance.now.bind(performance)
  let skew = 0
  vi.stubGlobal('performance', { now: () => realNow() + skew })

  const loop = new RenderLoop({
    device: {
      queue: {
        onSubmittedWorkDone: () =>
          new Promise<undefined>(resolve => {
            workDone.push(() => {
              resolve(undefined)
            })
          }),
      },
    },
    render: () => {
      frames += 1
    },
    onStats: () => {},
    onHang: () => {
      hangs += 1
    },
    recover: () => {
      recoveries += 1
    },
    onFrozen: f => {
      frozenEdges.push(f)
    },
    frameNo: () => frames,
  })

  return {
    loop,
    hangs: () => hangs,
    frames: () => frames,
    recoveries: () => recoveries,
    frozenEdges: () => frozenEdges,
    // rAF callbacks the loop currently has in flight, across both its chains.
    outstanding: () => rafCbs.size,
    // Deliver every rAF callback the loop has outstanding.
    deliverRaf: (time: number) => {
      const cbs = [...rafCbs.values()]
      rafCbs.clear()
      for (const cb of cbs) cb(time)
    },
    // Complete every GPU submission the loop is waiting on.
    completeGpu: () => {
      const pending = workDone.splice(0)
      for (const done of pending) done()
    },
    setFocused: (v: boolean) => {
      focused = v
    },
    setVisibility: (v: string) => {
      visibility = v
    },
    // Advance wall-clock time without letting any callback run.
    blockMainThread: (ms: number) => {
      skew += ms
    },
  }
}

describe('RenderLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('drives frames from the fallback once rAF stops being delivered', async () => {
    const h = harness()
    h.loop.start()
    expect(h.frames()).toBe(0)
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)
  })

  it('waits for the submitted frame before pumping the next one', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    // The GPU never reports completion, so the fallback must submit nothing
    // further no matter how many fallback intervals elapse. Without this
    // backpressure the loop buries a struggling device and hangs the tab.
    await vi.advanceTimersByTimeAsync(FALLBACK_MS * 30)
    expect(h.frames()).toBe(1)

    h.completeGpu()
    await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    expect(h.frames()).toBe(2)
  })

  it('leaves the fallback on the first delivered rAF, not the next watchdog', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    h.deliverRaf(100)
    expect(h.frames()).toBe(2)

    // Both drivers were live for an instant; only rAF may survive it. Any
    // further frame here is the fallback still running alongside rAF.
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(2)
  })

  it('gives up on the fallback once the bridge budget is spent', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    // Keep the GPU answering so the pump is free to run flat out; only the
    // budget may stop it. A stall this long means nothing is compositing, and
    // every further frame is invisible work piled on a stuck swapchain.
    for (let t = 0; t < FALLBACK_BUDGET_MS; t += FALLBACK_MS) {
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    }
    const spent = h.frames()
    expect(spent).toBeGreaterThan(1)

    h.completeGpu()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3)
    expect(h.frames()).toBe(spent)
  })

  it('bridges again on a later stall rather than staying given up', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    for (let t = 0; t < FALLBACK_BUDGET_MS; t += FALLBACK_MS) {
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    }
    const spent = h.frames()

    // rAF comes back, so the next stall is a fresh episode and gets its own
    // bridge — a spent budget must not disable the fallback for the session.
    h.deliverRaf(1000)
    expect(h.frames()).toBe(spent + 1)
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2)
    expect(h.frames()).toBeGreaterThan(spent + 1)
  })

  it('stops pumping while the tab is hidden', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    h.setVisibility('hidden')
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2)
    expect(h.frames()).toBe(1)
  })

  it('does not declare a stall against an unfocused window', async () => {
    const h = harness()
    h.setFocused(false)
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2)
    expect(h.frames()).toBe(0)
  })

  it('keeps bridging a stall when the window loses focus mid-stall', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    // A visible unfocused window is not throttled — a trace caught one running
    // 93 rAF callbacks in a 2s beat — so clicking away mid-stall must not stand
    // the fallback down while rAF is still flat. Let a whole watchdog tick land
    // while unfocused, which is where the stall used to be cleared, and only
    // then release the frame the pump is waiting on.
    h.setFocused(false)
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    const before = h.frames()

    h.completeGpu()
    await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    expect(h.frames()).toBeGreaterThan(before)
  })

  it('tries to rebuild the surface once when it gives up', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.recoveries()).toBe(0)

    for (let t = 0; t < FALLBACK_BUDGET_MS; t += FALLBACK_MS) {
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    }
    expect(h.recoveries()).toBe(1)

    // Once per stall. Reconfiguring a stuck surface over and over is the
    // hammering the budget exists to stop.
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3)
    expect(h.recoveries()).toBe(1)
  })

  it('keeps the liveness probe on its own chain', async () => {
    const h = harness()
    h.loop.start()
    // One render chain plus one probe chain.
    expect(h.outstanding()).toBe(2)

    // A burst of kicks — what eight visibility flips produce — only ever adds
    // chains, never cancels, so the loop cannot be left with none outstanding.
    h.loop.kick()
    h.loop.kick()
    expect(h.outstanding()).toBe(4)

    // ...and the superseded ones retire themselves on their next callback, so
    // it converges straight back to one render chain plus one probe rather than
    // driving the frame several times over.
    h.deliverRaf(16)
    expect(h.outstanding()).toBe(2)
    expect(h.frames()).toBe(1)

    // A restart must not leave the old chains running alongside the new ones:
    // a doubled probe would report twice the true rate and hide a dying
    // document, and a doubled render chain double-submits every frame.
    h.loop.stop()
    h.loop.start()
    h.deliverRaf(32)
    expect(h.outstanding()).toBe(2)
    h.deliverRaf(48)
    expect(h.outstanding()).toBe(2)
    expect(h.frames()).toBe(3)
  })

  it('reports one frozen edge per stall episode', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    // A stall alone is not frozen: the fallback is bridging it, and the picture
    // is live. Only spending the budget is worth telling the user about.
    expect(h.frozenEdges()).toEqual([])

    for (let t = 0; t < FALLBACK_BUDGET_MS; t += FALLBACK_MS) {
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(FALLBACK_MS)
    }
    expect(h.frozenEdges()).toEqual([true])

    // The watchdog keeps re-arming rAF for the whole give-up, so it must not
    // re-announce a freeze the host is already showing.
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3)
    expect(h.frozenEdges()).toEqual([true])

    // rAF coming back is the only thing that clears it, and it must clear on
    // the delivered callback rather than waiting for the next watchdog.
    h.deliverRaf(1000)
    expect(h.frozenEdges()).toEqual([true, false])
  })

  it('re-enters the fallback after a restart', async () => {
    const h = harness()
    h.loop.start()
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(1)

    h.loop.stop()
    h.completeGpu()
    h.loop.start()

    // A stall flag carried across the restart would leave the watchdog thinking
    // the fallback was already running, and nothing would drive the picture.
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS)
    expect(h.frames()).toBe(2)
  })

  it('fully stops the loop when the GPU stops completing work', async () => {
    const h = harness()
    h.loop.start()
    // Keep rAF healthy so this exercises the hang probe alone. Each strike
    // needs a watchdog tick to start the next probe, and whether that tick wins
    // a tie with the expiring one is timer-ordering detail, so allow slack
    // rather than pin the exact landing.
    const window = (HANG_MS + WATCHDOG_MS * 2) * HANG_STRIKES
    for (let t = 0; t < window; t += 500) {
      h.deliverRaf(t)
      await vi.advanceTimersByTimeAsync(500)
    }

    expect(h.hangs()).toBe(1)
    expect(h.loop.running).toBe(false)

    // Nothing may keep submitting to a device already judged hung — and the
    // owner's teardown keys off `running`, so it has to be a real stop.
    const seen = h.frames()
    h.deliverRaf(99999)
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3)
    expect(h.frames()).toBe(seen)
  })

  it('stops running ahead of a device that is not keeping up', async () => {
    const h = harness()
    h.loop.start()

    // rAF keeps arriving and the device confirms nothing. rAF paces submission
    // to the display, not to the GPU, so without a cap this renders a frame per
    // callback forever and the queue grows without bound — the slow, quiet path
    // to a wedged tab.
    for (let i = 0; i < MAX_QUEUED_FRAMES * 4; i++) h.deliverRaf(i * 16)
    expect(h.frames()).toBe(MAX_QUEUED_FRAMES)

    // ...and it picks straight back up when the device catches up, rather than
    // latching off.
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(0)
    h.deliverRaf(99999)
    expect(h.frames()).toBe(MAX_QUEUED_FRAMES + 1)
  })

  it('never throttles a device that is keeping up', async () => {
    const h = harness()
    h.loop.start()

    // A healthy session must not lose a single frame to the cap. This is the
    // case the cap has to clear by a wide margin: Firefox resolves completion
    // from a 100ms poll, so even a device finishing instantly looks several
    // frames behind at 60Hz.
    const n = MAX_QUEUED_FRAMES * 5
    for (let i = 0; i < n; i++) {
      h.deliverRaf(i * 16)
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(h.frames()).toBe(n)
  })

  it('clears a backlog built while rAF was gone', async () => {
    const h = harness()
    h.loop.start()
    for (let i = 0; i < MAX_QUEUED_FRAMES * 2; i++) h.deliverRaf(i * 16)
    expect(h.frames()).toBe(MAX_QUEUED_FRAMES)

    // The gate stops submitting once it is capped, so nothing it does can start
    // the probe that would clear it. Only the probe re-arming itself gets the
    // loop out of this — otherwise a single backlog gates the picture off for
    // the rest of the session.
    h.completeGpu()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < MAX_QUEUED_FRAMES; i++) {
      h.deliverRaf(2000 + i * 16)
      h.completeGpu()
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(h.frames()).toBe(MAX_QUEUED_FRAMES * 2)
  })

  it('keeps driving frames where there is no document at all', async () => {
    // A worker owns no document. Everything the watchdog reads about one
    // describes the page's refresh driver, which is the very dependency a
    // worker-owned loop exists to shed — so their absence must read as "run",
    // not as a hidden tab, or the loop stands down in the one context that was
    // meant to keep the picture alive.
    const h = harness({ noDocument: true })
    h.loop.start()
    h.deliverRaf(16)
    expect(h.frames()).toBe(1)

    // ...including the stall path, which is gated on visibility and focus. Two
    // beats, not one: the first still sees the tick from the frame above and is
    // right not to call a stall on it.
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2)
    expect(h.frames()).toBeGreaterThan(1)
  })

  it('does not call a blocked main thread a hung GPU', async () => {
    const h = harness()
    h.loop.start()

    // Enough late probes to hang the loop, if lateness counted. On Firefox the
    // completion callback rides the main thread, so a blocked one leaves the
    // probe unresolved no matter how healthy the device is — measured at 6001ms
    // with nothing submitted and an idle GPU. The strike timer is on that same
    // thread and comes back just as late, and that lateness is the evidence
    // that the probe learned nothing about the GPU.
    for (let i = 0; i < HANG_STRIKES; i++) {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS) // opens a probe
      h.blockMainThread(HANG_MS * HANG_LATE_FACTOR + 1000)
      await vi.advanceTimersByTimeAsync(HANG_MS) // its deadline expires
    }
    expect(h.hangs()).toBe(0)

    // ...and a device that really is wedged is still caught once the main
    // thread is back, or forgiving lateness would disable hang detection
    // outright rather than make it honest.
    for (let t = 0; t < (HANG_MS + WATCHDOG_MS * 2) * HANG_STRIKES; t += 500) {
      h.deliverRaf(t)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(h.hangs()).toBe(1)
  })
})
