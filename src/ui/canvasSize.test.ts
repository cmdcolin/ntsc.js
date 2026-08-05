import { describe, expect, it } from 'vitest'

import { MAX_DPR, MAX_EDGE, backingStoreSize } from './canvasSize'

describe('backingStoreSize', () => {
  it('scales css pixels by the device ratio', () => {
    expect(backingStoreSize(800, 600, 2, 1)).toEqual([1600, 1200])
  })

  it('never returns a zero edge', () => {
    // A collapsed panel or a display:none ancestor reports 0, and a 0-wide
    // drawing buffer is not a valid WebGPU surface — `configure` rejects it, so
    // this reads as the canvas dying on a layout change rather than as a size
    // bug. The ResizeObserver this feeds fires on exactly those transitions.
    for (const [w, h] of [
      [0, 0],
      [0, 600],
      [800, 0],
      [0.2, 0.2],
    ]) {
      const [bw, bh] = backingStoreSize(w, h, 2, 1)
      expect(bw).toBeGreaterThanOrEqual(1)
      expect(bh).toBeGreaterThanOrEqual(1)
    }
  })

  it('caps the device ratio, because the source cannot fill more', () => {
    // The picture is a 754-wide face texture the present pass upscales, so
    // device pixels past 2x are cost with no detail behind them.
    expect(backingStoreSize(800, 600, 4, 1)).toEqual(
      backingStoreSize(800, 600, MAX_DPR, 1),
    )
  })

  it('caps the long edge and keeps the aspect through the cap', () => {
    const [w, h] = backingStoreSize(3840, 2160, 2, 1)
    expect(Math.max(w, h)).toBe(MAX_EDGE)
    // A picture that stretched as a window crossed the threshold would be a
    // very confusing bug to attribute.
    expect(w / h).toBeCloseTo(3840 / 2160, 2)
  })

  it('caps on the tall edge for a portrait window', () => {
    const [w, h] = backingStoreSize(1080, 2400, 2, 1)
    expect(Math.max(w, h)).toBe(MAX_EDGE)
    expect(w / h).toBeCloseTo(1080 / 2400, 2)
  })

  it('lets the render scale trade resolution for frame time', () => {
    const [full] = backingStoreSize(1600, 900, 1, 1)
    const [half] = backingStoreSize(1600, 900, 1, 0.5)
    expect(half).toBe(Math.round(full / 2))
  })

  it('is stable, so a ResizeObserver does not churn the swapchain', () => {
    // Assigning canvas.width reallocates the drawing buffer and reconfigures the
    // swapchain even when the value written is the one already there. This runs
    // from a ResizeObserver, so an answer that wobbled by a pixel between two
    // identical inputs would throw away a live swapchain on every panel toggle —
    // and churning one under the compositor is the likeliest way to lose the
    // surface for good.
    const a = backingStoreSize(1352.4, 900.6, 1.5, 1)
    const b = backingStoreSize(1352.4, 900.6, 1.5, 1)
    expect(a).toEqual(b)
  })
})
