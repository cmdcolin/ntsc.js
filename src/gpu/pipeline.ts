import { CONTROL_KEYS, DEFAULT_CONTROLS } from '../controls'
import { AudioState } from '../signal/audiostate'
import {
  ACTIVE_HEIGHT,
  ACTIVE_WIDTH,
  FSC,
  F_H,
  LINES,
  SAMPLES_PER_LINE,
  SAMPLE_RATE,
} from '../signal/constants'
import {
  FILTER_STRIDE,
  NUM_SECTIONS,
  SEC_CHROMA_BP,
  SEC_DEMOD,
  SEC_ENC_CHROMA,
  SEC_LUMA,
  SEC_UNDER,
  TAPS,
  bandpass,
  lowpass,
  lowpassCausal,
  lowpassPeaked,
  mixTaps,
  packFilterBank,
} from '../signal/filters'
import { LineState } from '../signal/linestate'
import { MixState } from '../signal/mixstate'
import { ModState } from '../signal/modstate'
import { initGpu } from './context'
import {
  GEN_OFFSET,
  PARAM_BYTES,
  PRELUDE,
  TILE_WG,
  packParams,
} from './prelude'
import { RenderLoop } from './renderloop'
import channelSrc from './shaders/channel.wgsl?raw'
import chromaExtractSrc from './shaders/chroma_extract.wgsl?raw'
import composeSrc from './shaders/compose.wgsl?raw'
import composeBSrc from './shaders/compose_b.wgsl?raw'
import crtFaceSrc from './shaders/crt_face.wgsl?raw'
import decodeSrc from './shaders/decode.wgsl?raw'
import encodeChromaBSrc from './shaders/encode_chroma_b.wgsl?raw'
import encodeCompositeSrc from './shaders/encode_composite.wgsl?raw'
import encodeYuvSrc from './shaders/encode_yuv.wgsl?raw'
import enhancerSrc from './shaders/enhancer.wgsl?raw'
import fbCompositeSrc from './shaders/fb_composite.wgsl?raw'
import lineAnalyzeSrc from './shaders/line_analyze.wgsl?raw'
import mixBSrc from './shaders/mix_b.wgsl?raw'
import presentSrc from './shaders/present.wgsl?raw'
import storePrevSrc from './shaders/store_prev.wgsl?raw'
import syncSrc from './shaders/sync.wgsl?raw'
import syncMeasureSrc from './shaders/sync_measure.wgsl?raw'
import timebaseSrc from './shaders/timebase.wgsl?raw'
import underDownSrc from './shaders/under_down.wgsl?raw'
import { Sources } from './sources'

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { LineStateControls } from '../signal/linestate'
import type { Gpu } from './context'

const N = SAMPLES_PER_LINE * LINES
const LINE_PARAM_BYTES = LINES * 16
const MAX_GENS = 4

// Bent-crystal demod LO: how fast a detuned 3.58 MHz oscillator's phase error
// grows, per composite sample.
const loRadPerSample = (detuneKHz: number): number =>
  (2 * Math.PI * detuneKHz * 1e3) / SAMPLE_RATE

const FILTER_KEYS: ReadonlySet<string> = new Set([
  'encChromaMHz',
  'demodMHz',
  'chromaTail',
  'lumaMHz',
  'lumaPeak',
])

// One compute dispatch in the signal chain. `when` gates the dispatch on the
// current controls; omitted means always. Bind groups are fixed except
// compose's, which is rebuilt when the source raster resizes.
interface Pass {
  label: string
  pl: GPUComputePipeline
  bg: GPUBindGroup
  x: number
  y: number
  when?: () => boolean
}

const NOOP = () => {}

const texDesc = (usage: number): GPUTextureDescriptor => ({
  size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
  format: 'rgba8unorm',
  usage,
})

export class Engine {
  readonly controls: Controls = { ...DEFAULT_CONTROLS }
  // React reads this immutable snapshot via useSyncExternalStore; it's refreshed
  // from `controls` on every write so the UI and the render loop never drift.
  private snapshot: Controls = { ...DEFAULT_CONTROLS }
  private controlListeners = new Set<() => void>()
  onStats: (stats: FrameStats) => void = () => {}
  // Two different failures, deliberately kept apart because they call for
  // opposite advice: the device told us it was lost (driver reset, sleep/wake —
  // a reload usually recovers), versus submitted work that never completes
  // (the GPU process is wedged, and it outlives this page).
  onDeviceLost: (message: string) => void = () => {}
  onHang: () => void = () => {}
  // A third, milder failure: the app and the GPU are both fine, the browser has
  // simply stopped painting this tab, so rendered frames go nowhere. Recoverable
  // on its own — hence a banner rather than the fatal screen.
  onFrozen: (frozen: boolean) => void = () => {}
  // Non-fatal GPU faults (uncaptured validation/oom, e.g. an over-large source
  // texture): surfaced to the panel banner instead of only the console, so a
  // wedged render loop shows a reason rather than looking frozen.
  onGpuError: (message: string) => void = () => {}

  // Initialized from ?dbg=; also switchable live via setDbgView (Advanced).
  private dbgView = Number(new URLSearchParams(location.search).get('dbg') ?? 0)

  private gpu: Gpu
  private canvas: HTMLCanvasElement
  private frame = 0
  private filtersDirty = true
  private lineState = new LineState()
  readonly audioState = new AudioState()
  private mixState = new MixState()
  private modState = new ModState()
  private modSlots: ModSlot[] = []
  // bent-crystal demod LO phase error, accumulated per frame (radians)
  private scPhase = 0
  // picture-search crossing pattern phase, accumulated per frame (crossings)
  private shuttlePhase = 0
  // slow motion: sim-time owed, in frames; a step fires when it reaches 1
  private simAcc = 0
  private paramScratch = new ArrayBuffer(PARAM_BYTES)
  private loop: RenderLoop
  private destroyed = false

  private paramsBuf: GPUBuffer
  private genParamsBuf: GPUBuffer
  private genLineParamsBuf: GPUBuffer
  private filterBuf: GPUBuffer
  private yuvBuf: GPUBuffer
  private yuvBBuf: GPUBuffer
  private uvfBBuf: GPUBuffer
  private compA: GPUBuffer
  private compB: GPUBuffer
  private compPrev: GPUBuffer
  private chromaBuf: GPUBuffer
  private underBuf: GPUBuffer
  private lineInfoBuf: GPUBuffer
  private lineParamsBuf: GPUBuffer
  private timingBuf: GPUBuffer
  private syncMeasureBuf: GPUBuffer
  private audioBuf: GPUBuffer
  // Phosphor state, ping-ponged: decode reads the light the screen is holding
  // out of one and writes the new state into the other, so its lateral scatter
  // sees settled neighbours rather than a buffer mid-overwrite.
  private persistBufs: [GPUBuffer, GPUBuffer]
  private decodePass: Pass
  private decodeBgs: [GPUBindGroup, GPUBindGroup]

  // The two input slots: staging, capping, aspect and the noise generators all
  // live in there, so the chain below only sees two texture views.
  private sources: Sources
  private inputTex: GPUTexture
  private outTex: GPUTexture
  // The decoded frame rendered as a glowing CRT face (bloom/halation/glow).
  // Both the display and the feedback camera sample this, not the raw signal.
  private faceTex: GPUTexture
  private linearSamp: GPUSampler

  // The signal chain, as data: pre-chain (source assembly, dirty mix, loop
  // entry), the channel block that repeats per dub generation, and the
  // receiver side.
  private prePasses: Pass[]
  private loopPasses: Pass[]
  private postPasses: Pass[]
  private composePass: Pass
  private composePl: GPUComputePipeline
  private presentPl: GPURenderPipeline
  private presentBg: GPUBindGroup

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    const gpu = await initGpu(canvas)
    return new Engine(gpu, canvas)
  }

  private constructor(gpu: Gpu, canvas: HTMLCanvasElement) {
    this.gpu = gpu
    this.canvas = canvas
    const d = gpu.device
    this.paramsBuf = d.createBuffer({
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    // per-generation param/line-param blocks, copied over the live buffers
    // between dub generations inside the frame's command stream
    this.genParamsBuf = d.createBuffer({
      size: MAX_GENS * PARAM_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.genLineParamsBuf = d.createBuffer({
      size: MAX_GENS * LINE_PARAM_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.filterBuf = d.createBuffer({
      size: NUM_SECTIONS * FILTER_STRIDE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.yuvBuf = d.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.STORAGE,
    })
    this.yuvBBuf = d.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.STORAGE,
    })
    // B's encoder-filtered chroma, one vec2f per sample (encode_chroma_b)
    this.uvfBBuf = d.createBuffer({
      size: N * 8,
      usage: GPUBufferUsage.STORAGE,
    })
    this.compA = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.compB = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE })
    this.compPrev = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.chromaBuf = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    this.underBuf = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    this.lineInfoBuf = d.createBuffer({
      size: LINES * 16,
      usage: GPUBufferUsage.STORAGE,
    })
    this.lineParamsBuf = d.createBuffer({
      size: LINE_PARAM_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    // per-line hoff + 3 persistent scalars + a per-raster-line deflection sag
    this.timingBuf = d.createBuffer({
      size: (LINES * 2 + 3) * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    this.syncMeasureBuf = d.createBuffer({
      size: LINES * 16,
      usage: GPUBufferUsage.STORAGE,
    })
    // one audio sample per line, uploaded each frame
    this.audioBuf = d.createBuffer({
      size: LINES * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    // phosphor persistence state: the light still on the glass, packed rgba8
    const persistBuf = (): GPUBuffer =>
      d.createBuffer({
        size: ACTIVE_WIDTH * ACTIVE_HEIGHT * 4,
        usage: GPUBufferUsage.STORAGE,
      })
    this.persistBufs = [persistBuf(), persistBuf()]

    // Resizing A's texture invalidates the view compose's bind group holds, so
    // rebuild it. Only reachable after construction, via a set*Source*.
    this.sources = new Sources({
      device: d,
      onResizeA: () => {
        this.composePass.bg = this.makeComposeBg()
      },
    })
    this.inputTex = d.createTexture(
      texDesc(
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      ),
    )
    this.outTex = d.createTexture(
      texDesc(
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      ),
    )
    this.faceTex = d.createTexture(
      texDesc(
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      ),
    )
    this.linearSamp = d.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })

    const module = (src: string) => {
      const m = d.createShaderModule({ code: PRELUDE + src })
      void m.getCompilationInfo().then(info => {
        for (const msg of info.messages) {
          if (msg.type === 'error')
            console.error(`WGSL ${msg.lineNum}:${msg.linePos} ${msg.message}`)
        }
      })
      return m
    }
    const compute = (src: string) =>
      d.createComputePipeline({
        layout: 'auto',
        compute: { module: module(src), entryPoint: 'main' },
      })
    this.composePl = compute(composeSrc)
    const composeBPl = compute(composeBSrc)
    const encodeYuvPl = compute(encodeYuvSrc)
    const encodeChromaBPl = compute(encodeChromaBSrc)
    const encodeCompositePl = compute(encodeCompositeSrc)
    const mixBPl = compute(mixBSrc)
    const fbCompositePl = compute(fbCompositeSrc)
    const storePrevPl = compute(storePrevSrc)
    const chromaExtractPl = compute(chromaExtractSrc)
    const underDownPl = compute(underDownSrc)
    const channelPl = compute(channelSrc)
    const timebasePl = compute(timebaseSrc)
    const enhancerPl = compute(enhancerSrc)
    const syncMeasurePl = compute(syncMeasureSrc)
    const syncPl = compute(syncSrc)
    const lineAnalyzePl = compute(lineAnalyzeSrc)
    const decodePl = compute(decodeSrc)
    const crtFacePl = compute(crtFaceSrc)

    const presentModule = module(presentSrc)
    this.presentPl = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vs' },
      fragment: {
        module: presentModule,
        entryPoint: 'fs',
        targets: [{ format: gpu.format }],
      },
      primitive: { topology: 'triangle-list' },
    })

    const bindGroup = (
      pl: GPUComputePipeline,
      resources: GPUBindingResource[],
    ): GPUBindGroup =>
      d.createBindGroup({
        layout: pl.getBindGroupLayout(0),
        entries: resources.map((resource, binding) => ({ binding, resource })),
      })
    const pass = (
      label: string,
      pl: GPUComputePipeline,
      resources: GPUBindingResource[],
      [x, y]: readonly [number, number],
      when?: () => boolean,
    ): Pass => ({
      label,
      pl,
      bg: bindGroup(pl, resources),
      x,
      y,
      when,
    })
    const perLine = [Math.ceil(SAMPLES_PER_LINE / 64), LINES] as const
    const perPixel = [Math.ceil(ACTIVE_WIDTH / 64), ACTIVE_HEIGHT] as const
    // the tiled-FIR passes run TILE_WG-wide workgroups (see prelude)
    const perLineT = [Math.ceil(SAMPLES_PER_LINE / TILE_WG), LINES] as const
    const perPixelT = [
      Math.ceil(ACTIVE_WIDTH / TILE_WG),
      ACTIVE_HEIGHT,
    ] as const
    // 8x8 workgroups for the 2D spatial passes (compose, crtFace)
    const perTile = [
      Math.ceil(ACTIVE_WIDTH / 8),
      Math.ceil(ACTIVE_HEIGHT / 8),
    ] as const
    const perRow = [Math.ceil(LINES / 64), 1] as const
    const c = this.controls
    // What mixB can actually change. The genlocked path is a crossfade against
    // the program bus, so it reads neither the A fader nor the ring mod — a
    // value left on either from a session on the dirty path would otherwise
    // dispatch encodeYuvB and a full re-encode of B for a frame identical to
    // the one A already wrote.
    const bOn = () =>
      this.sources.bEnabled &&
      (c.bGain !== 0 ||
        c.pipMix !== 0 ||
        (c.bGenlock < 0.5 && (c.bRing !== 0 || c.aGain !== 1)))

    this.composePass = {
      label: 'compose',
      pl: this.composePl,
      bg: this.makeComposeBg(),
      x: perTile[0],
      y: perTile[1],
    }
    this.prePasses = [
      this.composePass,
      pass(
        'encodeYuv',
        encodeYuvPl,
        [this.inputTex.createView(), this.linearSamp, { buffer: this.yuvBuf }],
        perPixel,
      ),
      pass(
        'encodeComposite',
        encodeCompositePl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.filterBuf },
          { buffer: this.yuvBuf },
          { buffer: this.compA },
        ],
        perLineT,
      ),
      pass(
        'composeB',
        composeBPl,
        [{ buffer: this.paramsBuf }, this.sources.viewB()],
        perTile,
        () => bOn() && this.sources.srcNoiseB > 0,
      ),
      pass(
        'encodeYuvB',
        encodeYuvPl,
        [this.sources.viewB(), this.linearSamp, { buffer: this.yuvBBuf }],
        perPixel,
        bOn,
      ),
      pass(
        'encodeChromaB',
        encodeChromaBPl,
        [
          { buffer: this.filterBuf },
          { buffer: this.yuvBBuf },
          { buffer: this.uvfBBuf },
        ],
        perPixelT,
        bOn,
      ),
      pass(
        'mixB',
        mixBPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.yuvBBuf },
          { buffer: this.uvfBBuf },
          { buffer: this.compA },
        ],
        perLine,
        bOn,
      ),
      pass(
        'fbComposite',
        fbCompositePl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.compPrev },
          { buffer: this.compA },
        ],
        perLine,
        () => c.cfbMix !== 0,
      ),
    ]
    this.loopPasses = [
      pass(
        'chromaExtract',
        chromaExtractPl,
        [
          { buffer: this.filterBuf },
          { buffer: this.compA },
          { buffer: this.chromaBuf },
        ],
        perLineT,
      ),
      pass(
        'underDown',
        underDownPl,
        [
          { buffer: this.filterBuf },
          { buffer: this.chromaBuf },
          { buffer: this.lineParamsBuf },
          { buffer: this.underBuf },
        ],
        perLineT,
        () => c.colorUnderMix > 0,
      ),
      pass(
        'channel',
        channelPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.filterBuf },
          { buffer: this.compA },
          { buffer: this.chromaBuf },
          { buffer: this.underBuf },
          { buffer: this.lineParamsBuf },
          { buffer: this.compB },
          { buffer: this.audioBuf },
        ],
        perLineT,
      ),
      pass(
        'timebase',
        timebasePl,
        [
          { buffer: this.lineParamsBuf },
          { buffer: this.compB },
          { buffer: this.compA },
        ],
        perLine,
      ),
    ]
    // Decode's two bind groups differ only in which phosphor buffer it reads and
    // which it writes; `renderFrame` swaps them by frame parity.
    const decodeRes = (
      read: GPUBuffer,
      write: GPUBuffer,
    ): GPUBindingResource[] => [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.compA },
      { buffer: this.lineInfoBuf },
      { buffer: this.timingBuf },
      this.outTex.createView(),
      { buffer: read },
      { buffer: write },
      { buffer: this.audioBuf },
    ]
    const [pA, pB] = this.persistBufs
    this.decodeBgs = [
      bindGroup(decodePl, decodeRes(pA, pB)),
      bindGroup(decodePl, decodeRes(pB, pA)),
    ]
    this.decodePass = {
      label: 'decode',
      pl: decodePl,
      bg: this.decodeBgs[0],
      x: perPixelT[0],
      y: perPixelT[1],
    }
    this.postPasses = [
      // The enhancer is an outboard box between the deck and the set, so it
      // sits after the last dub generation and before the receiver measures
      // anything — the pulses it stamps are the pulses the TV has to lock to.
      pass(
        'enhancer',
        enhancerPl,
        [{ buffer: this.paramsBuf }, { buffer: this.compA }],
        perRow,
        () =>
          c.enhClampUs !== 0 ||
          c.enhDroopUs > 0 ||
          (c.enhPeakMHz > 0 && c.enhPeakBoost > 0) ||
          c.enhSync > 0,
      ),
      pass(
        'syncMeasure',
        syncMeasurePl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.compA },
          { buffer: this.timingBuf },
          { buffer: this.syncMeasureBuf },
        ],
        perRow,
      ),
      pass(
        'sync',
        syncPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.syncMeasureBuf },
          { buffer: this.timingBuf },
          { buffer: this.audioBuf },
        ],
        [1, 1],
      ),
      pass(
        'lineAnalyze',
        lineAnalyzePl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.compA },
          { buffer: this.timingBuf },
          { buffer: this.lineInfoBuf },
        ],
        perRow,
      ),
      this.decodePass,
      // Photograph the decoded signal as a glowing CRT face; both the display
      // and next frame's feedback camera sample faceTex, so the loop
      // re-photographs an emissive screen rather than the raw signal buffer.
      pass(
        'crtFace',
        crtFacePl,
        [
          { buffer: this.paramsBuf },
          this.outTex.createView(),
          this.linearSamp,
          this.faceTex.createView(),
          { buffer: this.timingBuf },
        ],
        perTile,
      ),
      // frame-store capture of what the decoder saw; strobe holds by skipping.
      // Trails force an even period so every capture shares one subcarrier
      // frame parity — a mixed-parity store scrambles hue beyond what
      // burst-lock can correct. An idle loop (cfbMix 0) skips entirely; the
      // store goes stale, so the first frame after the fader comes up replays
      // the old capture.
      pass(
        'storePrev',
        storePrevPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.compA },
          { buffer: this.compPrev },
        ],
        perLine,
        () => {
          const period =
            c.cfbTrail > 0
              ? 2 * Math.ceil((c.cfbHold + 1) / 2)
              : Math.round(c.cfbHold) + 1
          return c.cfbMix !== 0 && this.frame % period === 0
        },
      ),
    ]
    this.presentBg = d.createBindGroup({
      layout: this.presentPl.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: this.faceTex.createView() },
        { binding: 2, resource: this.linearSamp },
      ],
    })

    this.loop = new RenderLoop({
      device: this.gpu.device,
      render: () => this.render(),
      onStats: s => this.onStats(s),
      onHang: () => this.onHang(),
      recover: () => this.recoverSurface(),
      onFrozen: f => this.onFrozen(f),
      frameNo: () => this.frame,
    })

    // Faults the error scopes don't catch (they only wrap startup frames) land
    // here — chiefly an over-large source texture on a fresh pick — so report
    // them to the UI rather than let the loop wedge silently.
    this.gpu.device.addEventListener('uncapturederror', e => {
      if (e instanceof GPUUncapturedErrorEvent) this.onGpuError(e.error.message)
    })

    // reason 'destroyed' is our own destroy(); anything else is a real loss
    // (driver reset, sleep/wake, GPU hang) — stop and surface it.
    void this.gpu.device.lost.then(info => {
      if (this.loop.running && info.reason !== 'destroyed') {
        this.loop.stop()
        console.error(`WebGPU device lost (${info.reason}): ${info.message}`)
        this.onDeviceLost(info.message)
      }
    })
    this.loop.start()
  }

  setControl(key: ControlKey, value: number): void {
    this.controls[key] = value
    if (FILTER_KEYS.has(key)) this.filtersDirty = true
    this.emitControls()
  }

  applyControls(patch: Partial<Controls>): void {
    for (const k of CONTROL_KEYS) {
      const v = patch[k]
      if (v !== undefined) {
        this.controls[k] = v
        if (FILTER_KEYS.has(k)) this.filtersDirty = true
      }
    }
    this.emitControls()
  }

  // useSyncExternalStore wiring: a single write path keeps React and the render
  // loop in sync, replacing the hand-mirrored `values` copy in the UI.
  readonly subscribeControls = (fn: () => void): (() => void) => {
    this.controlListeners.add(fn)
    return () => {
      this.controlListeners.delete(fn)
    }
  }

  readonly getControls = (): Controls => this.snapshot

  private emitControls(): void {
    this.snapshot = { ...this.controls }
    for (const fn of this.controlListeners) fn()
  }

  // Hold-to-compare: push `next` to the render path without touching the React
  // snapshot (so the sliders stay put), then `preview(null)` restores from it.
  preview(next: Controls | null): void {
    const src = next ?? this.snapshot
    for (const k of CONTROL_KEYS) this.controls[k] = src[k]
    this.filtersDirty = true
  }

  // Source selection, delegated to Sources. The engine stays the public object
  // (useEngine and the window.vf harness both drive it), but none of the
  // staging, capping, or aspect handling lives here any more.
  setImageSource(source: OffscreenCanvas | ImageBitmap, aspect = 4 / 3): void {
    this.sources.setImageSource(source, aspect)
  }

  setVideoSource(el: HTMLVideoElement | null): void {
    this.sources.setVideoSource(el)
  }

  // A GPU-generated noise field (1 TV static, 2 VHS static); 0 restores the
  // texture path. Any real image/video source clears it.
  setNoiseSource(kind: number): void {
    this.sources.setNoiseSource(kind)
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.sources.setImageSourceB(source)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    this.sources.setVideoSourceB(el)
  }

  setNoiseSourceB(kind: number): void {
    this.sources.setNoiseSourceB(kind)
  }

  setSourceBEnabled(on: boolean): void {
    this.sources.setSourceBEnabled(on)
  }

  // Slot A's view is the only binding that changes when its raster resizes.
  private makeComposeBg(): GPUBindGroup {
    return this.gpu.device.createBindGroup({
      layout: this.composePl.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: this.sources.viewA() },
        { binding: 2, resource: this.faceTex.createView() },
        { binding: 3, resource: this.linearSamp },
        { binding: 4, resource: this.inputTex.createView() },
      ],
    })
  }

  // Idempotent, and deliberately keyed off its own flag rather than
  // `loop.running`: a loop stopped by the hang watchdog or by device loss is
  // precisely when the device most needs releasing, and gating on `running`
  // turned teardown into a no-op in exactly that case — so the HMR dispose hook
  // and the pagehide handler both silently leaked a whole GPUDevice, which is
  // what stacks up until Firefox's WebGPU wedges the tab.
  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true
      this.loop.stop()
      const bufs = [
        this.paramsBuf,
        this.genParamsBuf,
        this.genLineParamsBuf,
        this.filterBuf,
        this.yuvBuf,
        this.yuvBBuf,
        this.uvfBBuf,
        this.compA,
        this.compB,
        this.compPrev,
        this.chromaBuf,
        this.underBuf,
        this.lineInfoBuf,
        this.lineParamsBuf,
        this.timingBuf,
        this.syncMeasureBuf,
        this.audioBuf,
        ...this.persistBufs,
      ]
      for (const b of bufs) b.destroy()
      for (const t of [this.inputTex, this.outTex, this.faceTex]) t.destroy()
      this.sources.destroy()
      // The audio graph is not the device's, so nothing above releases it — and
      // a mic left open keeps the browser's recording indicator lit long after
      // the picture is gone.
      this.audioState.close()
      // Frees everything else the device owns (pipelines, bind groups) and drops
      // the swap-chain configuration.
      this.gpu.device.destroy()
    }
  }

  // Manual frame step for the verification harness (rAF is throttled in
  // occluded windows). Forces a full sim step regardless of timeScale so
  // stepping stays deterministic.
  step(): void {
    this.simAcc = 1
    this.render()
  }

  private rebuildFilters(): void {
    const c = this.controls
    const bank = packFilterBank(
      new Map([
        [SEC_ENC_CHROMA, lowpass(c.encChromaMHz * 1e6, TAPS.encChroma)],
        [
          SEC_DEMOD,
          mixTaps(
            lowpass(c.demodMHz * 1e6, TAPS.demod),
            lowpassCausal(c.demodMHz * 1e6, TAPS.demod),
            c.chromaTail,
          ),
        ],
        [
          SEC_LUMA,
          lowpassPeaked(
            c.lumaMHz * 1e6,
            c.lumaPeak,
            c.lumaMHz * 0.75e6,
            TAPS.luma,
          ),
        ],
        [SEC_CHROMA_BP, bandpass(FSC, 0.6e6, TAPS.chromaBp)],
        [SEC_UNDER, lowpass(1.2e6, TAPS.under)],
      ]),
    )
    this.gpu.device.queue.writeBuffer(this.filterBuf, 0, bank)
    this.filtersDirty = false
  }

  private uniformValues() {
    const c = this.controls
    return {
      frame: this.frame,
      gen: 0,
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      srcAspect: this.sources.srcAspect,
      srcNoise: this.sources.srcNoise,
      srcNoiseB: this.sources.srcNoiseB,
      invert: c.invert,
      deint: c.deint,
      chromaGain: c.chromaGain,
      burstLock: c.burstLock,
      scDetunePhase: this.scPhase,
      scDetunePerSample: loRadPerSample(c.scDetuneKHz),
      killThresh: c.killThresh,
      svideoBleed: c.svideoBleed,
      combMode: c.combMode,
      hHold: c.hHold,
      vHold: c.vHold,
      // beat between the free-running v-osc and the incoming field rate: a
      // slower oscillator retraces late, so the raster start creeps down the
      // source and the picture climbs
      vRollRate:
        LINES * (60 / (c.vFreqHz - c.audioRoll * this.audioState.hit) - 1),
      syncBend: c.syncBendUs * 1e-6 * SAMPLE_RATE,
      bendAmt: c.bendUs * 1e-6 * SAMPLE_RATE,
      bendShape: c.bendShape,
      bendPeriod: c.bendPeriod,
      hvSag:
        (c.hvSagUs + c.audioSagUs * this.audioState.hit) * 1e-6 * SAMPLE_RATE,
      hvRing: c.hvRing,
      // beat between the free-running H-osc and the incoming line rate, in
      // samples of phase gained per line
      hRate:
        SAMPLES_PER_LINE *
        (F_H / (F_H + c.hDetuneHz + c.audioTear * this.audioState.level) - 1),
      audioBend: c.audioBendUs * 1e-6 * SAMPLE_RATE,
      audioLoad: c.audioLoad,
      audioIre: c.audioIre,
      noiseSigma: c.noiseIre,
      ghostDelay: c.ghostDelayUs * 1e-6 * SAMPLE_RATE,
      ghostGain: c.ghostGain,
      humAmp: c.humAmp,
      humMod: c.humMod,
      colorUnderMix: c.colorUnderMix,
      chromaNoise: c.chromaNoiseIre,
      dropoutRate: c.dropoutRate,
      dropoutLen: c.dropoutLenUs * 1e-6 * SAMPLE_RATE,
      headSwitchNoise: c.headSwitchNoise,
      polarityFlip: c.polarityFlip,
      termination: c.termination,
      chromaPinOnly: c.chromaPinOnly,
      connectorGlitch: c.connectorGlitch,
      scramble: c.scramble,
      scrambleMode: c.scrambleMode,
      enhClampOff: c.enhClampUs * 1e-6 * SAMPLE_RATE,
      // RC leak per sample from the coupling time constant; 0 us is the
      // DC-coupled box, which never lets the level move at all.
      enhDroop:
        c.enhDroopUs > 0
          ? 1 - Math.exp(-1 / (c.enhDroopUs * 1e-6 * SAMPLE_RATE))
          : 0,
      enhPeakFc: (c.enhPeakMHz * 1e6) / SAMPLE_RATE,
      // Pole radius: 0.85 rings for a handful of samples, 1.0 rings forever,
      // and above it the stage is regenerative and climbs to the rails.
      enhPeakR: 0.85 + 0.2 * c.enhPeakQ,
      enhPeakBoost: c.enhPeakBoost,
      enhSync: c.enhSync,
      enhSlice: c.enhSliceIre,
      fbMix: c.fbMix,
      fbZoom: c.fbZoom,
      fbRotate: (c.fbRotateDeg * Math.PI) / 180,
      fbShiftX: c.fbShiftX,
      fbShiftY: c.fbShiftY,
      fbGain: c.fbGain,
      fbFocus: c.fbFocus,
      fbVign: c.fbVign,
      fbBlack: c.fbBlack,
      fbKnee: c.fbKnee,
      crtCutoff: c.crtCutoff,
      crtGamma: c.crtGamma,
      crtSat: c.crtSat,
      crtSpot: c.crtSpot,
      crtGrain: c.crtGrain,
      crtBloom: c.crtBloom,
      crtHalation: c.crtHalation,
      crtGlow: c.crtGlow,
      aGain: c.aGain,
      bGain: c.bGain,
      bRing: c.bRing,
      bHue: (c.bHueDeg * Math.PI) / 180,
      bVidGain: c.bVidGain,
      bInv: c.bInv,
      bGenlock: c.bGenlock,
      wipeMode: c.wipeMode,
      wipeSoft: c.wipeSoft,
      pipMix: c.pipMix,
      pipX: c.pipX,
      pipY: c.pipY,
      pipW: c.pipW,
      pipH: c.pipH,
      pipBorder: c.pipBorder,
      pipSoft: c.pipSoft,
      pipKey: c.pipKey,
      pipKeyLevel: c.pipKeyLevel,
      pipKeySoft: c.pipKeySoft,
      trackAmt: c.trackAmt,
      trackPos: c.trackPos,
      shuttleBars: c.shuttleX - 1,
      shuttlePhase: this.shuttlePhase,
      cfbMix: c.cfbMix,
      cfbGain: c.cfbGain,
      cfbDelay: c.cfbDelayUs * 1e-6 * SAMPLE_RATE,
      cfbLines: c.cfbLines,
      cfbKey: c.cfbKey,
      cfbKeyLevel: c.cfbKeyLevel,
      cfbKeySoft: c.cfbKeySoft,
      cfbTrail: c.cfbTrail,
      cfbFilterFc: (c.cfbFilterMHz * 1e6) / SAMPLE_RATE,
      cfbFilterQ: c.cfbFilterQ,
      cfbFilterBoost: c.cfbFilterBoost,
      soundIre: c.soundIre,
      agc: c.agc,
      chromaCoarse: c.chromaCoarse,
      scanBeam: c.scanBeam,
      scanBloom: c.scanBloom,
      phosphor: c.phosphor,
      phosphorMode: c.phosphorMode,
      phosphorSkew: c.phosphorSkew,
      phosphorDecayMix: c.phosphorDecayMix,
      phosphorBleed: c.phosphorBleed,
      crtSharp: c.crtSharp,
      maskAmt: c.maskAmt,
      maskPitch: c.maskPitch,
      crtZoom: c.crtZoom,
      crtZoomX: c.crtZoomX,
      crtZoomY: c.crtZoomY,
      dbgView: this.dbgView,
    }
  }

  // Re-arm the render loop after a transition (fullscreen exit, tab re-shown)
  // that can leave the browser having stopped delivering rAF callbacks.
  kick(): void {
    this.loop.kick()
  }

  // Rebuild the swapchain when the loop has run out of gentler options. A tab
  // that comes back from a long hidden stretch can be left holding a surface
  // the compositor no longer paints, and re-requesting rAF cannot fix that —
  // the traces show rAF delivering a couple of callbacks and then stopping for
  // good. Reconfiguring hands back a fresh swapchain, which is the one thing
  // this side of the boundary can still do about it.
  private recoverSurface(): void {
    if (!this.destroyed) {
      this.gpu.context.configure({
        device: this.gpu.device,
        format: this.gpu.format,
        alphaMode: 'opaque',
      })
    }
  }

  // Frame counter, for the diagnostic recorder and the verification harness.
  frameNo(): number {
    return this.frame
  }

  // Bender's modulation: LFOs / random walks / audio envelopes wiggle controls
  // around their slider settings, the way bent hardware has oscillators and
  // hands patched into pots. Applied by mutating `controls` for the duration
  // of one frame and restoring after, so uniforms, filter design, and pass
  // gating all see the modulated value while React, presets, and scenes keep
  // the resting one (the same takeover semantics as MIDI).
  setModSlots(slots: ModSlot[]): void {
    this.modSlots = slots
  }

  setDbgView(view: number): void {
    this.dbgView = view
  }

  getDbgView(): number {
    return this.dbgView
  }

  private applyMod(): () => void {
    let restore: () => void = NOOP
    if (this.modSlots.length > 0) {
      const vals = this.modState.update(
        this.modSlots,
        this.audioState.level,
        this.audioState.hit,
      )
      const saved = this.modSlots.map(
        s => [s.target, this.controls[s.target]] as const,
      )
      const touchedFilter = this.modSlots.some(s => FILTER_KEYS.has(s.target))
      this.modSlots.forEach((s, i) => {
        const v = this.controls[s.target] + s.depth * (s.max - s.min) * vals[i]
        this.controls[s.target] = Math.min(s.max, Math.max(s.min, v))
      })
      if (touchedFilter) {
        this.filtersDirty = true
      }
      restore = () => {
        for (const [k, v] of saved) {
          this.controls[k] = v
        }
        // rebuilt from the modulated value this frame; make sure the next
        // frame (possibly with the slot removed) starts from the resting one
        if (touchedFilter) {
          this.filtersDirty = true
        }
      }
    }
    return restore
  }

  // Bent-crystal LO phase error keeps growing frame over frame; advance by
  // exactly one raster of samples so the shader's per-sample ramp is
  // continuous across the frame boundary.
  private advanceScPhase(detuneKHz: number): void {
    this.scPhase =
      (this.scPhase + loRadPerSample(detuneKHz) * N) % (2 * Math.PI)
  }

  // Crossing-pattern precession: a transport servo never sits on an exact
  // multiple of play speed, so the bars sweep rather than hold still. Wrapped
  // far out (not at 1) so strip identities don't all reroll at once; the one
  // reroll per wrap is invisible under the bar noise.
  private advanceShuttle(shuttleX: number): void {
    if (shuttleX !== 1)
      this.shuttlePhase =
        (this.shuttlePhase + (shuttleX - 1) * 0.0035 + 0.0008) % 1024
  }

  // Slow motion gates the whole simulation on a fractional accumulator: below
  // 1, sim steps fire on a fraction of display frames and everything — noise,
  // rolls, sweeps, feedback, phosphor — slows together, exactly like slowed
  // footage of the rig. Skipped frames re-present the held picture so the
  // canvas survives resizes; modulation still advances at display rate, so an
  // LFO or audio envelope on timeScale warps time live.
  private render(): void {
    const restoreMod = this.applyMod()
    try {
      this.simAcc = Math.min(this.simAcc + this.controls.timeScale, 1)
      if (this.simAcc >= 1) {
        this.simAcc -= 1
        this.renderFrame()
      } else {
        this.presentHeld()
      }
    } finally {
      restoreMod()
    }
  }

  private presentPass(enc: GPUCommandEncoder): void {
    const rp = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })
    rp.setPipeline(this.presentPl)
    rp.setBindGroup(0, this.presentBg)
    rp.draw(3)
    rp.end()
  }

  private presentHeld(): void {
    const enc = this.gpu.device.createCommandEncoder()
    this.presentPass(enc)
    this.gpu.device.queue.submit([enc.finish()])
  }

  private renderFrame(): void {
    const d = this.gpu.device
    this.sources.uploadFrames()
    if (this.frame % 30 === 0 && location.search.includes('debug')) {
      console.log('DEBUG frame', this.frame, this.sources.debugInfo())
    }
    if (this.filtersDirty) this.rebuildFilters()
    const c = this.controls
    this.advanceScPhase(c.scDetuneKHz)
    this.advanceShuttle(c.shuttleX)
    const mixU = this.mixState.update({
      bLineHz: c.bLineHz,
      bDetuneHz: c.bDetuneHz,
      bRollLps: c.bRollLps,
      wipePos: c.wipePos,
      wipeRateHz: c.wipeRate,
    })
    packParams({ ...this.uniformValues(), ...mixU }, this.paramScratch)
    d.queue.writeBuffer(this.paramsBuf, 0, this.paramScratch)
    const lineControls: LineStateControls = {
      tbJitterNs: c.tbJitterNs,
      tbWowNs: c.tbWowNs,
      underJitterDeg: c.underJitterDeg,
      headSwitchShiftUs: c.headSwitchShiftUs,
      trackAmt: c.trackAmt,
      trackPos: c.trackPos,
      shuttleBars: c.shuttleX - 1,
      shuttlePhase: this.shuttlePhase,
    }
    d.queue.writeBuffer(
      this.lineParamsBuf,
      0,
      this.lineState.update(lineControls, this.frame),
    )
    if (this.audioState.active)
      d.queue.writeBuffer(this.audioBuf, 0, this.audioState.update(c.audioGain))
    // Each extra dub generation is an independent playback pass: its own gen
    // seed (decorrelating noise and dropouts) and a fresh time-base/phase
    // walk, staged now and copied over the live buffers between generations.
    const gens = Math.min(Math.max(Math.round(c.dubGens), 1), MAX_GENS)
    const dv = new DataView(this.paramScratch)
    // Slot 0 is this frame's own params, staged so the loop below can put them
    // back before the receiver runs (see the restore after it).
    if (gens > 1) d.queue.writeBuffer(this.genParamsBuf, 0, this.paramScratch)
    for (let g = 1; g < gens; g++) {
      dv.setUint32(GEN_OFFSET, g, true)
      d.queue.writeBuffer(this.genParamsBuf, g * PARAM_BYTES, this.paramScratch)
      d.queue.writeBuffer(
        this.genLineParamsBuf,
        g * LINE_PARAM_BYTES,
        this.lineState.update(lineControls, this.frame),
      )
    }

    const enc = d.createCommandEncoder()
    const run = (p: Pass) => {
      if (p.when === undefined || p.when()) {
        const cp = enc.beginComputePass()
        cp.setPipeline(p.pl)
        cp.setBindGroup(0, p.bg)
        cp.dispatchWorkgroups(p.x, p.y)
        cp.end()
      }
    }
    for (const p of this.prePasses) run(p)
    for (let g = 0; g < gens; g++) {
      if (g > 0) {
        enc.copyBufferToBuffer(
          this.genParamsBuf,
          g * PARAM_BYTES,
          this.paramsBuf,
          0,
          PARAM_BYTES,
        )
        enc.copyBufferToBuffer(
          this.genLineParamsBuf,
          g * LINE_PARAM_BYTES,
          this.lineParamsBuf,
          0,
          LINE_PARAM_BYTES,
        )
      }
      for (const p of this.loopPasses) run(p)
    }
    // Put the frame's own params back. The loop above leaves `paramsBuf` holding
    // the LAST generation's copy, so every pass below would read gen = gens-1 —
    // harmless only for as long as nothing down here touches `P.gen`, which is
    // not an invariant anyone reading `decode` could be expected to know. The
    // receiver is not a tape generation; give it the frame it is decoding.
    if (gens > 1) {
      enc.copyBufferToBuffer(
        this.genParamsBuf,
        0,
        this.paramsBuf,
        0,
        PARAM_BYTES,
      )
    }
    // One decode dispatch per rendered frame, so frame parity is what alternates
    // the phosphor state buffers.
    this.decodePass.bg = this.decodeBgs[this.frame % 2]
    for (const p of this.postPasses) run(p)

    this.presentPass(enc)

    if (this.frame < 3) {
      d.pushErrorScope('validation')
      d.pushErrorScope('internal')
    }
    d.queue.submit([enc.finish()])
    if (this.frame < 3) {
      const f = this.frame
      void d
        .popErrorScope()
        .then(e => e && console.error(`frame ${f} internal:`, e.message))
      void d
        .popErrorScope()
        .then(e => e && console.error(`frame ${f} validation:`, e.message))
    }
    if (location.search.includes('debug')) {
      if (this.frame < 3) console.log('DEBUG rendered frame', this.frame)
      if (this.frame === 1) void this.debugReadback()
    }
    this.frame += 1
  }

  private async debugReadback(): Promise<void> {
    const d = this.gpu.device
    const read = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const enc = d.createCommandEncoder()
    enc.copyBufferToBuffer(this.compA, 0, read, 0, N * 4)
    d.queue.submit([enc.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const a = new Float32Array(read.getMappedRange())
    let min = Infinity
    let max = -Infinity
    for (const v of a) {
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    const midRow = 200
    const line = Array.from(
      a.slice(midRow * SAMPLES_PER_LINE, midRow * SAMPLES_PER_LINE + 200),
    ).map(v => Math.round(v))
    console.log(
      'DEBUG compA',
      JSON.stringify({ min, max, line200first200: line }),
    )
    read.unmap()
    read.destroy()
  }
}
