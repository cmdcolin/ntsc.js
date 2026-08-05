import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { WorkerEngine, WorkerEngineUnavailableError } from './workerclient'

import type { FromWorker, ToWorker } from './workerproto'

// WorkerEngine is entirely message plumbing — no GPU, no canvas, no worker
// thread — so all of it is reachable from here. Until now the only thing that
// exercised it was scripts/workercheck.mjs, which needs Firefox Nightly and a
// dev server and therefore never runs in CI.

interface Posted {
  m: ToWorker
  transfer: Transferable[]
}

class StubWorker {
  static instances: StubWorker[] = []
  posted: Posted[] = []
  terminated = false
  private listeners: ((e: MessageEvent<FromWorker>) => void)[] = []

  constructor() {
    StubWorker.instances.push(this)
  }

  postMessage(m: ToWorker, transfer: Transferable[] = []): void {
    this.posted.push({ m, transfer })
  }

  addEventListener(
    _t: string,
    fn: (e: MessageEvent<FromWorker>) => void,
  ): void {
    this.listeners.push(fn)
  }

  terminate(): void {
    this.terminated = true
  }

  // What the worker would send back.
  emit(data: FromWorker): void {
    for (const fn of this.listeners) fn({ data } as MessageEvent<FromWorker>)
  }

  sent<T extends ToWorker['t']>(t: T): Extract<ToWorker, { t: T }>[] {
    return this.posted
      .map(p => p.m)
      .filter((m): m is Extract<ToWorker, { t: T }> => m.t === t)
  }
}

class StubBitmap {
  closed = false
  close(): void {
    this.closed = true
  }
}

function setup() {
  StubWorker.instances = []
  vi.stubGlobal('Worker', StubWorker)
  vi.stubGlobal('ImageBitmap', StubBitmap)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('location', { search: '?dbg=0' })
  const canvas = {
    transferControlToOffscreen: () => ({ isOffscreen: true }),
  } as unknown as HTMLCanvasElement
  const worker = () => {
    const w = StubWorker.instances.at(-1)
    if (w === undefined) throw new Error('no worker was constructed')
    return w
  }
  // The synchronous half of create() (construct, transfer the canvas, post
  // `init`) has all run by the time it first awaits, so the worker is reachable
  // here and can answer.
  const create = async (answer: FromWorker = { t: 'ready' }) => {
    const p = WorkerEngine.create(canvas)
    worker().emit(answer)
    return await p
  }
  return { canvas, worker, create }
}

const bitmap = () => new StubBitmap() as unknown as ImageBitmap

describe('WorkerEngine', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('transfers the canvas rather than cloning it', async () => {
    const h = setup()
    await h.create()
    const init = h.worker().posted[0]
    expect(init.m.t).toBe('init')
    expect(init.transfer).toHaveLength(1)
  })

  it('reads a control write back before any round trip', async () => {
    const h = setup()
    const e = await h.create()

    // The property the whole design rests on. React renders from getControls(),
    // and a slider write that is not readable in the very next render snaps the
    // control back under the user's finger — so the page's copy is authoritative
    // and a write cannot wait on the worker.
    e.setControl('noiseIre', 42)
    expect(e.getControls().noiseIre).toBe(42)
    expect(h.worker().sent('control')).toEqual([
      { t: 'control', key: 'noiseIre', value: 42 },
    ])
  })

  it('hands useSyncExternalStore a new object per write', async () => {
    const h = setup()
    const e = await h.create()
    const before = e.getControls()
    e.setControl('noiseIre', 9)
    // Mutating in place would leave React comparing a snapshot against itself
    // and never re-rendering.
    expect(e.getControls()).not.toBe(before)
    expect(before.noiseIre).toBe(DEFAULT_CONTROLS.noiseIre)
  })

  it('tells subscribers on every write, and stops when they leave', async () => {
    const h = setup()
    const e = await h.create()
    let n = 0
    const off = e.subscribeControls(() => {
      n += 1
    })
    e.setControl('noiseIre', 1)
    e.applyControls({ fbMix: 0.5 })
    expect(n).toBe(2)
    expect(e.getControls().fbMix).toBe(0.5)
    off()
    e.setControl('noiseIre', 2)
    expect(n).toBe(2)
  })

  it('adopts the engine snapshot when the engine had values the page did not', async () => {
    const h = setup()
    const e = await h.create()
    let n = 0
    e.subscribeControls(() => {
      n += 1
    })
    e.setControl('noiseIre', 3)

    // Only a device-loss rebuild produces this: the engine came back with its
    // own values and the page has to reconcile rather than insist.
    const rebuilt = { ...DEFAULT_CONTROLS, noiseIre: 17 }
    h.worker().emit({ t: 'controls', controls: rebuilt })
    expect(e.getControls().noiseIre).toBe(17)
    expect(n).toBe(2)
  })

  it('holds a preview off the snapshot the sliders read', async () => {
    const h = setup()
    const e = await h.create()
    const next = { ...DEFAULT_CONTROLS, noiseIre: 30 }
    e.preview(next)
    // Hold-to-compare pushes a look at the render path only. Touching the
    // snapshot would drag every slider to the compared look while held.
    expect(e.getControls().noiseIre).toBe(DEFAULT_CONTROLS.noiseIre)
    expect(h.worker().sent('preview')).toHaveLength(1)
  })

  it('transfers every bitmap it sends, never clones one', async () => {
    const h = setup()
    const e = await h.create()
    e.setImageSource(bitmap())
    e.setImageSourceB(bitmap())

    // The failure this guards is silent and total: a structured clone of a
    // 1440x1080 frame produces identical pixels and hands back most of the cost
    // that moving the engine off the main thread was meant to save.
    const carrying = h
      .worker()
      .posted.filter(p =>
        ['imageA', 'imageB', 'frameA', 'frameB'].includes(p.m.t),
      )
    expect(carrying).toHaveLength(2)
    for (const p of carrying) expect(p.transfer).toHaveLength(1)
  })

  it('clears a slot before putting something else on it', async () => {
    const h = setup()
    const e = await h.create()
    // A still must turn the noise generator off, or the shader keeps drawing
    // static over a texture that did land.
    e.setImageSource(bitmap())
    e.setVideoSource(null)
    expect(h.worker().sent('noiseA')).toHaveLength(0)
    e.setNoiseSource(2)
    expect(h.worker().sent('noiseA')).toEqual([{ t: 'noiseA', kind: 2 }])
  })

  it('mirrors the flags React reads back', async () => {
    const h = setup()
    const e = await h.create()
    expect(e.sourceBOn).toBe(true)
    e.setSourceBEnabled(false)
    expect(e.sourceBOn).toBe(false)
    e.setDbgView(4)
    expect(e.getDbgView()).toBe(4)
  })

  it('forwards each health report to its own callback', async () => {
    const h = setup()
    const e = await h.create()
    const seen: string[] = []
    e.onDeviceLost = m => seen.push(`lost:${m}`)
    e.onHang = () => seen.push('hang')
    e.onFrozen = f => seen.push(`frozen:${String(f)}`)
    e.onGpuError = m => seen.push(`err:${m}`)
    e.onStats = s => seen.push(`fps:${s.fps}`)

    h.worker().emit({ t: 'deviceLost', message: 'reset' })
    h.worker().emit({ t: 'hang' })
    h.worker().emit({ t: 'frozen', frozen: true })
    h.worker().emit({ t: 'gpuError', message: 'oom' })
    h.worker().emit({ t: 'stats', stats: { fps: 60 } })
    // Four failures the app answers differently — a rebuild, a fatal screen, a
    // banner that clears itself and one that does not — so they must not
    // collapse into one channel.
    expect(seen).toEqual([
      'lost:reset',
      'hang',
      'frozen:true',
      'err:oom',
      'fps:60',
    ])
  })

  it('settles each acknowledgement against the request that asked', async () => {
    const h = setup()
    const e = await h.create()
    const order: string[] = []
    const a = e.step().then(() => order.push('a'))
    const b = e.step().then(() => order.push('b'))
    const ids = h
      .worker()
      .sent('step')
      .map(m => m.id)
    expect(new Set(ids).size).toBe(2)

    // Out of order on purpose: the harnesses step deterministically, and a reply
    // resolving the wrong waiter would let one return before its frame is on the
    // canvas.
    h.worker().emit({ t: 'stepped', id: ids[1] })
    h.worker().emit({ t: 'stepped', id: ids[0] })
    await Promise.all([a, b])
    expect(order).toEqual(['b', 'a'])
  })

  it('answers frameNo from the last report, and syncFrame by asking', async () => {
    const h = setup()
    const e = await h.create()
    expect(e.frameNo()).toBe(0)
    const p = e.syncFrame()
    const id = h.worker().sent('frameNo')[0].id
    h.worker().emit({ t: 'frameNo', id, frame: 512 })
    expect(await p).toBe(512)
    expect(e.frameNo()).toBe(512)
  })

  it('rebuilds in place rather than standing up a fresh worker', async () => {
    const h = setup()
    const e = await h.create()
    const before = StubWorker.instances.length
    const p = e.rebuild()
    h.worker().emit({ t: 'rebuilt', ok: true, message: '' })
    expect(await p).toEqual({ ok: true, message: '' })
    // transferControlToOffscreen works once per canvas, so the OffscreenCanvas
    // this worker holds is the only one there will ever be.
    expect(StubWorker.instances).toHaveLength(before)
  })

  it('tears the worker down when the engine could not be built', async () => {
    const h = setup()
    await expect(
      h.create({ t: 'initFailed', message: 'no adapter' }),
    ).rejects.toBeInstanceOf(WorkerEngineUnavailableError)

    // The caller only ever receives a WorkerEngine on success, so a worker left
    // running here — and the rAF pump the constructor started — is unreachable
    // for the life of the page.
    expect(h.worker().sent('destroy')).toHaveLength(1)
  })

  it('gives the worker its device back before terminating it', async () => {
    vi.useFakeTimers()
    const h = setup()
    const e = await h.create()
    e.destroy()

    // terminate() discards the message queue rather than draining it, so doing
    // both in one turn means the handler that calls device.destroy() never runs
    // — and an abandoned GPUDevice per session is what wedges Firefox's WebGPU.
    expect(h.worker().sent('destroy')).toHaveLength(1)
    expect(h.worker().terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.worker().terminated).toBe(true)
  })

  it('says nothing more once it has been destroyed', async () => {
    const h = setup()
    const e = await h.create()
    e.destroy()
    const after = h.worker().posted.length
    e.setControl('noiseIre', 5)
    e.setImageSource(bitmap())
    expect(h.worker().posted).toHaveLength(after)
  })

  it('destroys only once', async () => {
    vi.useFakeTimers()
    const h = setup()
    const e = await h.create()
    e.destroy()
    e.destroy()
    expect(h.worker().sent('destroy')).toHaveLength(1)
  })
})
