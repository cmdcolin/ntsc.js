import { pageSearch, tabStore } from './env'
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

// **`device.destroy()` on a device that has been presenting takes the tab's
// rendering step with it.** That is the mechanism behind the whole "a tab is worth
// about two WebGPU sessions" story, and it is not about how many devices exist.
//
// Measured on Firefox Nightly / Linux (`scripts/devicetear.mjs`, three arms, one
// tab each):
//
//   - four devices created and destroyed without ever presenting: 90 rAF/1.5s
//     throughout. Four created and *held open*, presenting: the same. So neither
//     creating devices nor holding them is what costs anything.
//   - one document, {device + swapchain + present ~50 frames + destroy} x N: dead
//     on the second round, no reload involved. Presenting then tearing down is the
//     act that does it.
//   - the same page reloaded four times in one tab, differing only in whether a
//     `pagehide` handler destroys the device: with the destroy, dead from load 2
//     onward — including "a reload lands in the same hole". Without it, four loads
//     at 83-87 rAF/1.5s and never a dropped frame.
//
// So the rule the app follows is: **never destroy a device that has presented.**
// Hand it to the successor engine where there is one (the stash below), and simply
// let go of it where there is not. The leak is real and it is the cheaper side of
// the trade — an abandoned device keeps its pipelines until the document goes,
// while a destroyed one can cost the tab every frame it had left.
//
// `?gpudestroy=1` puts the destroy back, for re-measuring this against a new
// browser build. It is the only thing that makes the app call `destroy()`.
export function gpuDestroyAllowed(search: string = pageSearch()): boolean {
  return new URLSearchParams(search).get('gpudestroy') === '1'
}

// Devices *one document* may create before the app stops trusting it. Generous,
// because creating them was measured to be cheap: this is a runaway backstop for
// an engine rebuilding itself in a loop, not the mechanism above.
//
// Per document and not per tab, which is the correction. A reload is a new
// document that has to make its own device, so a tab-scoped ceiling counted
// ordinary refreshes towards a limit — and 0004's own app run reloads one tab
// eight times at 69-81 rAF/1.5s with nothing wrong. A tab-scoped 8 would have
// refused the ninth of those healthy loads outright.
export const DOC_GPU_BUILD_LIMIT = 8

// Devices a tab may destroy: none. One destroy of a presenting device was enough
// to end the tab's rendering step, and the next document inherits the damage — so
// having done it once, the honest thing the app can say is "open a new tab".
// Reachable only under `?gpudestroy=1`.
export const TAB_GPU_RELEASE_LIMIT = 0

const GPU_SESSION_KEY = 'ntsc.gpuSessions'
const GPU_RELEASE_KEY = 'ntsc.gpuReleases'

// `?gpubudget=ignore` stops the budget being *enforced* — it is still counted and
// still reported. Two callers need it. The limits were measured on one browser on
// one OS, and a browser without the bug should not be told it is out of something
// it has plenty of; and the repro harnesses exist to drive a tab past them on
// purpose, which a gate that stopped them would stop reproducing.
export function gpuBudgetEnforced(search: string): boolean {
  return new URLSearchParams(search).get('gpubudget') !== 'ignore'
}

// Should the app decline to create another device? Asked *before* creating one,
// because that is the difference between advice and an autopsy: a compromised tab
// often still paints, so it can still show a screen with a working link on it.
//
// Two ways to get here, on two different clocks, and the first is the one that
// means something. A tab that has destroyed a presenting device is living on
// borrowed frames whatever it does next, and that damage crosses a reload, so it
// is counted per *tab*. A document that has built a lot of engines is only
// suspicious, and it is counted per *document*, because a reload leaves its
// devices behind with the document that made them.
export function outOfGpuBudget(search: string = pageSearch()): boolean {
  return (
    gpuBudgetEnforced(search) &&
    (gpuReleases() > TAB_GPU_RELEASE_LIMIT ||
      gpuBuilds() >= DOC_GPU_BUILD_LIMIT)
  )
}

// Is this tab worth warning the user about while it still paints? A softer
// question than the gate above, and the only one with a UI attached.
//
// Two ways to qualify. Having destroyed a presenting device is the one that is
// nearly certain — measured, and it outlives a reload. Having built more engines
// *in this document* than a session needs is the weaker signal that was worth
// keeping: two is a boot plus one rebuild, and past that something is replacing
// engines repeatedly, which is the shape that spends tabs.
//
// It reads `gpuBuilds()` and not `gpuSessions()`, and that is the whole fix for a
// notice that used to fire on the third *refresh*. Refreshing is not rebuilding:
// each load gets a fresh document, makes one device, and leaves it behind when the
// document goes — measured harmless eight loads deep (0004). Counting reloads
// taught the reader to dismiss the one banner that had something to say.
export function gpuAtRisk(): boolean {
  return gpuReleases() > 0 || gpuBuilds() > 2
}

// The device this tab already has, and whether it is still worth handing out.
//
// Held on `globalThis` rather than at module scope, which is the whole point: a
// Vite hot update replaces module instances, and a hot update is *also* when the
// app tears one engine down and builds another. A stash that died with its module
// would hand the replacement a fresh device — the exact spend it exists to
// prevent — and a dev session editing `src/gpu/` would go on burning the budget
// two edits at a time. Nothing but a real page load clears `globalThis`, and a
// real page load is a new document that has to make its own device anyway.
//
// `live` is false once the device is gone: destroyed by `releaseGpu`, or taken
// away by the driver. Reusing either would configure a canvas nothing can draw
// to, which is worse than spending a session.
interface HeldGpu {
  device: GPUDevice
  format: GPUTextureFormat
  live: boolean
}

declare global {
  // oxlint-disable-next-line no-var
  var ntscGpu: HeldGpu | undefined
  // Devices created by *this document*. On `globalThis` for the same reason as the
  // stash and with the same lifetime, which is exactly the lifetime being counted:
  // a hot update must not reset it (a hot update is when engines get rebuilt), and
  // a real page load must, because the devices a previous document made went away
  // with it. See `gpuBuilds` below.
  // oxlint-disable-next-line no-var
  var ntscGpuBuilds: number | undefined
}

// Let go of a device the next engine must not inherit: the caller is saying it is
// the *device* that has to go, not just the engine on top of it (a loss, a hang, a
// page unloading).
//
// "Let go of" and not "destroy". Dropping the stash entry is the whole operation
// by default — see the measurements above — because destroying a device that has
// presented is what ends the tab's rendering step, and a leaked device is undone
// by the document going away while a dead tab is undone by nothing.
export function releaseGpu(device: GPUDevice): void {
  if (globalThis.ntscGpu?.device === device) globalThis.ntscGpu = undefined
  if (gpuDestroyAllowed()) {
    // Counted, and counted here, because this is the only place it can happen: the
    // count is what lets the app say "this tab has already done the thing that
    // kills tabs" on the next load rather than guessing from symptoms.
    const n = recordGpuRelease()
    trace.add('gpuDestroy', `${n} in this tab`)
    trace.flush(true)
    console.warn(
      `Destroying a WebGPU device that has presented (?gpudestroy=1). This was measured to stop the browser painting this tab, and the damage outlives a reload — release ${n} in this tab.`,
    )
    device.destroy()
  } else {
    trace.add('gpuAbandon', `${gpuBuilds()} in this page`)
  }
}

// Point a canvas at a device. Separate from creating one because the reuse path
// needs exactly this and nothing else: the swapchain belongs to the canvas, and
// a remount brings a new canvas to the same device.
function present(canvas: RenderTarget, held: HeldGpu): Gpu {
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Could not get webgpu canvas context')
  context.configure({
    device: held.device,
    format: held.format,
    alphaMode: 'opaque',
  })
  return { device: held.device, context, format: held.format }
}

// Devices *this document* has created, including the one being created now. The
// number that says "something here keeps rebuilding its engine", and the only
// creation count anything acts on.
//
// It is deliberately not stored: a device belongs to the document that created it
// and dies with it, so the count has to die with it too. Everything the app can do
// about a rebuild loop — warn, decline, advise a new tab — is about devices that
// still exist.
export function gpuBuilds(): number {
  return globalThis.ntscGpuBuilds ?? 0
}

// Devices this *tab* has created, across every document it has loaded. Kept in
// `sessionStorage` (it has to survive this tab's reloads, and must not be shared
// with a second tab) and kept for the trace: "eleven devices over six loads" is
// worth knowing when reading back a session that ended badly.
//
// Nothing gates on it. It counts a tab's whole history, including the devices that
// were reclaimed with the documents that made them, so as a measure of present
// danger it only ever counted refreshes — see `gpuAtRisk`.
export function gpuSessions(): number {
  const raw = tabStore()?.getItem(GPU_SESSION_KEY) ?? null
  const n = raw === null ? 0 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Devices this tab has *destroyed*, which is the number that predicts a tab with
// no rendering step left. Same storage and the same lifetime as the session count,
// for the same reason: the damage belongs to the tab and survives its reloads.
export function gpuReleases(): number {
  const raw = tabStore()?.getItem(GPU_RELEASE_KEY) ?? null
  const n = raw === null ? 0 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function bump(key: string, from: number): number {
  const n = from + 1
  try {
    tabStore()?.setItem(key, String(n))
  } catch {
    // Quota, or a storage-less context. The counts inform a message and a gate
    // that fails open; losing one costs the message, never the session.
  }
  return n
}

// One device created, counted on both clocks: the document's, which is what the
// app acts on, and the tab's, which is what the trace reads back.
function recordGpuSession(): { builds: number; sessions: number } {
  const builds = gpuBuilds() + 1
  globalThis.ntscGpuBuilds = builds
  return { builds, sessions: bump(GPU_SESSION_KEY, gpuSessions()) }
}

const recordGpuRelease = (): number => bump(GPU_RELEASE_KEY, gpuReleases())

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
  // The cheapest device is the one this tab already has. An engine being replaced
  // for a reason that is not the device's fault — a hot update, a remount — hands
  // its device back alive, and the successor takes it over instead of asking for
  // another. That is the whole budget question: creating devices is what a tab
  // runs out of, so a session that only ever creates one cannot run out.
  //
  // The power preference is deliberately not re-checked. It is a property of the
  // document (`?gpu=`), so it cannot have changed under a live device, and honouring
  // a change that cannot happen would cost the thing this exists to save.
  const held = globalThis.ntscGpu
  if (held !== undefined && held.live) {
    trace.add('gpuReuse', `${gpuBuilds()} in this page`)
    return present(canvas, held)
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
  const { builds, sessions } = recordGpuSession()
  if (builds > 2) {
    // Not a death sentence any more — four devices in one document was measured to
    // cost nothing as long as none of them is destroyed — but still worth saying,
    // because repeated device creation within one document means engines are being
    // replaced, and each replacement is a chance for something to destroy one.
    // Deliberately silent about reloads, however many: this page made `builds` of
    // them, and the rest went away with the documents that made them.
    console.warn(
      `This page has now created ${builds} WebGPU devices. That is more than one session needs; each is an engine rebuild, and rebuilds are where a tab's rendering step gets spent. (scripts/devicetear.mjs)`,
    )
  }
  trace.add('gpuSession', `${builds} in this page, ${sessions} in this tab`)
  const format = navigator.gpu.getPreferredCanvasFormat()
  const stash: HeldGpu = { device, format, live: true }
  globalThis.ntscGpu = stash
  // A device the driver takes away must stop being offered to the next engine,
  // and this is the only witness that fires whether or not anything is watching
  // the engine that was using it.
  void device.lost.then(() => {
    stash.live = false
  })
  // No uncapturederror handler here: Engine registers one that also surfaces
  // the fault in the panel banner, and two listeners logged every GPU error
  // twice — which reads as two faults when hunting a wedged frame.
  return present(canvas, stash)
}
