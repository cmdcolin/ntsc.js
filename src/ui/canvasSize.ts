// How big the canvas's drawing buffer should be.
//
// Pure arithmetic, and separated from the ResizeObserver that applies it because
// every part of it guards something and none of it is obvious by inspection:
//
//   - **Never zero.** A collapsed panel or a display:none ancestor reports a
//     client size of 0, and a 0-wide drawing buffer is not a valid WebGPU
//     surface — `configure` rejects it, which surfaces as the canvas dying on a
//     layout change rather than as a size bug.
//   - **dpr capped at 2.** Past that the extra device pixels buy nothing: the
//     picture is a 754-wide face texture that the present pass upscales.
//   - **Long edge capped at MAX_EDGE.** Same reason, and this is the one that
//     matters for freezing: the compute passes are canvas-size independent, but
//     `present` is per output pixel, so a big fullscreen display piles cost onto
//     exactly the GPU that is already struggling. Measured, present costs about
//     +2 ms at 1560x1080 against a small window, and roughly +10 ms extrapolated
//     to 4K.
//   - **Aspect preserved through the cap**, so the picture does not stretch when
//     a window crosses the threshold.

// Past this the extra output pixels buy no detail and cost present time. See
// above.
export const MAX_EDGE = 2560
// Beyond 2x, device pixels are free resolution the source cannot fill.
export const MAX_DPR = 2

// css size x min(devicePixelRatio, 2) x render scale, then capped. Returns whole
// pixels, at least 1 on each edge.
export function backingStoreSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  renderScale: number,
): [number, number] {
  const dpr = Math.min(devicePixelRatio, MAX_DPR) * renderScale
  const w = Math.max(1, Math.round(cssWidth * dpr))
  const h = Math.max(1, Math.round(cssHeight * dpr))
  const clamp = Math.min(1, MAX_EDGE / Math.max(w, h))
  return [
    Math.max(1, Math.round(w * clamp)),
    Math.max(1, Math.round(h * clamp)),
  ]
}
