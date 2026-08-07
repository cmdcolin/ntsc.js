// The page's half of a worker-owned engine: everything React talks to, backed
// by messages instead of by the engine itself.
//
// The API here is deliberately synchronous, because the React layer is. A
// slider write has to land in `getControls()` before the next render or the
// control snaps back under the user's finger, and `useSyncExternalStore` wants
// a snapshot it can read now, not a promise. So the page keeps its own copy of
// the controls and treats it as authoritative: every write starts here, so
// there is nothing to wait for. The engine's own snapshot comes back only to
// reconcile a change the page did not make — after a device-loss rebuild.
//
// Three things stay on this side because they cannot cross:
//
//   - the <video> elements, via VideoPump. What crosses is a decoded bitmap,
//     transferred, so the expensive half (the texture copy) happens over there
//     and the page only pays for the decode request.
//   - the AudioContext, because the meter reads it live every frame.
//   - the canvas element itself. It is transferred once and never again, which
//     is why a lost device is answered by rebuilding *inside* the worker rather
//     than by standing up a fresh one.

import { DEFAULT_CONTROLS } from '../controls'
import { AudioState } from '../signal/audiostate'
import { VideoPump } from './videopump'
import { transferables } from './workerproto'

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { DestroyOptions, EngineApi } from './engineapi'
import type { FrozenKind } from './renderloop'
import type { PumpedFrame } from './videopump'
import type { FromWorker, ToWorker } from './workerproto'

export class WorkerEngineUnavailableError extends Error {}

// How long the worker is given to release its GPUDevice and close itself before
// it is terminated out from under. Releasing the device is a handful of
// synchronous calls once the message is delivered; this only has to clear the
// message hop. See destroy().
const TERMINATE_GRACE_MS = 1000

export interface RebuildResult {
  ok: boolean
  message: string
}

export class WorkerEngine implements EngineApi {
  private worker: Worker
  private pump = new VideoPump()
  // The page's copy, and the one React renders from. See the note above.
  private snapshot: Controls = { ...DEFAULT_CONTROLS }
  private listeners = new Set<() => void>()
  private frame = 0
  private dbgView = 0
  private bOn = true
  private rafId = 0
  private live = true
  private nextId = 1
  // One map per reply shape rather than one of `unknown`: the acknowledgements
  // carry different payloads, and a single map means casting them back out.
  private stepWaiters = new Map<number, () => void>()
  private frameWaiters = new Map<number, (frame: number) => void>()
  private rebuildWaiter: ((r: RebuildResult) => void) | null = null

  // Built here rather than in the worker: a media element binds to one
  // AudioContext for life, and the meter reads the graph live on every frame.
  readonly audioState: AudioState

  onStats: (stats: FrameStats) => void = () => {}
  onDeviceLost: (message: string) => void = () => {}
  onHang: () => void = () => {}
  onFrozen: (frozen: FrozenKind | null) => void = () => {}
  onGpuError: (message: string) => void = () => {}

  private constructor(worker: Worker, audio: AudioState) {
    this.worker = worker
    this.audioState = audio
    worker.addEventListener('message', (ev: MessageEvent<FromWorker>) => {
      this.receive(ev.data)
    })
    this.startPump()
  }

  static async create(
    canvas: HTMLCanvasElement,
    opts: { audio?: AudioState } = {},
  ): Promise<WorkerEngine> {
    // `new URL(..., import.meta.url)` is the form the bundler recognises, so
    // the worker is emitted as its own chunk rather than inlined or missed.
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    const off = canvas.transferControlToOffscreen()
    const client = new WorkerEngine(worker, opts.audio ?? new AudioState())
    const ready = new Promise<void>((resolve, reject) => {
      client.onceReady = { resolve, reject }
    })
    client.send({ t: 'init', canvas: off, search: location.search })
    try {
      await ready
    } catch (e) {
      // The caller only ever receives a WorkerEngine on success, so anything
      // left running here can never be reached again — a whole thread and the
      // rAF pump this constructor started, alive for the life of the page. The
      // audio graph is the exception when it was handed in: the caller still
      // owns it, and a failed engine is not a reason to strand the clips bound
      // to it. Note the canvas is spent either way, since
      // transferControlToOffscreen only ever works once, so a retry needs a new
      // one.
      client.destroy({ keepAudio: opts.audio !== undefined })
      throw e
    }
    return client
  }

  private onceReady: {
    resolve: () => void
    reject: (e: Error) => void
  } | null = null

  private send(m: ToWorker): void {
    if (this.live) this.worker.postMessage(m, transferables(m))
  }

  private receive(m: FromWorker): void {
    switch (m.t) {
      case 'ready':
        this.onceReady?.resolve()
        this.onceReady = null
        break
      case 'initFailed':
        this.onceReady?.reject(new WorkerEngineUnavailableError(m.message))
        this.onceReady = null
        break
      case 'stats':
        this.onStats(m.stats)
        break
      case 'controls':
        // Reconciliation: the engine's values won, so adopt them and tell
        // React. Only a rebuild produces this — ordinary writes start here.
        this.snapshot = m.controls
        this.emit()
        break
      case 'deviceLost':
        this.onDeviceLost(m.message)
        break
      case 'hang':
        this.onHang()
        break
      case 'frozen':
        this.onFrozen(m.frozen)
        break
      case 'gpuError':
        this.onGpuError(m.message)
        break
      case 'rebuilt': {
        const w = this.rebuildWaiter
        this.rebuildWaiter = null
        w?.({ ok: m.ok, message: m.message })
        break
      }
      case 'stepped': {
        const w = this.stepWaiters.get(m.id)
        this.stepWaiters.delete(m.id)
        w?.()
        break
      }
      case 'frameNo': {
        this.frame = m.frame
        const w = this.frameWaiters.get(m.id)
        this.frameWaiters.delete(m.id)
        w?.(m.frame)
        break
      }
    }
  }

  // A main-thread frame loop that does nothing but feed the worker: decode
  // requests for video, and nothing else. It runs at display rate because that
  // is the cheapest way to notice a new video frame, but the work it does is a
  // createImageBitmap (off-thread) and a transfer — the texture copy that used
  // to dominate the main thread now happens on the other side.
  private startPump(): void {
    const sink = {
      pushA: (f: PumpedFrame) => {
        this.send({ t: 'frameA', bmp: f.bmp, geom: geom(f) })
      },
      pushB: (f: PumpedFrame) => {
        this.send({ t: 'frameB', bmp: f.bmp, geom: geom(f) })
      },
    }
    const tick = () => {
      if (this.live) {
        this.rafId = requestAnimationFrame(tick)
        this.pump.pump(sink)
      }
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // --- the surface React uses, all of it synchronous ---

  readonly subscribeControls = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  readonly getControls = (): Controls => this.snapshot

  setControl(key: ControlKey, value: number): void {
    this.snapshot = { ...this.snapshot, [key]: value }
    this.emit()
    this.send({ t: 'control', key, value })
  }

  applyControls(patch: Partial<Controls>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
    this.send({ t: 'applyControls', patch })
  }

  // Hold-to-compare pushes a look to the render path without touching the
  // snapshot, so the sliders stay where they are. Same contract here.
  preview(next: Controls | null): void {
    this.send({ t: 'preview', controls: next })
  }

  setImageSource(source: OffscreenCanvas | ImageBitmap, aspect = 4 / 3): void {
    this.pump.setA(null)
    this.send({ t: 'imageA', bmp: ownedBitmap(source), aspect })
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.pump.setB(null)
    this.send({ t: 'imageB', bmp: ownedBitmap(source) })
  }

  setVideoSource(el: HTMLVideoElement | null): void {
    if (el !== null) this.send({ t: 'noiseA', kind: 0 })
    this.pump.setA(el)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    if (el !== null) this.send({ t: 'noiseB', kind: 0 })
    this.pump.setB(el)
  }

  setNoiseSource(kind: number): void {
    this.pump.setA(null)
    this.send({ t: 'noiseA', kind })
  }

  setNoiseSourceB(kind: number): void {
    this.pump.setB(null)
    this.send({ t: 'noiseB', kind })
  }

  setSourceBEnabled(on: boolean): void {
    this.bOn = on
    this.send({ t: 'sourceBEnabled', on })
  }

  get sourceBOn(): boolean {
    return this.bOn
  }

  setModSlots(slots: ModSlot[]): void {
    this.send({ t: 'modSlots', slots })
  }

  setDbgView(view: number): void {
    this.dbgView = view
    this.send({ t: 'dbgView', view })
  }

  getDbgView(): number {
    return this.dbgView
  }

  kick(): void {
    this.send({ t: 'kick' })
  }

  // The harnesses step deterministically and then read pixels, so this has to
  // mean "the frame is on the canvas", not "the message was sent".
  async step(): Promise<void> {
    const id = this.nextId++
    const done = new Promise<void>(resolve => {
      this.stepWaiters.set(id, resolve)
    })
    this.send({ t: 'step', id })
    await done
  }

  // Cheap and synchronous, from the last value the worker reported. `syncFrame`
  // is the one that actually goes and asks.
  frameNo(): number {
    return this.frame
  }

  async syncFrame(): Promise<number> {
    const id = this.nextId++
    const got = new Promise<number>(resolve => {
      this.frameWaiters.set(id, resolve)
    })
    this.send({ t: 'frameNo', id })
    return await got
  }

  // Answer a lost device in place. The canvas cannot be transferred twice, so
  // the replacement has to be built inside the worker that already holds it.
  async rebuild(): Promise<RebuildResult> {
    const done = new Promise<RebuildResult>(resolve => {
      this.rebuildWaiter = resolve
    })
    this.send({ t: 'rebuild' })
    return await done
  }

  destroy(opts: DestroyOptions = {}): void {
    if (this.live) {
      this.live = false
      cancelAnimationFrame(this.rafId)
      this.pump.destroy()
      if (opts.keepAudio !== true) this.audioState.close()
      // The worker releases its own GPUDevice and then closes itself, because
      // terminate() discards the message queue rather than draining it: posting
      // `destroy` and terminating in the same turn means the handler that calls
      // device.destroy() very likely never runs. Leaving a device to implicit
      // teardown is the leak this project has already paid for once — an
      // abandoned GPUDevice per session is what stacks up until Firefox's WebGPU
      // wedges the tab (see Engine.destroy).
      //
      // terminate() still follows, as a backstop for a worker too wedged to
      // process the message, but on its own turn so the message gets one first.
      // A page being torn down never reaches it and does not need to: the worker
      // goes with the page.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      this.worker.postMessage({ t: 'destroy' } satisfies ToWorker)
      const worker = this.worker
      setTimeout(() => {
        worker.terminate()
      }, TERMINATE_GRACE_MS)
    }
  }
}

const geom = (f: PumpedFrame) => ({ w: f.w, h: f.h, aspect: f.aspect })

// A bitmap this side can hand over, leaving the caller's source untouched.
//
// Ownership is the whole point, and it is the one place the two engines could
// disagree while presenting the same signature. `Engine.setImageSource` copies
// into a texture and leaves the source alone (gpu/sources.ts), and useEngine
// depends on exactly that: it keeps the still in `lastSrc` so a device-loss
// rebuild can re-issue it. The obvious implementation here broke that in both
// directions — transferring the caller's ImageBitmap detaches it, and
// `transferToImageBitmap` on a canvas hands over its backing store, which
// *empties* the teletype's own canvas. Either way the rebuild would re-issue a
// source with nothing in it, and only after a lost device, with a still on the
// slot, on the worker path.
//
// Per *frame* this copy would be precisely the cost moving the engine off the
// main thread exists to avoid — which is why frames are transferred instead
// (VideoPump makes those and nothing else holds a reference). Stills change when
// someone picks a source, not sixty times a second.
const ownedBitmap = (src: OffscreenCanvas | ImageBitmap): ImageBitmap => {
  const copy = new OffscreenCanvas(src.width, src.height)
  const g = copy.getContext('2d')
  if (g === null) throw new Error('no 2d context to copy a source through')
  g.drawImage(src, 0, 0)
  return copy.transferToImageBitmap()
}
