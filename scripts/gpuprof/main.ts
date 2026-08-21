// Headless per-pass GPU profiler for the signal path.
//
//   pnpm gpuprof                       stock controls, 120 frames
//   pnpm gpuprof --preset=vhsEp        a built-in preset
//   pnpm gpuprof --set=crtSpot=2,dubGens=3
//   pnpm gpuprof --ablate=crtFace      skip a pass: the ablation upper bound
//   pnpm gpuprof --dump=out/stock      write compA and the decoded frame
//
// Deno's WebGPU is wgpu, the same implementation Firefox Nightly's WebGPU is
// built on, and it exposes timestamp-query where the browser does not — so a
// pass is timed on the GPU, on the same card, with no window to steal and no
// rAF to pace. Read best-of and median both: another GPU client on the box
// lands on the median, not the best (docs/OPTIMIZATIONS.md).

import { DEFAULT_CONTROLS } from '../../src/core/controls'
import {
  ACTIVE_HEIGHT,
  ACTIVE_WIDTH,
  LINES,
  SAMPLES_PER_LINE,
} from '../../src/core/signal/constants'
import { Graph } from './graph'

import type { ControlKey, Controls } from '../../src/core/controls'

function arg(name: string): string | undefined {
  const p = Deno.args.find(a => a.startsWith(`--${name}=`))
  return p?.slice(name.length + 3)
}
const flag = (name: string): boolean => Deno.args.includes(`--${name}`)

// Loaded by URL rather than imported: presets live in the UI layer, whose
// type graph reaches React and Web MIDI, which `deno check` would then follow.
interface PresetsModule {
  PRESETS: { name: string; patch: Partial<Controls> }[]
  presetControls: (patch: Partial<Controls>) => Controls
}

async function controlsFromArgs(): Promise<Controls> {
  let c: Controls = { ...DEFAULT_CONTROLS }
  const preset = arg('preset')
  if (preset !== undefined) {
    const mod = (await import(
      new URL('../../src/ui/presets.ts', import.meta.url).href
    )) as PresetsModule
    const p = mod.PRESETS.find(q => q.name === preset)
    if (p === undefined) throw new Error(`no preset ${preset}`)
    c = mod.presetControls(p.patch)
  }
  const set = arg('set')
  if (set !== undefined) {
    for (const kv of set.split(',')) {
      const [k, v] = kv.split('=')
      if (!(k in DEFAULT_CONTROLS)) throw new Error(`no control ${k}`)
      c[k as ControlKey] = Number(v)
    }
  }
  return c
}

// SMPTE bars for A, a gradient with a disc for B: enough picture for every
// path to have edges, colour and a highlight to work on.
function barsA(): Uint8Array<ArrayBuffer> {
  const px = new Uint8Array(ACTIVE_WIDTH * ACTIVE_HEIGHT * 4)
  const bars = [
    [191, 191, 191],
    [191, 191, 0],
    [0, 191, 191],
    [0, 191, 0],
    [191, 0, 191],
    [191, 0, 0],
    [0, 0, 191],
  ]
  for (let y = 0; y < ACTIVE_HEIGHT; y++) {
    for (let x = 0; x < ACTIVE_WIDTH; x++) {
      const i = (y * ACTIVE_WIDTH + x) * 4
      const t = y / ACTIVE_HEIGHT
      const b = Math.floor((x / ACTIVE_WIDTH) * 7)
      let rgb: number[]
      if (t < 0.67) rgb = bars[b]
      else if (t < 0.75) rgb = b % 2 === 0 ? bars[6 - b] : [19, 19, 19]
      else {
        const k = Math.floor((x / ACTIVE_WIDTH) * 6)
        rgb =
          k === 0
            ? [0, 33, 76]
            : k === 1
              ? [255, 255, 255]
              : k === 2
                ? [50, 0, 106]
                : k === 4
                  ? [26, 26, 26]
                  : [19, 19, 19]
      }
      px[i] = rgb[0]
      px[i + 1] = rgb[1]
      px[i + 2] = rgb[2]
      px[i + 3] = 255
    }
  }
  return px
}

function gradientB(): Uint8Array<ArrayBuffer> {
  const px = new Uint8Array(ACTIVE_WIDTH * ACTIVE_HEIGHT * 4)
  for (let y = 0; y < ACTIVE_HEIGHT; y++) {
    for (let x = 0; x < ACTIVE_WIDTH; x++) {
      const i = (y * ACTIVE_WIDTH + x) * 4
      const dx = x - ACTIVE_WIDTH * 0.5
      const dy = y - ACTIVE_HEIGHT * 0.5
      const disc = dx * dx + dy * dy < 120 * 120
      px[i] = disc ? 240 : (x / ACTIVE_WIDTH) * 255
      px[i + 1] = disc ? 240 : (y / ACTIVE_HEIGHT) * 255
      px[i + 2] = disc ? 200 : 128
      px[i + 3] = 255
    }
  }
  return px
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

async function dump(g: Graph, path: string): Promise<void> {
  const d = g.device
  const n = SAMPLES_PER_LINE * LINES
  const bytesPerRow = Math.ceil((ACTIVE_WIDTH * 4) / 256) * 256
  const compRead = d.createBuffer({
    size: n * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const texRead = d.createBuffer({
    size: bytesPerRow * ACTIVE_HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const faceRead = d.createBuffer({
    size: bytesPerRow * ACTIVE_HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const enc = d.createCommandEncoder()
  enc.copyBufferToBuffer(g.compA, 0, compRead, 0, n * 4)
  enc.copyTextureToBuffer(
    { texture: g.outTex },
    { buffer: texRead, bytesPerRow },
    [ACTIVE_WIDTH, ACTIVE_HEIGHT],
  )
  enc.copyTextureToBuffer(
    { texture: g.faceTex },
    { buffer: faceRead, bytesPerRow },
    [ACTIVE_WIDTH, ACTIVE_HEIGHT],
  )
  d.queue.submit([enc.finish()])
  await compRead.mapAsync(GPUMapMode.READ)
  await texRead.mapAsync(GPUMapMode.READ)
  await faceRead.mapAsync(GPUMapMode.READ)
  await Deno.writeFile(
    `${path}.comp.f32`,
    new Uint8Array(compRead.getMappedRange()),
  )
  const unpad = (rows: Uint8Array): Uint8Array => {
    const out = new Uint8Array(ACTIVE_WIDTH * ACTIVE_HEIGHT * 4)
    for (let y = 0; y < ACTIVE_HEIGHT; y++)
      out.set(
        rows.subarray(y * bytesPerRow, y * bytesPerRow + ACTIVE_WIDTH * 4),
        y * ACTIVE_WIDTH * 4,
      )
    return out
  }
  await Deno.writeFile(
    `${path}.out.rgba`,
    unpad(new Uint8Array(texRead.getMappedRange())),
  )
  await Deno.writeFile(
    `${path}.face.rgba`,
    unpad(new Uint8Array(faceRead.getMappedRange())),
  )
  compRead.unmap()
  texRead.unmap()
  faceRead.unmap()
}

async function main(): Promise<void> {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (adapter === null) throw new Error('no adapter')
  const timestamps = adapter.features.has('timestamp-query')
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
  })
  device.addEventListener('uncapturederror', e => {
    console.error('GPU error:', (e as GPUUncapturedErrorEvent).error.message)
  })
  const controls = await controlsFromArgs()
  const g = await Graph.create(device, {
    controls,
    bEnabled: !flag('nob'),
    sourceA: barsA(),
    sourceB: gradientB(),
  })
  const frames = Number(arg('frames') ?? 120)
  const warmup = Math.min(10, frames >> 2)
  const ablate = new Set((arg('ablate') ?? '').split(',').filter(Boolean))
  for (const a of ablate)
    if (!g.passes.some(p => p.label === a)) throw new Error(`no pass ${a}`)

  // Every frame's timestamps resolve into one buffer and come back in a single
  // readback after the run, so nothing waits mid-stream: waiting on each frame
  // lets the card clock down between frames and doubles every median. wgpu
  // hands the counters back as raw ticks; the tick is calibrated from the GPU
  // clock's own frame period against wall time, which holds whether the stream
  // was GPU- or CPU-bound, unless --tick= pins it.
  const MAX_Q = 2 * 64
  const PER_SET = Math.floor(4096 / MAX_Q)
  const sets = timestamps
    ? Array.from({ length: Math.ceil(frames / PER_SET) }, () =>
        device.createQuerySet({ type: 'timestamp', count: PER_SET * MAX_Q }),
      )
    : []
  const resolve = device.createBuffer({
    size: Math.max(frames * MAX_Q * 8, 8),
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  })
  const read = device.createBuffer({
    size: Math.max(frames * MAX_Q * 8, 8),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const orders: string[][] = []
  let cpuMs = 0
  const t0 = performance.now()
  let tWarm = t0
  for (let f = 0; f < frames; f++) {
    if (f === warmup) tWarm = performance.now()
    const c0 = performance.now()
    const enc = device.createCommandEncoder()
    const order: string[] = []
    orders.push(order)
    const qs = sets[Math.floor(f / PER_SET)]
    const base = (f % PER_SET) * MAX_Q
    g.encode(enc, (p, run) => {
      if (ablate.has(p.label)) return
      const i = order.length
      order.push(p.label)
      run(
        qs === undefined || i * 2 + 1 >= MAX_Q
          ? undefined
          : {
              querySet: qs,
              beginningOfPassWriteIndex: base + 2 * i,
              endOfPassWriteIndex: base + 2 * i + 1,
            },
      )
    })
    const q = Math.min(order.length * 2, MAX_Q)
    if (qs !== undefined && q > 0)
      enc.resolveQuerySet(qs, base, q, resolve, f * MAX_Q * 8)
    device.queue.submit([enc.finish()])
    cpuMs += performance.now() - c0
  }
  await device.queue.onSubmittedWorkDone()
  const tEnd = performance.now()
  const wallMs = (tEnd - t0) / frames

  const perPass = new Map<string, number[]>()
  const span: number[] = []
  const firstTick: number[] = []
  if (timestamps) {
    const enc = device.createCommandEncoder()
    enc.copyBufferToBuffer(resolve, 0, read, 0, frames * MAX_Q * 8)
    device.queue.submit([enc.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const all = new BigUint64Array(read.getMappedRange())
    for (let f = warmup; f < frames; f++) {
      const order = orders[f]
      const q = Math.min(order.length * 2, MAX_Q)
      if (q === 0) continue
      const ts = all.subarray(f * MAX_Q, f * MAX_Q + q)
      order.forEach((label, i) => {
        if (2 * i + 1 >= q) return
        const arr = perPass.get(label) ?? []
        arr.push(Number(ts[2 * i + 1] - ts[2 * i]))
        perPass.set(label, arr)
      })
      span.push(Number(ts[q - 1] - ts[0]))
      firstTick.push(Number(ts[0]))
    }
    read.unmap()
  }
  const counted = span.length
  const pinned = arg('tick')
  const tickNs =
    pinned !== undefined
      ? Number(pinned)
      : firstTick.length > 1
        ? ((tEnd - tWarm) * 1e6) /
          (firstTick[firstTick.length - 1] - firstTick[0] + median(span))
        : 1
  const ms = (ticks: number) => (ticks * tickNs) / 1e6

  const dumpTo = arg('dump')
  if (dumpTo !== undefined) await dump(g, dumpTo)

  const rows = [...perPass.entries()].map(([label, ticks]) => ({
    label,
    n: ticks.length,
    best: ms(Math.min(...ticks)),
    median: ms(median(ticks)),
  }))
  const summary = {
    adapter: adapter.info?.description,
    frames: counted,
    tickNs,
    tickPinned: pinned !== undefined,
    rows,
    spanBest: ms(Math.min(...span)),
    spanMedian: ms(median(span)),
    wallMs,
    cpuMs: cpuMs / frames,
  }
  if (flag('json')) {
    console.log(JSON.stringify(summary))
    return
  }
  console.log(
    `${summary.adapter ?? 'adapter'} — ${counted} timed frames of ${frames}${ablate.size > 0 ? `, ablated ${[...ablate].join(',')}` : ''}`,
  )
  console.log(
    `tick ${tickNs.toFixed(2)} ns ${pinned !== undefined ? '(pinned)' : '(calibrated: wall / GPU frame period)'}, cpu ${(cpuMs / frames).toFixed(3)} ms/frame staging`,
  )
  console.log(
    'pass'.padEnd(18) + 'best ms'.padStart(9) + 'median ms'.padStart(11),
  )
  let sumBest = 0
  let sumMed = 0
  for (const r of rows) {
    sumBest += r.best
    sumMed += r.median
    console.log(
      r.label.padEnd(18) +
        r.best.toFixed(3).padStart(9) +
        r.median.toFixed(3).padStart(11),
    )
  }
  console.log(
    'sum of passes'.padEnd(18) +
      sumBest.toFixed(3).padStart(9) +
      sumMed.toFixed(3).padStart(11),
  )
  if (span.length > 0)
    console.log(
      'frame span'.padEnd(18) +
        summary.spanBest.toFixed(3).padStart(9) +
        summary.spanMedian.toFixed(3).padStart(11),
    )
  console.log(
    'wall/frame'.padEnd(18) +
      wallMs.toFixed(3).padStart(9) +
      '  (throughput: GPU-bound when cpu staging sits well under it)',
  )
}

await main()
