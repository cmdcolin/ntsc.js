export interface Gpu {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

export class WebGpuUnavailableError extends Error {}

// Either kind of canvas. An OffscreenCanvas is what a worker-owned engine
// presents to; on the main thread this is always an HTMLCanvasElement.
export type RenderTarget = HTMLCanvasElement | OffscreenCanvas

export type GpuPower = 'high-performance' | 'low-power'

// `?gpu=low-power` sends the session to the integrated chip. Two reasons to
// want that, and neither is a preference about frame rate:
//
//   - Battery. Firefox pins a GPU awake for as long as a device is open on it,
//     so a discrete card that would otherwise autosuspend after a few seconds
//     idle stays powered for the whole session. The integrated chip is on
//     regardless, because it drives the panel.
//
//     Held against a specific doubt and survived, which is why it is stated this
//     strongly. The doubt was that what pins the card is *submission* rather
//     than an open device — in which case a hidden tab, which submits nothing,
//     would let the card suspend underneath a live GPUDevice and hand back a
//     stale one on return. `scripts/gpusleep.mjs` reads
//     /sys/class/drm/card2/device/power/runtime_status while driving the tab in
//     and out of the foreground, and the card does not suspend: not across a
//     genuinely hidden tab (`visibilityState` sampled throughout, ~11 frames in
//     three minutes), and not on any of the returns. The control in the same run
//     is what makes it evidence rather than an absence — close the page, leaving
//     the browser up, and the card suspends within seconds of the device going.
//     So it is the device that holds it, and `?gpu=low-power` does not buy any
//     protection from a power cycle, because there is no power cycle to be had.
//   - Bisecting a fault. "Does it still do it on the other GPU" is the first
//     question worth asking about a driver-shaped bug, and it should not need
//     a rebuild to answer.
//
// Anything else, including a missing param, means the discrete card.
export function gpuPowerFromSearch(search: string): GpuPower {
  return new URLSearchParams(search).get('gpu') === 'low-power'
    ? 'low-power'
    : 'high-performance'
}

export async function initGpu(
  canvas: RenderTarget,
  power: GpuPower = 'high-performance',
): Promise<Gpu> {
  // the types say navigator.gpu always exists; browsers without WebGPU disagree
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (!navigator.gpu) {
    throw new WebGpuUnavailableError(
      'This browser has no WebGPU support. Try a recent Chrome, Edge, or Firefox.',
    )
  }
  // Ask for the discrete GPU. On a single-GPU machine this changes nothing; on a
  // hybrid laptop the default adapter is the integrated one that drives the
  // display, and the signal path is heavy enough that the difference decides
  // whether frames fit in the budget at all. Measured on a Precision 7540
  // (UHD 630 + Radeon Pro WX 3200) with a signal-path-shaped compute benchmark:
  // 400 ms on the default adapter, 101 ms on this one — and the 101 is against a
  // 100 ms measurement floor (see renderloop.ts on Firefox's polling), so the
  // real gap is wider. Presenting a swapchain from the discrete adapter works on
  // that PRIME setup; if a machine can't, requestAdapter falls back on its own.
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: power,
  })
  if (!adapter) {
    throw new WebGpuUnavailableError(
      'WebGPU is present but no GPU adapter is available — usually a blocklisted GPU/driver or hardware acceleration disabled. In Firefox try gfx.webgpu.ignore-blocklist; in Chrome enable hardware acceleration.',
    )
  }
  const device = await adapter.requestDevice()
  // No uncapturederror handler here: Engine registers one that also surfaces
  // the fault in the panel banner, and two listeners logged every GPU error
  // twice — which reads as two faults when hunting a wedged frame.
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Could not get webgpu canvas context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })
  return { device, context, format }
}
