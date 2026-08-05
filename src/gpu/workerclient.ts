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
import type { PumpedFrame } from './videopump'
import type { FromWorker, ToWorker } from './workerproto'

export class WorkerEngineUnavailableError extends Error {}

export interface RebuildResult {
  ok: boolean
  message: string
}

export class WorkerEngine {
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
  onFrozen: (frozen: boolean) => void = () => {}
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
    await ready
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
    this.send({ t: 'imageA', bmp: toBitmap(source), aspect })
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.pump.setB(null)
    this.send({ t: 'imageB', bmp: toBitmap(source) })
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

  destroy(opts: { keepAudio?: boolean } = {}): void {
    if (this.live) {
      this.live = false
      cancelAnimationFrame(this.rafId)
      this.pump.destroy()
      if (opts.keepAudio !== true) this.audioState.close()
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      this.worker.postMessage({ t: 'destroy' } satisfies ToWorker)
      this.worker.terminate()
    }
  }
}

const geom = (f: PumpedFrame) => ({ w: f.w, h: f.h, aspect: f.aspect })

// An OffscreenCanvas cannot be transferred as pixels, so anything that is not
// already a bitmap becomes one. `transferToImageBitmap` hands over the canvas's
// backing store rather than copying it.
const toBitmap = (src: OffscreenCanvas | ImageBitmap): ImageBitmap =>
  src instanceof ImageBitmap ? src : src.transferToImageBitmap()
