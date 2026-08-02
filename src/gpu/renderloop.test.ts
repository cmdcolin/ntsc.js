import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_BUDGET_MS,
  FALLBACK_MS,
  HANG_MS,
  HANG_STRIKES,
  RenderLoop,
  WATCHDOG_MS,
} from './renderloop'

// The loop only does interesting work when the browser misbehaves, so the
// harness models the two misbehaviours directly: rAF callbacks are queued but
// delivered only when a test says so, and queue completion resolves only when a
// test says so. Both "never happens" cases are just declining to call them.
function harness() {
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
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility
    },
    hasFocus: () => focused,
  })
  vi.stubGlobal('window', globalThis)

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
    // One render chain plus one probe chain. kick() cancels and re-requests the
    // render chain and may only ever touch that one — a probe this class can
    // break diagnoses nothing.
    expect(h.outstanding()).toBe(2)
    h.loop.kick()
    h.loop.kick()
    expect(h.outstanding()).toBe(2)

    // A restart must not leave the old probe counting alongside the new one:
    // two chains would report double the true rate and hide a dying document.
    h.loop.stop()
    h.loop.start()
    h.deliverRaf(16)
    expect(h.outstanding()).toBe(2)
    h.deliverRaf(32)
    expect(h.outstanding()).toBe(2)
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
})
