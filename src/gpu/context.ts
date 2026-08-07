import { tabStore } from './env'
import { trace } from './trace'

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

// How many WebGPU sessions a tab is worth before the browser stops giving it
// animation frames.
//
// Measured on Firefox Nightly / Linux, and it is this small: the third device
// created in one tab loads fine, reports no error, renders nothing, and
// `requestAnimationFrame` is never called for that tab again. Sometimes it is
// the second. The tab still reports `visible`, the browser stays responsive, and
// reloading lands in the same hole — only a new tab clears it.
// `scripts/rafceiling.mjs` reproduces it in about thirty seconds against a
// control page that takes 21 reloads in the same tab without dropping a frame,
// so it is WebGPU-specific and not "reloading is bad". It is a count and not a
// rate: 30 s between loads fails at the same place as 7 s.
//
// This is a browser bug and there is nothing to be done about it from here. What
// the count buys is honesty — the app can say "open a new tab" and mean it,
// instead of offering a reload that cannot work. See `docs/adr/0002`.
export const TAB_GPU_CEILING = 2

const GPU_SESSION_KEY = 'ntsc.gpuSessions'

// Devices this *tab* has created, including the one being created now. Kept in
// `sessionStorage` rather than `localStorage` because the budget belongs to the
// tab: it has to survive this tab's reloads (they each spend from it) and must
// not be shared with a second tab (which has its own, full budget).
export function gpuSessions(): number {
  const raw = tabStore()?.getItem(GPU_SESSION_KEY) ?? null
  const n = raw === null ? 0 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function recordGpuSession(): number {
  const n = gpuSessions() + 1
  try {
    tabStore()?.setItem(GPU_SESSION_KEY, String(n))
  } catch {
    // Quota, or a storage-less context. The count informs a message; it is
    // never load-bearing, so losing it costs nothing but the message.
  }
  return n
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
  // Counted here because this is the only place a device is ever made, so the
  // count cannot drift from the thing it counts. Said out loud on the way past
  // the ceiling rather than only once the picture has already stopped: by then
  // the console is the one channel still working, and the advice it can give
  // ("new tab", never "reload") is the opposite of what anyone tries first.
  const sessions = recordGpuSession()
  if (sessions > TAB_GPU_CEILING) {
    console.warn(
      `This tab has now created ${sessions} WebGPU devices. Firefox stops delivering animation frames to a tab after about ${TAB_GPU_CEILING}, and reloading does not clear it — if the picture stops, open this URL in a new tab. (scripts/rafceiling.mjs)`,
    )
  }
  trace.add('gpuSession', `${sessions} in this tab`)
  // No uncapturederror handler here: Engine registers one that also surfaces
  // the fault in the panel banner, and two listeners logged every GPU error
  // twice — which reads as two faults when hunting a wedged frame.
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Could not get webgpu canvas context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })
  return { device, context, format }
}
