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
  TAPE_FRAMES,
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
import { valueNoise } from '../signal/noise'
import { RfState } from '../signal/rfstate'
import { TapeState, tapeRecording } from '../signal/tapeloop'
import { gpuPowerFromSearch, initGpu } from './context'
import { pageSearch } from './env'
import {
  GEN_OFFSET,
  PARAM_BYTES,
  PRELUDE,
  SCOPE_BYTES,
  SCOPE_N,
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
import encodeCompositeBSrc from './shaders/encode_composite_b.wgsl?raw'
import encodeYuvSrc from './shaders/encode_yuv.wgsl?raw'
import enhancerSrc from './shaders/enhancer.wgsl?raw'
import fbCompositeSrc from './shaders/fb_composite.wgsl?raw'
import feedSrc from './shaders/feed.wgsl?raw'
import lineAnalyzeSrc from './shaders/line_analyze.wgsl?raw'
import mixBSrc from './shaders/mix_b.wgsl?raw'
import presentSrc from './shaders/present.wgsl?raw'
import scopeDecaySrc from './shaders/scope_decay.wgsl?raw'
import storePrevSrc from './shaders/store_prev.wgsl?raw'
import syncSrc from './shaders/sync.wgsl?raw'
import syncMeasureSrc from './shaders/sync_measure.wgsl?raw'
import tapePlaySrc from './shaders/tape_play.wgsl?raw'
import tapeRecSrc from './shaders/tape_rec.wgsl?raw'
import timebaseSrc from './shaders/timebase.wgsl?raw'
import underDownSrc from './shaders/under_down.wgsl?raw'
import { Sources } from './sources'
import { VideoPump } from './videopump'

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { LineStateControls } from '../signal/linestate'
import type { Gpu, RenderTarget } from './context'
import type { DestroyOptions, EngineApi } from './engineapi'
import type { PumpedFrame } from './videopump'

const N = SAMPLES_PER_LINE * LINES
const LINE_PARAM_BYTES = LINES * 16
const MAX_GENS = 4

// Bent-crystal demod LO: how fast a detuned 3.58 MHz oscillator's phase error
// grows, per composite sample.
const loRadPerSample = (detuneKHz: number): number =>
  (2 * Math.PI * detuneKHz * 1e3) / SAMPLE_RATE

// Impulse interference arrives in storms, not rain: trains of hits with real
// quiet between flurries. A bursty aperiodic envelope on the random-hit rate —
// rectified-and-squared so the quiet stretches are genuinely silent — and
// deterministic in the frame count, so harness runs stay reproducible.
const impulseStorm = (t: number): number => {
  const e = Math.max(0, 0.4 + 1.3 * valueNoise(t * 0.6, 5))
  return e * e * (1 + 0.4 * valueNoise(t * 2.7, 9))
}

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

// Look a pass up in an array by its label. The graph test parses the pass
// arrays as literals, so a pass that needs its bind group swapped at render
// time still has to be constructed inline and found again afterwards.
const byLabel = (passes: Pass[], label: string): Pass => {
  const p = passes.find(q => q.label === label)
  if (p === undefined) throw new Error(`missing pass ${label}`)
  return p
}

const texDesc = (usage: number): GPUTextureDescriptor => ({
  size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
  format: 'rgba8unorm',
  usage,
})

export interface EngineOptions {
  // An audio graph to adopt rather than build. A media element binds to one
  // AudioContext for life, so an engine rebuilt under playing clips has to
  // inherit the graph they are already bound to — a fresh AudioContext could
  // never re-adopt them, and createMediaElementSource would throw on the first
  // routeMedia. See the device-loss rebuild in useEngine.
  audio?: AudioState
}

export class Engine implements EngineApi {
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
  private dbgView = Number(new URLSearchParams(pageSearch()).get('dbg') ?? 0)
  // ?debug: dev-only per-frame logging and the first-frame readback.
  private readonly debug = pageSearch().includes('debug')

  private gpu: Gpu
  private canvas: RenderTarget
  private frame = 0
  private filtersDirty = true
  private lineState = new LineState()
  // Not built here: an engine replacing a lost one inherits its predecessor's
  // graph, so ownership arrives through the constructor. See EngineOptions.
  readonly audioState: AudioState
  private mixState = new MixState()
  private modState = new ModState()
  private tapeState = new TapeState()
  private rfState = new RfState()
  private modSlots: ModSlot[] = []
  // bent-crystal demod LO phase error, accumulated per frame (radians)
  private scPhase = 0
  // picture-search crossing pattern phase, accumulated per frame (crossings)
  private shuttlePhase = 0
  // A's snow generator crawls on this instead of the frame counter, so a
  // paused A deck freezes its static — the crawl was on the tape
  private snowFrameA = 0
  // ignition train: sample offset of the next event, and the current period
  private impulseTrainPos = 0
  private impulseTrainStep = 0
  // slow motion: sim-time owed, in frames; a step fires when it reaches 1
  private simAcc = 0
  private paramScratch = new ArrayBuffer(PARAM_BYTES)
  private loop: RenderLoop
  private destroyed = false

  // Feed gates, shared by the pass when() predicates and renderFrame's
  // bind-group swap + uniform packing so the routing cannot drift from the
  // gating. A clean feed dispatches nothing and packs nothing.
  private readonly aFeedOn = (): boolean => {
    const c = this.controls
    return (
      c.aScramble > 0 ||
      c.aTermination !== 0 ||
      c.aNoiseIre > 0 ||
      c.aPolarity > 0 ||
      c.aPause > 0 ||
      c.aDropoutRate > 0
    )
  }

  // Who consumes B's materialized waveform: the dirty sum resamples it, and
  // the genlocked dissolve reads it at the output sample — only the PiP inset
  // still re-encodes from yuvB. b reaches the bus through the fader or (dirty
  // only) the ring mod, so with those at zero the buffer is never read.
  private readonly bWaveOn = (): boolean => {
    const c = this.controls
    return (
      this.sources.bEnabled &&
      (c.bGenlock < 0.5 ? c.bGain !== 0 || c.bRing !== 0 : c.bGain !== 0)
    )
  }

  private readonly bFeedOn = (): boolean => {
    const c = this.controls
    return (
      this.bWaveOn() &&
      (c.bScramble > 0 ||
        c.bTermination !== 0 ||
        c.bNoiseIre > 0 ||
        c.bPolarity > 0 ||
        c.bDropoutRate > 0 ||
        (c.bGenlock < 0.5 && c.bPause > 0))
    )
  }

  private paramsBuf: GPUBuffer
  private genParamsBuf: GPUBuffer
  private genLineParamsBuf: GPUBuffer
  // The two feeds' uniforms: the same Params struct as paramsBuf, but with the
  // per-source feed controls packed into the standard damage fields — so
  // feed.wgsl states each mechanism once and reads whichever source's values
  // its instance was bound to.
  private feedParamsA: GPUBuffer
  private feedParamsB: GPUBuffer
  private feedScratch = new ArrayBuffer(PARAM_BYTES)
  private filterBuf: GPUBuffer
  private yuvBuf: GPUBuffer
  private yuvBBuf: GPUBuffer
  private uvfBBuf: GPUBuffer
  private compA: GPUBuffer
  private compB: GPUBuffer
  // B materialized as a composite on its own raster (post-feed); mix_b's dirty
  // path resamples this rather than synthesizing B analytically.
  private bCompBuf: GPUBuffer
  private compPrev: GPUBuffer
  // The loop bin: a ring of composite frames the record head writes and the
  // play head reads a couple of seconds behind. Unlike compPrev this is a
  // medium, not a frame store — see tape_play.wgsl.
  private tapeBuf: GPUBuffer
  private chromaBuf: GPUBuffer
  private underBuf: GPUBuffer
  private lineInfoBuf: GPUBuffer
  private lineParamsBuf: GPUBuffer
  private timingBuf: GPUBuffer
  private syncMeasureBuf: GPUBuffer
  private audioBuf: GPUBuffer
  private scopeBuf: GPUBuffer
  // Phosphor state, ping-ponged: decode reads the light the screen is holding
  // out of one and writes the new state into the other, so its lateral scatter
  // sees settled neighbours rather than a buffer mid-overwrite.
  private persistBufs: [GPUBuffer, GPUBuffer]
  // The two encoders carry a bind-group pair like decode's: the second targets
  // the compB scratch so an engaged feed pass can damage the waveform into its
  // real destination. renderFrame swaps them off the same predicates that gate
  // the feed passes, so the routing and the gating cannot disagree.
  private encodeCompositePass: Pass
  private encodeCompositeBgs: [GPUBindGroup, GPUBindGroup]
  private encodeCompositeBPass: Pass
  private encodeCompositeBBgs: [GPUBindGroup, GPUBindGroup]
  private decodePass: Pass
  // Not in the three pass arrays: it belongs to the instrument, not the signal
  // path, and putting it there would claim the picture goes through it.
  private scopeDecayPass: Pass
  private decodeBgs: [GPUBindGroup, GPUBindGroup]

  // The two input slots: staging, capping, aspect and the noise generators all
  // live in there, so the chain below only sees two texture views.
  // Owns the <video> elements and turns them into bitmaps. Main-thread only by
  // nature, which is exactly why it is not part of Sources.
  private pump = new VideoPump()
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

  static async create(
    canvas: RenderTarget,
    opts: EngineOptions = {},
  ): Promise<Engine> {
    const gpu = await initGpu(canvas, gpuPowerFromSearch(pageSearch()))
    return new Engine(gpu, canvas, opts.audio ?? new AudioState())
  }

  private constructor(gpu: Gpu, canvas: RenderTarget, audio: AudioState) {
    this.gpu = gpu
    this.canvas = canvas
    this.audioState = audio
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
    const feedParams = (): GPUBuffer =>
      d.createBuffer({
        size: PARAM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    this.feedParamsA = feedParams()
    this.feedParamsB = feedParams()
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
    this.bCompBuf = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    this.compPrev = d.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    // Two bytes a sample, not four: the loop is the one buffer here big enough
    // for its precision to be a VRAM decision, and f16 buys twice the tape for
    // a resolution still far under the noise the medium has anyway.
    this.tapeBuf = d.createBuffer({
      size: TAPE_FRAMES * N * 2,
      usage: GPUBufferUsage.STORAGE,
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
    // per-line hoff + 8 persistent scalars (v-osc, PLL, AGC, the two
    // second-order gain servos — beam limiter and camera iris, gain + velocity
    // each — and the sync separator's lock age) + a per-raster-line sag
    this.timingBuf = d.createBuffer({
      size: (LINES * 2 + 8) * 4,
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
    // Vectorscope bins, filled by decode and read by present. Cleared rather
    // than decayed each frame: a scope's persistence is in the phosphor of the
    // instrument, and the picture already redraws at 60 Hz.
    this.scopeBuf = d.createBuffer({
      size: SCOPE_BYTES,
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
    const encodeCompositeBPl = compute(encodeCompositeBSrc)
    const feedPl = compute(feedSrc)
    const mixBPl = compute(mixBSrc)
    const fbCompositePl = compute(fbCompositeSrc)
    const storePrevPl = compute(storePrevSrc)
    const tapePlayPl = compute(tapePlaySrc)
    const tapeRecPl = compute(tapeRecSrc)
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
    // the record head writes a packed f16 pair per thread (see tape_rec)
    const perLineW = [Math.ceil(SAMPLES_PER_LINE / 2 / 64), LINES] as const
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
      // A's feed: when engaged, renderFrame points encodeComposite at the
      // compB scratch and this pass damages it into compA, so everything
      // downstream sees a fault on A's cable alone.
      pass(
        'feedA',
        feedPl,
        [
          { buffer: this.feedParamsA },
          { buffer: this.compB },
          { buffer: this.compA },
        ],
        perLine,
        this.aFeedOn,
      ),
      pass(
        'composeB',
        composeBPl,
        [{ buffer: this.paramsBuf }, this.sources.viewB()],
        perTile,
        // a paused B deck holds its frame, so the snow generator freezes too —
        // the crawl was on the tape, and the tape has stopped
        () => bOn() && this.sources.srcNoiseB > 0 && c.bPause === 0,
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
      // B as a real waveform on its own raster — the thing feedB damages and
      // the dirty sum resamples. Like encodeComposite above, renderFrame
      // retargets it at the compB scratch while B's feed is engaged.
      pass(
        'encodeCompositeB',
        encodeCompositeBPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.yuvBBuf },
          { buffer: this.uvfBBuf },
          { buffer: this.bCompBuf },
        ],
        perLine,
        this.bWaveOn,
      ),
      pass(
        'feedB',
        feedPl,
        [
          { buffer: this.feedParamsB },
          { buffer: this.compB },
          { buffer: this.bCompBuf },
        ],
        perLine,
        this.bFeedOn,
      ),
      pass(
        'mixB',
        mixBPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.yuvBBuf },
          { buffer: this.uvfBBuf },
          { buffer: this.compA },
          { buffer: this.bCompBuf },
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
      // The loop bin, patched across the mixer the way an outboard delay is: the
      // play head returns onto the bus, and the record head lays down the sum —
      // so anything still circulating is re-recorded once per lap and comes back
      // a generation older each time. Both heads sit ahead of the channel block,
      // because that block is the *deck's* playback damage and the loop is a
      // second machine with damage of its own.
      pass(
        'tapePlay',
        tapePlayPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.tapeBuf },
          { buffer: this.compA },
        ],
        perLine,
        () => c.tapeMix !== 0,
      ),
      pass(
        'tapeRec',
        tapeRecPl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.compA },
          { buffer: this.tapeBuf },
        ],
        perLineW,
        () => tapeRecording(c),
      ),
    ]
    // The two encoders keep their in-array bind groups (straight to their real
    // destination) as slot 0; slot 1 targets the compB scratch for the frames
    // where the feed pass sits in between. renderFrame swaps by the same
    // predicates that gate the feeds.
    this.encodeCompositePass = byLabel(this.prePasses, 'encodeComposite')
    this.encodeCompositeBgs = [
      this.encodeCompositePass.bg,
      bindGroup(encodeCompositePl, [
        { buffer: this.paramsBuf },
        { buffer: this.filterBuf },
        { buffer: this.yuvBuf },
        { buffer: this.compB },
      ]),
    ]
    this.encodeCompositeBPass = byLabel(this.prePasses, 'encodeCompositeB')
    this.encodeCompositeBBgs = [
      this.encodeCompositeBPass.bg,
      bindGroup(encodeCompositeBPl, [
        { buffer: this.paramsBuf },
        { buffer: this.yuvBBuf },
        { buffer: this.uvfBBuf },
        { buffer: this.compB },
      ]),
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
      { buffer: this.scopeBuf },
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
    const scopeDecayPl = compute(scopeDecaySrc)
    this.scopeDecayPass = {
      label: 'scopeDecay',
      pl: scopeDecayPl,
      bg: bindGroup(scopeDecayPl, [{ buffer: this.scopeBuf }]),
      x: Math.ceil((SCOPE_N * SCOPE_N) / 64),
      y: 1,
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
        { binding: 3, resource: { buffer: this.scopeBuf } },
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
    this.pump.setA(null)
    this.sources.setImageSource(source, aspect)
  }

  setVideoSource(el: HTMLVideoElement | null): void {
    if (el !== null) this.sources.setNoiseSource(0)
    this.pump.setA(el)
  }

  // A GPU-generated noise field (1 TV static, 2 VHS static); 0 restores the
  // texture path. Any real image/video source clears it.
  // A video frame decoded somewhere else. On the main thread the pump feeds
  // Sources directly; a worker-owned engine has no elements to pump, so frames
  // arrive here instead. Ownership of the bitmap passes in — Sources closes it.
  pushFrameA(f: PumpedFrame): void {
    // Same deal as pushFrameB below: a worker-owned engine has frames pushed
    // from outside, so A's pause gate lives here as well as in the pump.
    if (this.controls.aPause > 0) {
      f.bmp.close()
      return
    }
    this.sources.pushA(f)
  }

  pushFrameB(f: PumpedFrame): void {
    // A worker-owned engine has frames pushed from outside, so the B deck's
    // pause gate lives here as well as in the pump. Dropped frames must close
    // their bitmap — ownership arrived with the push.
    if (this.controls.bPause > 0) {
      f.bmp.close()
      return
    }
    this.sources.pushB(f)
  }

  setNoiseSource(kind: number): void {
    this.pump.setA(null)
    this.sources.setNoiseSource(kind)
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.pump.setB(null)
    this.sources.setImageSourceB(source)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    if (el !== null) this.sources.setNoiseSourceB(0)
    this.pump.setB(el)
  }

  setNoiseSourceB(kind: number): void {
    this.pump.setB(null)
    this.sources.setNoiseSourceB(kind)
  }

  setSourceBEnabled(on: boolean): void {
    this.sources.setSourceBEnabled(on)
  }

  // Whether B is summing into the picture. The flag lives in Sources rather than
  // in React (the panel's mode enum is a different question — 'none' is only one
  // of the ways B ends up off), so the rebuild path reads it back off the engine
  // it is replacing.
  get sourceBOn(): boolean {
    return this.sources.bEnabled
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
        { binding: 5, resource: { buffer: this.timingBuf } },
      ],
    })
  }

  // Idempotent, and deliberately keyed off its own flag rather than
  // `loop.running`: a loop stopped by the hang watchdog or by device loss is
  // precisely when the device most needs releasing, and gating on `running`
  // turned teardown into a no-op in exactly that case — so the HMR dispose hook
  // and the pagehide handler both silently leaked a whole GPUDevice, which is
  // what stacks up until Firefox's WebGPU wedges the tab.
  destroy(opts: DestroyOptions = {}): void {
    if (!this.destroyed) {
      this.destroyed = true
      this.loop.stop()
      // Stop reporting. Destroying the buffers below makes the frame already in
      // flight reference destroyed resources, and the `uncapturederror` that
      // raises is delivered asynchronously — so an engine torn down to make way
      // for a replacement would otherwise put "Buffer with '' label has been
      // destroyed" on the banner of the session that succeeded it. Nothing this
      // object has left to say is news to anyone.
      this.onStats = NOOP
      this.onGpuError = NOOP
      this.onDeviceLost = NOOP
      this.onHang = NOOP
      this.onFrozen = NOOP
      const bufs = [
        this.paramsBuf,
        this.genParamsBuf,
        this.genLineParamsBuf,
        this.feedParamsA,
        this.feedParamsB,
        this.filterBuf,
        this.yuvBuf,
        this.yuvBBuf,
        this.uvfBBuf,
        this.compA,
        this.compB,
        this.bCompBuf,
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
      this.pump.destroy()
      this.sources.destroy()
      // The audio graph is not the device's, so nothing above releases it — and
      // a mic left open keeps the browser's recording indicator lit long after
      // the picture is gone. `keepAudio` is the one case where that is wrong:
      // the successor engine is adopting the graph, and closing it would strand
      // every <video> already bound to its context.
      if (opts.keepAudio !== true) this.audioState.close()
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
      srcFrameA: this.snowFrameA,
      invert: c.invert,
      deint: c.deint,
      chromaGain: c.chromaGain,
      burstLock: c.burstLock,
      tint: (c.tintDeg * Math.PI) / 180,
      demodAxis: (c.demodAxisDeg * Math.PI) / 180,
      matrixClip: c.matrixClip,
      scDetunePhase: this.scPhase,
      scDetunePerSample: loRadPerSample(c.scDetuneKHz),
      killThresh: c.killThresh,
      accLines: c.accLagLines,
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
      vSize: c.vSize,
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
      audioHue: (c.audioHueDeg * Math.PI) / 180,
      noiseSigma: c.noiseIre,
      impulseRate: c.impulseRate * impulseStorm(this.frame / 60),
      impulseIre: c.impulseIre,
      impulseTrainPos: this.impulseTrainPos,
      impulseTrainStep: this.impulseTrainStep,
      impulseMains: c.impulseMains,
      strikeRate: c.strikeRate,
      ghostDelay: c.ghostDelayUs * 1e-6 * SAMPLE_RATE,
      ghostGain: c.ghostGain,
      humAmp: c.humAmp,
      humMod: c.humMod,
      colorUnderMix: c.colorUnderMix,
      chromaNoise: c.chromaNoiseIre,
      dropoutRate: c.dropoutRate,
      dropoutLen: c.dropoutLenUs * 1e-6 * SAMPLE_RATE,
      dropoutComp: c.dropoutComp,
      headSwitchNoise: c.headSwitchNoise,
      polarityFlip: c.polarityFlip,
      termination: c.termination,
      chromaPinOnly: c.chromaPinOnly,
      connectorGlitch: c.connectorGlitch,
      scramble: c.scramble,
      scrambleMode: c.scrambleMode,
      mvAgcIre: 160 * c.macrovision,
      mvStripe: (c.mvStripeDeg * Math.PI) / 180,
      vbi: c.vbi,
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
      fbIris: c.fbIris,
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
      cfbServo: c.cfbServoUs * 1e-6 * SAMPLE_RATE,
      cfbRing: c.cfbRing,
      tapeMix: c.tapeMix,
      tapeGain: c.tapeGain,
      tapeHfLoss: c.tapeHfLoss,
      tapeNoise: c.tapeNoiseIre,
      tapeWear: c.tapeWear,
      tapeSplice: c.tapeSplice,
      tapeHeads: c.tapeHeads,
      tapeHeadSpread: c.tapeHeadSpread,
      tapeColourFrame: c.tapeColourFrame,
      // Mistuning frees the sound carrier from its trap, so the buzz the
      // soundIre knob dials in deliberately arrives uninvited — same term,
      // two causes on one wire.
      soundIre: c.soundIre + 15 * Math.max(c.rfMistuneMHz, 0) ** 1.5,
      rfSoften: Math.min(Math.max(-c.rfMistuneMHz, 0), 1),
      rfIntermod: 0.22 * Math.max(c.rfMistuneMHz, 0),
      rfAdjIre: 18 * c.rfAdjacent,
      rfSnow: c.rfSnow,
      ingressIre: 11 * c.ingress,
      agc: c.agc,
      abl: c.abl,
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
      scope: c.scope,
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

  // Ignition train phase: events every SAMPLE_RATE/f samples, continuous
  // across frames, with the source's rate wandering like an engine revving —
  // which is what tilts the dash lattice live instead of freezing it.
  private advanceImpulseTrain(hz: number): void {
    if (hz <= 0) {
      this.impulseTrainStep = 0
      return
    }
    const fEff = hz * (1 + 0.25 * valueNoise((this.frame / 60) * 0.4, 3))
    this.impulseTrainStep = SAMPLE_RATE / fEff
    const m = this.impulseTrainStep
    this.impulseTrainPos = (((this.impulseTrainPos - N) % m) + m) % m
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
    this.pump.pump(
      this.sources,
      this.controls.aPause > 0,
      this.controls.bPause > 0,
    )
    if (this.frame % 30 === 0 && this.debug) {
      console.log('DEBUG frame', this.frame, {
        ...this.pump.info(),
        stagedPixelA: this.sources.stagedPixelA,
      })
    }
    if (this.filtersDirty) this.rebuildFilters()
    const c = this.controls
    this.advanceScPhase(c.scDetuneKHz)
    this.advanceShuttle(c.shuttleX)
    if (c.aPause === 0) this.snowFrameA += 1
    this.advanceImpulseTrain(c.impulseHz)
    const mixU = this.mixState.update({
      aPause: c.aPause,
      bLineHz: c.bLineHz,
      bDetuneHz: c.bDetuneHz,
      bRollLps: c.bRollLps,
      bPause: c.bPause,
      wipePos: c.wipePos,
      wipeRateHz: c.wipeRate,
    })
    // The transport runs whether or not the loop is faded up — a tape machine
    // left threaded keeps moving, so the splice does not stall at the head and
    // the loop still has whatever was last recorded on it when the fader comes
    // back up.
    const tapeU = this.tapeState.update(
      {
        tapeLoopMm: c.tapeLoopMm,
        tapeWowPct: c.tapeWowPct,
        tapeColourFrame: c.tapeColourFrame,
        tapeMix: c.tapeMix,
        tapeRecord: c.tapeRecord,
        tapeTransport: c.tapeTransport,
        tapeShuttle: c.tapeShuttle,
      },
      this.frame,
    )
    const vals = {
      ...this.uniformValues(),
      ...mixU,
      ...tapeU,
      // the adjacent channel's raster slip and beat phases, walked per frame
      ...this.rfState.update(this.frame),
    }
    packParams(vals, this.paramScratch)
    d.queue.writeBuffer(this.paramsBuf, 0, this.paramScratch)
    // Feed uniforms: the per-source fault controls packed into the standard
    // damage fields of a second Params buffer, so feed.wgsl states each
    // mechanism once. The gen offsets sit far above the dub generations
    // (0..MAX_GENS) purely to decorrelate each feed's noise seeds from the
    // program-bus channel's and from each other.
    if (this.aFeedOn()) {
      packParams(
        {
          ...vals,
          gen: 101,
          scramble: c.aScramble,
          scrambleMode: c.aScrambleMode,
          termination: c.aTermination,
          noiseSigma: c.aNoiseIre,
          polarityFlip: c.aPolarity,
          dropoutRate: c.aDropoutRate,
          dropoutLen: c.aDropoutLenUs * 1e-6 * SAMPLE_RATE,
          // A's paused deck rides the pause fields: feed.wgsl reads whichever
          // deck's servo state was packed here
          bPause: c.aPause,
          bPauseBar: mixU.aPauseBar,
          bShift0: mixU.aPauseShift,
          bRowOff: mixU.aPauseRow,
        },
        this.feedScratch,
      )
      d.queue.writeBuffer(this.feedParamsA, 0, this.feedScratch)
    }
    if (this.bFeedOn()) {
      packParams(
        {
          ...vals,
          gen: 102,
          scramble: c.bScramble,
          scrambleMode: c.bScrambleMode,
          termination: c.bTermination,
          noiseSigma: c.bNoiseIre,
          polarityFlip: c.bPolarity,
          dropoutRate: c.bDropoutRate,
          dropoutLen: c.bDropoutLenUs * 1e-6 * SAMPLE_RATE,
          // B's paused deck rides the same pause fields feedA uses — the
          // scatter and stripe land on B's own raster, so they roll with B
          // through the mix_b resample. Genlocked, the implied TBC strips the
          // timing damage, so the pause fields stay zero on that path.
          bPause: c.bGenlock < 0.5 ? c.bPause : 0,
          bPauseBar: mixU.bPauseBar,
          bShift0: mixU.bPauseShift,
          bRowOff: mixU.bPauseRow,
        },
        this.feedScratch,
      )
      d.queue.writeBuffer(this.feedParamsB, 0, this.feedScratch)
    }
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
    // Ages the trace before decode writes this frame's hits into it; see
    // scope_decay.wgsl for why it decays rather than clearing.
    if (c.scope > 0) run(this.scopeDecayPass)
    // An engaged feed sits between its encoder and the buffer downstream
    // passes read, so the encoder detours through the compB scratch.
    this.encodeCompositePass.bg =
      this.encodeCompositeBgs[this.aFeedOn() ? 1 : 0]
    this.encodeCompositeBPass.bg =
      this.encodeCompositeBBgs[this.bFeedOn() ? 1 : 0]
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
    if (this.debug) {
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
