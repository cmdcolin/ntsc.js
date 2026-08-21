import { CONTROL_KEYS, DEFAULT_CONTROLS, STOCK_HOLD } from '../controls'
import { Listeners } from '../listeners'
import { clamp, wrap } from '../math'
import { rngFor } from '../rng'
import { AudioState } from '../signal/audiostate'
import { ClipContact, clipPointAt } from '../signal/clip'
import {
  ACTIVE_HEIGHT,
  ACTIVE_WIDTH,
  LINES,
  SAMPLES_PER_LINE,
  SAMPLE_RATE,
  TAPE_FRAMES,
} from '../signal/constants'
import { advanceCrossings } from '../signal/crossings'
import { Fault } from '../signal/fault'
import { FILTER_STRIDE, NUM_SECTIONS } from '../signal/filters'
import { Glide } from '../signal/glide'
import { LineState } from '../signal/linestate'
import { MixState } from '../signal/mixstate'
import { driveAt, driveSlots, ModState } from '../signal/modstate'
import { valueNoise } from '../signal/noise'
import { RfState } from '../signal/rfstate'
import { StabGate } from '../signal/stab'
import { StrobeGate } from '../signal/strobe'
import { SynthState } from '../signal/synthstate'
import { TapeState, tapeRecording } from '../signal/tapeloop'
import { BuzzRead } from './buzzread'
import { gpuPowerFromSearch, initGpu, releaseGpu } from './context'
import { debugOn, pageSearch } from './env'
import { aFeedOn, bFeedOn, bOn, bWaveOn, FEEDS } from './feedgates'
import { designFilterBank } from './filterbank'
import { AutoLock } from './framelock'
import {
  GEN_OFFSET,
  PARAM_BYTES,
  PRELUDE,
  TILE_WG,
  packParams,
} from './prelude'
import { RenderLoop } from './renderloop'
import { Overlay } from './savedBoard'
import blitExtSrc from './shaders/blit_ext.wgsl?raw'
import buzzTapSrc from './shaders/buzz_tap.wgsl?raw'
import channelSrc from './shaders/channel.wgsl?raw'
import chromaExtractSrc from './shaders/chroma_extract.wgsl?raw'
import composeSrc from './shaders/compose.wgsl?raw'
import composeBSrc from './shaders/compose_b.wgsl?raw'
import crtFaceSrc from './shaders/crt_face.wgsl?raw'
import decodeSrc from './shaders/decode.wgsl?raw'
import encodeChromaBSrc from './shaders/encode_chroma_b.wgsl?raw'
import encodeCompositeSrc from './shaders/encode_composite.wgsl?raw'
import encodeCompositeBSrc from './shaders/encode_composite_b.wgsl?raw'
import enhancerSrc from './shaders/enhancer.wgsl?raw'
import fbCompositeSrc from './shaders/fb_composite.wgsl?raw'
import feedSrc from './shaders/feed.wgsl?raw'
import grainBakeSrc from './shaders/grain_bake.wgsl?raw'
import lineAnalyzeSrc from './shaders/line_analyze.wgsl?raw'
import mixBSrc from './shaders/mix_b.wgsl?raw'
import presentSrc from './shaders/present.wgsl?raw'
import storePrevSrc from './shaders/store_prev.wgsl?raw'
import syncSrc from './shaders/sync.wgsl?raw'
import syncMeasureSrc from './shaders/sync_measure.wgsl?raw'
import tapePlaySrc from './shaders/tape_play.wgsl?raw'
import tapeRecSrc from './shaders/tape_rec.wgsl?raw'
import timebaseSrc from './shaders/timebase.wgsl?raw'
import underDownSrc from './shaders/under_down.wgsl?raw'
import { Sources } from './sources'
import { loRadPerSample, uniformValues } from './uniforms'
import { VideoPump } from './videopump'

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { Rand } from '../rng'
import type { FaultPlan } from '../signal/fault'
import type { GlidePlan } from '../signal/glide'
import type { LineStateControls } from '../signal/linestate'
import type { DeckPause } from '../signal/mixstate'
import type { StabPlan } from '../signal/stab'
import type { Gpu, RenderTarget } from './context'
import type { DestroyOptions, EngineApi } from './engineapi'
import type { FeedSource } from './feedgates'
import type { ParamName } from './prelude'
import type { FrozenKind } from './renderloop'
import type { PullOpener, PumpedFrame, Relay, WrapHealth } from './videopump'

const N = SAMPLES_PER_LINE * LINES
const LINE_PARAM_BYTES = LINES * 16
const MAX_GENS = 4

// frameLock's last choice: pick the divisor from the loop's own cadence —
// the state machine that does the picking lives in framelock.ts.
const LOCK_AUTO = 4

// Frames between telling React where a morph has got to. See `glideNotify`.
const GLIDE_NOTIFY = 6

const FILTER_KEYS: ReadonlySet<ControlKey> = new Set<ControlKey>([
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

const texDesc = (
  usage: number,
  viewFormats: GPUTextureFormat[] = [],
): GPUTextureDescriptor => ({
  size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
  format: 'rgba8unorm',
  usage,
  viewFormats,
})

interface EngineOptions {
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
  private readonly controlListeners = new Listeners()
  // Kept apart from the above — see subscribeGlide for why the two cadences
  // cannot share a notify.
  private readonly glideListeners = new Listeners()
  private readonly statsListeners = new Listeners()
  // The last window the loop reported. Held as one object that is replaced
  // rather than mutated, because it is a useSyncExternalStore snapshot: React
  // compares by identity, so a mutated object would look like no change.
  private statsSnapshot: FrameStats = { fps: 0, lock: 1 }
  // The pending trailing notify (a rAF handle; 0 is none), and whether anything
  // was written after this frame's leading one. See emitControls.
  private notifyFrame = 0
  private notifyMissed = false
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
  onFrozen: (frozen: FrozenKind | null) => void = () => {}
  // Non-fatal GPU faults (uncaptured validation/oom, e.g. an over-large source
  // texture): surfaced to the panel banner instead of only the console, so a
  // wedged render loop shows a reason rather than looking frozen.
  onGpuError: (message: string) => void = () => {}
  // The device-level listener that feeds `onGpuError`, held so teardown can take
  // it back off a device this engine may not be the last to use.
  private onUncaptured = (e: Event) => {
    if (e instanceof GPUUncapturedErrorEvent) this.onGpuError(e.error.message)
  }

  // Initialized from ?dbg=; also switchable live via setDbgView (panel, Advanced).
  private dbgView = Number(new URLSearchParams(pageSearch()).get('dbg') ?? 0)
  // ?debug: dev-only per-frame logging and the first-frame readback.
  private readonly debug = debugOn()

  private gpu: Gpu
  private canvas: RenderTarget
  private frame = 0
  // The rate the clock below counts at, or null for the wall clock. The first
  // of the three things `startTake` holds still.
  //
  // Everything in the signal path that has a *rate* rather than a per-frame
  // step reads `now()`, and off the wall clock those are the five places where
  // "frame N is a function of N" stops being true: render the same take twice
  // and the strobe lands on different frames, because it landed on different
  // milliseconds. Under a take they are functions of the frame counter instead
  // (docs/EDITOR.md › _Fixed-framerate export_).
  private virtualFps: number | null = null
  // Where the counter was when the take started, or null outside one. A take
  // counts from zero — the virtual clock and `impulseStorm(frame / 60)` are
  // both functions of the counter, so "frame N" has to mean the take's Nth —
  // and `endTake` puts it back, which is the same "left as it was found" rule
  // `pauseLoop` already follows for the loop.
  private takeFrom: number | null = null
  // The dice every per-frame modulator draws from: the tape and capstan wow,
  // the stick-slip patches, the per-line grain, the bay's random walk and
  // sample-hold. `Math.random` live, and a seeded generator for the length of a
  // take — `rng.ts`'s convention, and docs/EDITOR.md › _Seeding_'s rule.
  //
  // Handed out as the bound `rand` below rather than directly, so the state
  // objects can be built once against a source switched underneath them.
  private dice: Rand = Math.random
  private readonly rand: Rand = () => this.dice()
  private filtersDirty = true
  private lineState = new LineState(this.rand)
  // Not built here: an engine replacing a lost one inherits its predecessor's
  // graph, so ownership arrives through the constructor. See EngineOptions.
  readonly audioState: AudioState
  private mixState = new MixState(this.rand)
  private modState = new ModState()
  private glide = new Glide(FILTER_KEYS)
  // Frames since React was last told where a morph has got to. A morph writes
  // every frame; telling React every frame would buy a full panel render per
  // frame (19ms with every row mounted), which is the morph paying for its own
  // stutter. Six frames is a tenth of a second: the sliders visibly travel,
  // which is half the point of watching a morph, and the cost is a tenth of what
  // notifying per frame would be.
  private glideNotify = 0
  private tapeState = new TapeState(this.rand)
  private rfState = new RfState()
  private synthState = new SynthState()
  // The blanking gate. Unlike the stab gate beside it this is a plain control
  // pair rather than part of the modulation bay, because it damages the picture
  // — a cut gun is a thing the set does — so it takes a row on the Beam stage
  // and travels in presets and links like every other fault.
  private strobeGate = new StrobeGate()
  private modSlots: ModSlot[] = []
  // Last frame's wire-on-wire drive, keyed `slot * 2 + (depth ? 0 : 1)`. A Map
  // rather than an array so the engine needs no constant for how many slots the
  // panel is offering, and cleared rather than rebuilt so a patched bay costs
  // no allocation a frame.
  private bayDrive = new Map<number, number>()
  // The bay's layer over the board (savedBoard.ts › Overlay) — reused frame to
  // frame, because a patched bay runs on *every* frame, where the stab below
  // only lands on the clean ones.
  private readonly modLayer = new Overlay(this.controls, FILTER_KEYS, () => {
    this.filtersDirty = true
  })
  // The stab gate: the whole look poked into a clean picture for a few tens of
  // milliseconds at a time. Off until something sets a rate, so a session that
  // has never touched it pays one wall-clock read a frame.
  private stabGate = new StabGate()
  private stab: StabPlan = { hz: 0, ms: 0 }
  // The board at the far end of that gate. Stock until a look is held there,
  // which is what turns the stab into a hard flip between two looks — see
  // `setStabBoard`, and signal/stab.ts for why a flip belongs to the gate rather
  // than to the bay. Held as our own copy: React never mutates the object it
  // hands over, and this is read on every gated frame for the life of the patch.
  private stabBoard: Controls = DEFAULT_CONTROLS
  // The stab's layer, so it can be handed back at the end of the frame. A clean
  // frame lays two hundred keys and this runs at frame rate on the thread that
  // is also feeding the GPU, which is the whole reason the record is reused
  // rather than rebuilt.
  //
  // It marks nothing, and that is the one place the three layers disagree:
  // `applyStab` marks the bank on the two edges of a cycle and on no frame in
  // between, because a layer that swaps the whole board and marked every filter
  // key in it would be a FIR redesign at the frame rate.
  private readonly stabLayer = new Overlay(this.controls, FILTER_KEYS, NOOP)
  // The transition in flight, or nothing — a few controls driven away from where
  // they rest and back, with one frame in the middle marked as the one to swap
  // the source on (signal/fault.ts). Written to and never read from, like the
  // bay and the stab beside it, and for the same reason: it is applied and
  // undone inside one frame, so it never reaches what React renders from.
  private readonly fault = new Fault()
  // The paperclip: a hand shorting a point inside the set, several times a
  // second, for as long as the metal is down (signal/clip.ts). Same shape as
  // the fault above and the same reason for living on the engine — it is
  // applied and undone inside one frame, so React never sees it.
  private readonly clip = new ClipContact()
  private readonly clipLayer = new Overlay(this.controls, FILTER_KEYS, () => {
    this.filtersDirty = true
  })
  private readonly faultLayer = new Overlay(this.controls, FILTER_KEYS, () => {
    this.filtersDirty = true
  })
  // bent-crystal demod LO phase error, accumulated per frame (radians)
  private scPhase = 0
  // picture-search crossing pattern phase, accumulated per frame (crossings)
  private shuttlePhase = 0
  // Tape time per deck: everything recorded on a deck's own medium crawls on
  // these instead of the frame counter, so a paused deck freezes it — the crawl
  // was on the tape, and a held frame re-reads one track. A's drives its snow
  // generator (compose) and both drive their feed's dropouts.
  private tapeFrame = { a: 0, b: 0 }
  // ignition train: sample offset of the next event, and the current period
  private impulseTrainPos = 0
  private impulseTrainStep = 0
  // slow motion: sim-time owed, in frames; a step fires when it reaches 1
  private simAcc = 0
  // Which refresh of the frame lock's cycle this is; renders happen at 0.
  private lockPhase = 0
  // frameLock 'auto': the cadence judge (framelock.ts), plus the divisor the
  // last render actually ran under, for the stats readout. Engine-internal —
  // auto never writes the control, the same way wipeRate drives wipePos
  // without moving the slider.
  private autoLock = new AutoLock()
  private lockDivLive = 1
  private paramScratch = new ArrayBuffer(PARAM_BYTES)
  private loop: RenderLoop
  private destroyed = false

  // The pass graph's gates, bound to this engine's live controls. The
  // predicates themselves are pure and live in feedgates.ts, where the
  // containment between them (bFeedOn ⊆ bWaveOn ⊆ bOn) is under test; these
  // are the closures the pass `when()` callbacks, the bind-group swap and the
  // uniform packing all share, so the routing cannot drift from the gating.
  private readonly aFeedOn = (): boolean => aFeedOn(this.controls)
  private readonly bWaveOn = (): boolean =>
    bWaveOn(this.controls, this.sources.bEnabled)
  private readonly bFeedOn = (): boolean =>
    bFeedOn(this.controls, this.sources.bEnabled)

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
  private uvfBBuf: GPUBuffer
  private compA: GPUBuffer
  private compB: GPUBuffer
  // B materialized as a composite on its own raster (post-feed); mix_b's dirty
  // path resamples this rather than synthesizing B analytically.
  private bCompBuf: GPUBuffer
  private compPrev: GPUBuffer
  // The delay loop: a ring of composite frames the record head writes and the
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
  private buzzBuf: GPUBuffer
  private buzzRead: BuzzRead
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
  private crtFacePass: Pass
  private crtFaceBgs: GPUBindGroup[]
  private decodeBgs: [GPUBindGroup, GPUBindGroup]

  // The two input slots: staging, capping, aspect and the noise generators all
  // live in there, so the chain below only sees two texture views.
  // Owns the <video> elements and turns them into bitmaps. Main-thread only by
  // nature, which is exactly why it is not part of Sources.
  private pump: VideoPump
  // The direct video path's two blits (A fit, B cover-crop), or null where the
  // device has no importExternalTexture — Firefox — in which case the pump
  // stays on its bitmap path and none of this exists. Guarded rather than
  // created unconditionally because a browser without the API has no reason to
  // accept `texture_external` in a shader module either.
  private blitFitPl: GPUComputePipeline | null = null
  private blitCropPl: GPUComputePipeline | null = null
  private sources: Sources
  private inputTex: GPUTexture
  private outTex: GPUTexture
  // The decoded frame rendered as a glowing CRT face (bloom/halation/glow).
  // Both the display and the feedback camera sample this, not the raw signal.
  private faceTex: GPUTexture
  private grainTex: GPUTexture
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
    // Every storage buffer is COPY_DST as well, whether or not the host ever
    // writes it, so `resetSignal` can clear the whole set back to what
    // `createBuffer` handed over. That is the only definition of "a known
    // signal state" that nobody has to invent — a WebGPU buffer is
    // zero-initialized, so zeroing one *is* putting a fresh engine's state
    // back. Clearing them by name instead would mean keeping a list of which
    // buffers carry state across a frame boundary, and being wrong about it
    // once (the tape ring, the two phosphor halves, the frame store, the PLL's
    // scalars, and the stale audio line nothing rewrites while the mic is off)
    // is a take that does not reproduce and no way to see why.
    const storage = (size: number, extra = 0): GPUBuffer =>
      d.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
      })
    this.filterBuf = storage(NUM_SECTIONS * FILTER_STRIDE * 4)
    // B's encoder-filtered chroma, one vec2f per sample (encode_chroma_b)
    this.uvfBBuf = storage(N * 8)
    this.compA = storage(N * 4, GPUBufferUsage.COPY_SRC)
    this.compB = storage(N * 4)
    this.bCompBuf = storage(N * 4)
    this.compPrev = storage(N * 4)
    // Two bytes a sample, not four: the loop is the one buffer here big enough
    // for its precision to be a VRAM decision, and f16 buys twice the tape for
    // a resolution still far under the noise the medium has anyway.
    this.tapeBuf = storage(TAPE_FRAMES * N * 2)
    this.chromaBuf = storage(N * 4)
    this.underBuf = storage(N * 4)
    this.lineInfoBuf = storage(LINES * 16)
    this.lineParamsBuf = storage(LINE_PARAM_BYTES)
    // per-line hoff + 8 persistent scalars (v-osc, PLL, AGC, the two
    // second-order gain servos — beam limiter and camera iris, gain + velocity
    // each — and the sync separator's lock age) + a per-raster-line sag
    this.timingBuf = storage((LINES * 2 + 8) * 4)
    this.syncMeasureBuf = storage(LINES * 16)
    // one audio sample per line, uploaded each frame
    this.audioBuf = storage(LINES * 4)
    // and the traffic in the other direction: one (mean, deviation) pair per
    // line, read back to the sound detector (buzz_tap.wgsl, signal/buzz.ts)
    this.buzzBuf = storage(LINES * 8, GPUBufferUsage.COPY_SRC)
    this.buzzRead = new BuzzRead(d, LINES * 8)
    // Phosphor persistence state: the light still on the glass, as linear-light
    // half floats — two u32 per pixel, RG then B. Not the rgba8 this used to be;
    // see the store's note in decode.wgsl for why an 8-bit encoded tail freezes
    // partway down instead of fading out.
    const persistBuf = (): GPUBuffer =>
      storage(ACTIVE_WIDTH * ACTIVE_HEIGHT * 8)
    this.persistBufs = [persistBuf(), persistBuf()]

    // Resizing A's texture invalidates the view compose's bind group holds, so
    // rebuild it. Only reachable after construction, via a set*Source*.
    this.sources = new Sources({
      device: d,
      onResizeA: () => {
        this.composePass.bg = this.makeComposeBg()
      },
    })
    // RENDER_ATTACHMENT on all three for the same reason the buffers are all
    // COPY_DST: it is what lets `resetSignal` clear them, through a render pass
    // whose `loadOp` is the clear. `faceTex` is the one that genuinely carries
    // state — the feedback camera photographs last frame's glass — and the
    // other two are cleared with it rather than reasoned about.
    const stateTex = (viewFormats?: GPUTextureFormat[]): GPUTexture =>
      d.createTexture(
        texDesc(
          GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT,
          viewFormats,
        ),
      )
    this.inputTex = stateTex()
    // The decoded screen carries the gun's cutoff and gamma sRGB-encoded while
    // they are active (decode.wgsl), and crtFace reads it through the sRGB
    // view so the sampler decodes it: the gathers then pay no pow per tap and
    // the byte keeps fine steps in the dark, where gamma puts the light.
    this.outTex = stateTex(['rgba8unorm-srgb'])
    this.faceTex = stateTex()
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
    const buzzTapPl = compute(buzzTapSrc)
    const syncPl = compute(syncSrc)
    const lineAnalyzePl = compute(lineAnalyzeSrc)
    const decodePl = compute(decodeSrc)
    const crtFacePl = compute(crtFaceSrc)

    // Zero-copy video: where the device can import the decoder's own frame
    // (Chrome), the pump skips createImageBitmap entirely and blit_ext samples
    // the frame straight into the slot texture. ?vidbitmap forces the bitmap
    // path so a harness can A/B the two on the same browser.
    const directVideo =
      typeof d.importExternalTexture === 'function' &&
      !pageSearch().includes('vidbitmap')
    if (directVideo) {
      const blitModule = module(blitExtSrc)
      const blit = (entryPoint: string) =>
        d.createComputePipeline({
          layout: 'auto',
          compute: { module: blitModule, entryPoint },
        })
      this.blitFitPl = blit('blit_fit')
      this.blitCropPl = blit('blit_crop43')
    }
    this.pump = new VideoPump(directVideo)

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
    // The phosphor grain is fixed to the glass, so it is baked once here and
    // read as a texel from then on (grain_bake.wgsl). Outside the pass arrays
    // like the video blit: it is not part of a frame.
    this.grainTex = d.createTexture({
      size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
    {
      const grainBakePl = compute(grainBakeSrc)
      const enc = d.createCommandEncoder()
      const cp = enc.beginComputePass()
      cp.setPipeline(grainBakePl)
      cp.setBindGroup(0, bindGroup(grainBakePl, [this.grainTex.createView()]))
      cp.dispatchWorkgroups(perTile[0], perTile[1])
      cp.end()
      d.queue.submit([enc.finish()])
    }
    const c = this.controls
    // What mixB can actually change, and so what the whole source-B chain is
    // dispatched for; see feedgates.ts, which holds it alongside the two
    // narrower gates it has to contain.
    const bChainOn = () => bOn(c, this.sources.bEnabled)

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
        'encodeComposite',
        encodeCompositePl,
        [
          { buffer: this.paramsBuf },
          { buffer: this.filterBuf },
          this.inputTex.createView(),
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
        () => bChainOn() && this.sources.srcNoiseB > 0 && c.bPause === 0,
      ),
      pass(
        'encodeChromaB',
        encodeChromaBPl,
        [
          { buffer: this.filterBuf },
          this.sources.viewB(),
          { buffer: this.uvfBBuf },
        ],
        perPixelT,
        bChainOn,
      ),
      // B as a real waveform on its own raster — the thing feedB damages and
      // the dirty sum resamples. Like encodeComposite above, renderFrame
      // retargets it at the compB scratch while B's feed is engaged.
      pass(
        'encodeCompositeB',
        encodeCompositeBPl,
        [
          { buffer: this.paramsBuf },
          this.sources.viewB(),
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
          this.sources.viewB(),
          { buffer: this.uvfBBuf },
          { buffer: this.compA },
          { buffer: this.bCompBuf },
          // the mixer loop's bus, for the keyer's fill input — the same buffer
          // fbComposite crossfades from a few passes later
          { buffer: this.compPrev },
        ],
        perLine,
        bChainOn,
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
      // The delay loop, patched across the mixer the way an outboard unit is: the
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
        this.inputTex.createView(),
        { buffer: this.compB },
      ]),
    ]
    this.encodeCompositeBPass = byLabel(this.prePasses, 'encodeCompositeB')
    this.encodeCompositeBBgs = [
      this.encodeCompositeBPass.bg,
      bindGroup(encodeCompositeBPl, [
        { buffer: this.paramsBuf },
        this.sources.viewB(),
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
      // The sound detector's tap, reading the same waveform sync is about to
      // lock to. Gated hard: it is the app's only steady-state readback, so a
      // listener who has not asked for buzz pays nothing for it.
      pass(
        'buzzTap',
        buzzTapPl,
        [{ buffer: this.compA }, { buffer: this.buzzBuf }],
        perRow,
        () => this.buzzDrive() > 0,
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
          this.grainTex.createView(),
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
    // Plain view while the gun transfer is off, sRGB view while it is on —
    // the same predicate decode encodes by (prelude gunOn).
    this.crtFacePass = byLabel(this.postPasses, 'crtFace')
    this.crtFaceBgs = [
      this.crtFacePass.bg,
      bindGroup(crtFacePl, [
        { buffer: this.paramsBuf },
        this.outTex.createView({
          format: 'rgba8unorm-srgb',
          usage: GPUTextureUsage.TEXTURE_BINDING,
        }),
        this.linearSamp,
        this.faceTex.createView(),
        { buffer: this.timingBuf },
        this.grainTex.createView(),
      ]),
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
      onStats: s => {
        this.statsSnapshot = s
        this.statsListeners.emit()
        this.onStats(s)
      },
      lockDiv: () => this.lockDivLive,
      onHang: () => this.onHang(),
      recover: () => this.recoverSurface(),
      onFrozen: f => this.onFrozen(f),
      frameNo: () => this.frame,
    })

    // Faults the error scopes don't catch (they only wrap startup frames) land
    // here — chiefly an over-large source texture on a fresh pick — so report
    // them to the UI rather than let the loop wedge silently.
    //
    // Kept as a field so `destroy` can take it off again. That is not tidiness: a
    // device now outlives the engine that made it (`keepDevice`), so a listener
    // left behind would accumulate one dead engine per hot update and report every
    // GPU error once per generation.
    this.gpu.device.addEventListener('uncapturederror', this.onUncaptured)

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
    // A hand on a knob ends a morph. Not because the two cannot coexist —
    // the glide only writes the keys it is moving — but because they would fight
    // over that key for the rest of the flight, and the slider would crawl back
    // out from under the finger. Whoever grabbed a control has taken the wheel.
    this.glide.stop()
    this.controls[key] = value
    if (FILTER_KEYS.has(key)) this.filtersDirty = true
    this.emitControls()
  }

  applyControls(patch: Partial<Controls>): void {
    // Same rule as setControl: an outright write of a look supersedes a morph
    // towards one. (startGlide does not come through here — it hands over a
    // destination, not a patch.)
    this.glide.stop()
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
  readonly subscribeControls = this.controlListeners.subscribe

  // What every rate in the signal path measures itself against.
  //
  // Live this is the wall clock, which is right: a strobe you count along with
  // has to be that rate whatever the panel is doing, and a morph you are
  // watching should take the seconds it says. Under a virtual clock it is the
  // frame counter in milliseconds, and the same five readers become pure
  // functions of the frame — which is the whole of what `frame N is a function
  // of N` was missing.
  //
  // One method rather than a threaded argument because the readers are five
  // unrelated places in the frame, and an argument each is five chances to pass
  // the wrong one. `strobeGate`'s own comment argues *for* the wall clock, and
  // it is right — for live. Offline the output timebase is the honest one, and
  // that is exactly the inversion this switch is.
  private now(): number {
    return this.virtualFps === null
      ? performance.now()
      : (this.frame * 1000) / this.virtualFps
  }

  // The resting board, which is not the same thing as the board this frame was
  // rendered from. The bay and the stab write the live controls and unwind them
  // inside one frame without ever calling `emitControls`, so what comes back here
  // is the look you dialled in rather than the look on screen this instant —
  // right for a panel, and a trap for anything trying to *observe* modulation.
  // A probe polling this to watch an LFO move, or to catch the bay failing to
  // hand a control back, is reading a copy the bay never touches: it reports a
  // flat line either way. Poke any control first (that re-snapshots), or read
  // `engine.controls` directly.
  readonly getControls = (): Controls => this.snapshot

  // Leading edge now, everything else in the frame folded into one trailing
  // notify. The snapshot itself is always refreshed synchronously — the frame
  // being submitted has to see the write, and so does the next `getControls()`
  // whoever asks — so this defers only *telling React*.
  //
  // The leading edge is not an optimization, it is what makes deferring safe at
  // all: a slider is a controlled input, and React restores the DOM value from
  // the last rendered props when an input event doesn't re-render. Notify a
  // pointer-driven write late and the thumb snaps back under the finger for a
  // frame. A drag produces at most one event per frame, so it never reaches the
  // trailing path; MIDI is what does — a Twister sends far faster than 60 Hz,
  // and every message used to buy its own full panel render.
  private emitControls(): void {
    this.snapshot = { ...this.controls }
    if (this.notifyFrame !== 0) {
      this.notifyMissed = true
      return
    }
    this.notifyFrame = requestAnimationFrame(this.flushNotify)
    this.controlListeners.emit()
  }

  private readonly flushNotify = (): void => {
    this.notifyFrame = 0
    // Re-entering emitControls rather than notifying here: it re-arms the
    // window, so a sustained storm settles at two renders a frame instead of
    // one render plus one per message.
    if (this.notifyMissed) {
      this.notifyMissed = false
      this.emitControls()
    }
  }

  // Take the board to `plan.to` over `plan.seconds` instead of landing on it.
  // See signal/glide.ts for what travels, what cuts, and what is left alone.
  //
  // The origin is this engine's live controls, deliberately not passed in: a
  // morph started while one is already running has to set off from where the
  // picture *is*, and the React snapshot lags by up to `GLIDE_NOTIFY` frames.
  // That is what makes rolls chain — hit surprise repeatedly and the look wanders
  // continuously rather than snapping back to the last resting one each time.
  startGlide(plan: GlidePlan): void {
    this.glide.start(this.controls, plan, this.now())
    this.glideNotify = 0
    // On this call rather than on the first frame, so the readout is up before
    // the picture has moved. The gap is one frame and it is the wrong frame to
    // be missing: it is the one where somebody is asking whether the button
    // they just pressed did anything.
    this.notifyGlide()
  }

  // Leave the board wherever the morph had got to. The half-way look is a look;
  // it is the sliders' business now.
  stopGlide(): void {
    this.glide.stop()
    this.emitControls()
    this.notifyGlide()
  }

  // The morph's own useSyncExternalStore pair, deliberately separate from the
  // controls one above rather than folded into it. They differ in who listens:
  // every control write is heard by App, which builds the whole panel, so
  // `emitControls` is throttled to one notify per GLIDE_NOTIFY frames while a
  // morph runs. Nothing that moves at the frame rate can be published through
  // it. This one is heard only by the readout in the look bar — one button — so
  // it fires every frame and stays honest.
  readonly subscribeGlide = this.glideListeners.subscribe

  // How far along a morph is, 0..1, or null if none is running. A primitive on
  // purpose: useSyncExternalStore compares snapshots by identity, and two equal
  // numbers are `===`, so the frames where nothing moved cost no render.
  readonly getGlide = (): number | null =>
    this.glide.running ? this.glide.progress : null

  private notifyGlide(): void {
    this.glideListeners.emit()
  }

  // The frame rate as a store, for the same reason the morph is one: the loop
  // reports a window four times a second, and the readout that draws it is one
  // element in the masthead. Held in App's state instead — which it was — every
  // report reconciles the whole panel, so the monitor perturbs the very thing it
  // exists to measure. Subscribed by nobody when it is closed, and then the
  // notify below is a walk over an empty set.
  //
  // `onStats` survives alongside this and is not superseded by it: the vote page
  // drives two engines from its own handler, and panelcheck.mjs reads the field
  // off `window.vf`. A store answers "what is the rate now", a callback answers
  // "tell me when" — the two pages want different ones.
  readonly subscribeStats = this.statsListeners.subscribe

  readonly getStats = (): FrameStats => this.statsSnapshot

  // The look a running morph is travelling to, or null. Asked of the engine
  // rather than remembered by the caller because the engine is the only one
  // that knows a morph has been cancelled — a slider, a MIDI message or an
  // outright applyControls all stop one, and a remembered destination would
  // outlive that and hand back a look the board never reached.
  glideTarget(): Controls | null {
    return this.glide.target
  }

  // One frame of a morph, if one is running. Ahead of applyMod, so modulation
  // wiggles around the value the morph has reached rather than around a resting
  // value the board has left — and applyMod's restore puts back the glided
  // value, not the pre-morph one, because the glide has already written it.
  private advanceGlide(): void {
    if (!this.glide.running) return
    const step = this.glide.apply(this.controls, this.now())
    if (step.coarseMoved) this.filtersDirty = true
    // Every frame, unthrottled — one button re-renders. The landing frame is
    // the one that matters most: `apply` has already stopped the glide by now,
    // so this is what takes the readout down.
    this.notifyGlide()
    // React hears about the landing frame no matter what — the destination is a
    // real look that saved looks, links and the recipe chips all have to agree on —
    // and about the flight only every GLIDE_NOTIFY frames.
    this.glideNotify++
    if (step.done || this.glideNotify >= GLIDE_NOTIFY) {
      this.glideNotify = 0
      this.emitControls()
    }
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

  setVideoRegion(region: { start: number; end: number } | null): void {
    this.pump.setRegionA(region)
  }

  setVideoRelay(relay: Relay | null): void {
    this.pump.setRelayA(relay)
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

  setVideoRegionB(region: { start: number; end: number } | null): void {
    this.pump.setRegionB(region)
  }

  setVideoRelayB(relay: Relay | null): void {
    this.pump.setRelayB(relay)
  }

  setVideoPullOpener(open: PullOpener | null): void {
    this.pump.setPullOpener(open)
  }

  // Stage each deck's picture for take frame `frame`, and wait for it. The one
  // thing an offline render does that a live frame cannot: see `pullFrames`.
  pullVideo(frame: number): Promise<void> {
    return this.pump.pullFrames(frame)
  }

  loopHealth(): { a: WrapHealth; b: WrapHealth } {
    return this.pump.health()
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

  // One direct-path video blit: import the decoder's frame and sample it into
  // the slot texture. The bind group is per-frame by nature — an external
  // texture is only valid for the task that imported it — which is the pattern
  // importExternalTexture is optimized for.
  private blitExt(
    enc: GPUCommandEncoder,
    pl: GPUComputePipeline,
    el: HTMLVideoElement,
    view: GPUTextureView,
    w: number,
    h: number,
  ): void {
    const d = this.gpu.device
    const bg = d.createBindGroup({
      layout: pl.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: d.importExternalTexture({ source: el }) },
        { binding: 1, resource: this.linearSamp },
        { binding: 2, resource: view },
      ],
    })
    const cp = enc.beginComputePass()
    cp.setPipeline(pl)
    cp.setBindGroup(0, bg)
    cp.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    cp.end()
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

  // Every GPU resource this engine owns, as one list each, because two callers
  // want the whole set and for opposite reasons: `destroy` hands them back, and
  // `resetSignal` clears them. Two hand-kept lists would drift the first time a
  // buffer was added, and the failure that drift causes is silent in both
  // directions — a leaked buffer per rebuild, or a take that carries a stale
  // ring nobody thought to zero.
  private allBufs(): GPUBuffer[] {
    return [
      this.paramsBuf,
      this.genParamsBuf,
      this.genLineParamsBuf,
      this.feedParamsA,
      this.feedParamsB,
      this.filterBuf,
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
      this.buzzBuf,
      ...this.persistBufs,
    ]
  }

  // How hard the picture is pushing on the sound. The slider is the limiter's
  // own failure and stands alone — a well-tuned set still buzzes on peak white
  // — while mistuning frees the carrier and makes it worse, which is the same
  // term `uniformValues` folds into `soundIre` for the visible half. One cause,
  // two symptoms, one knob moving both.
  private buzzDrive(): number {
    const c = this.controls
    return Math.min(1.5, c.buzzLevel + 0.6 * Math.max(c.rfMistuneMHz, 0))
  }

  private allTexs(): GPUTexture[] {
    return [this.inputTex, this.outTex, this.faceTex, this.grainTex]
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
      // A trailing control notify outlives the engine otherwise, and fires into
      // listeners belonging to a page that has moved on.
      if (this.notifyFrame !== 0) cancelAnimationFrame(this.notifyFrame)
      this.notifyFrame = 0
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
      for (const b of this.allBufs()) b.destroy()
      for (const t of this.allTexs()) t.destroy()
      // Its staging buffers are not in allBufs — they are the readback's own,
      // and one of them is usually mapped or mid-map when this runs.
      this.buzzRead.destroy()
      this.pump.destroy()
      this.sources.destroy()
      // The audio graph is not the device's, so nothing above releases it — and
      // a mic left open keeps the browser's recording indicator lit long after
      // the picture is gone. `keepAudio` is the one case where that is wrong:
      // the successor engine is adopting the graph, and closing it would strand
      // every <video> already bound to its context.
      if (opts.keepAudio !== true) this.audioState.close()
      this.gpu.device.removeEventListener('uncapturederror', this.onUncaptured)
      // Frees everything else the device owns (pipelines, bind groups) and drops
      // the swap-chain configuration.
      //
      // `keepDevice` is the successor adopting it instead, and the buffers and
      // textures above have already been handed back individually, so what is kept
      // is the device object and not the memory. Without it, `releaseGpu` drops the
      // device rather than destroying it: destroying one that has been presenting
      // is what ends the tab's rendering step, and this engine has been presenting
      // by definition.
      if (opts.keepDevice !== true) releaseGpu(this.gpu.device)
    }
  }

  // Manual frame step for the verification harness (rAF is throttled in
  // occluded windows). Forces a full sim step regardless of timeScale and the
  // frame lock so stepping stays deterministic.
  step(): void {
    this.simAcc = 1
    this.lockPhase = -1
    this.render()
  }

  private rebuildFilters(): void {
    this.gpu.device.queue.writeBuffer(
      this.filterBuf,
      0,
      designFilterBank(this.controls),
    )
    this.filtersDirty = false
  }

  // One feed's uniforms: that source's fault controls packed into the standard
  // damage fields of its own Params buffer, so feed.wgsl states each mechanism
  // once and reads whichever source it was bound to. The paused deck rides the
  // bPause* fields the same way — they name B only because B's deck got the
  // button first; a feed reads them as "this deck's servo state".
  private packFeed(
    src: FeedSource,
    vals: Record<ParamName, number>,
    buf: GPUBuffer,
    deck: DeckPause,
  ): void {
    const c = this.controls
    const f = FEEDS[src]
    packParams(
      {
        ...vals,
        gen: f.gen,
        // this deck's tape time, so its dropouts freeze when it is paused
        srcFrame: this.tapeFrame[src],
        scramble: c[f.scramble],
        scrambleMode: c[f.scrambleMode],
        termination: c[f.termination],
        noiseSigma: c[f.noise],
        polarityFlip: c[f.polarity],
        // These two override a program-bus knob that feed.wgsl also reads, so
        // leaving either out would put the bus's ground loop and the bus's bad
        // plug onto both feeds as well as the output.
        humAmp: c[f.hum],
        connectorGlitch: c[f.connector],
        connectorMode: c[f.connectorMode],
        dropoutRate: c[f.dropoutRate],
        dropoutLen: c[f.dropoutLen] * 1e-6 * SAMPLE_RATE,
        bPause: deck.pause,
        bPauseBar: deck.bar,
        bShift0: deck.shift,
        bRowOff: deck.row,
      },
      this.feedScratch,
    )
    this.gpu.device.queue.writeBuffer(buf, 0, this.feedScratch)
  }

  private uniformValues() {
    const c = this.controls
    return uniformValues(c, {
      frame: this.frame,
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      srcAspect: this.sources.srcAspect,
      srcNoise: this.sources.srcNoise,
      srcNoiseB: this.sources.srcNoiseB,
      srcFrame: this.tapeFrame.a,
      // Wall clock, not the frame counter: a strobe you count along with has to
      // be that rate under a frame lock and on a 144 Hz panel (signal/strobe.ts).
      beamBlank: this.strobeGate.step(
        { hz: c.strobeHz, ms: c.strobeMs },
        this.now(),
      ),
      scPhase: this.scPhase,
      audioHit: this.audioState.hit,
      audioLevel: this.audioState.level,
      impulseTrainPos: this.impulseTrainPos,
      impulseTrainStep: this.impulseTrainStep,
      shuttlePhase: this.shuttlePhase,
      dbgView: this.dbgView,
    })
  }

  // Re-arm the render loop after a transition (fullscreen exit, tab re-shown)
  // that can leave the browser having stopped delivering rAF callbacks.
  kick(): void {
    this.loop.kick()
  }

  // Whether this engine's device ever completed submitted work — read by the
  // rebuild policy after a hang, to tell a device that worked and then stopped
  // from one that was never alive. See RenderLoop.confirmedWork.
  get gpuConfirmed(): boolean {
    return this.loop.confirmedWork
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

  // Everything a take needs held still (docs/EDITOR.md › _Take state_): time
  // counted in frames at `fps`, dice drawn from `seed`, and a signal path
  // starting where a fresh engine's does.
  //
  // This is what turns "the same take from the same starting state is the same
  // take" into "the same take is the same take". Frame N was already a function
  // of N *and of the state the engine was in at frame zero* — the tape ring,
  // the phosphor still on the glass, the PLL's lock age, the two servos — and
  // nothing captured that state, so two renders with the live loop running
  // between them came out about 5% apart (`scripts/rendercheck.mjs` measured it
  // and declined to assert otherwise). Frame zero is now the same frame zero
  // every time, and the harness asserts the two files match byte for byte.
  //
  // A mode rather than how the app boots: live, the wall clock is the right
  // answer for all five readers and unseeded is the right answer for the dice —
  // a session nobody is recording should not walk one fixed sequence from page
  // load, and a strobe measured in frames drifts against the room the moment
  // the tab drops one.
  startTake(take: { fps: number; seed: number }): void {
    // `??=`, so starting a take inside one keeps the first origin rather than
    // banking the zero the first reset left. A second `startTake` is a
    // legitimate thing to do — it is how a harness renders two takes back to
    // back — and it should not be how the counter gets lost.
    this.takeFrom ??= this.frame
    this.dice = rngFor(take.seed)
    this.virtualFps = take.fps
    // The fourth thing, and the one that arrived last: the video. Every reader
    // above counts frames, and until this line the *pictures* still advanced at
    // whatever rate the browser played them at — so a take was a function of N
    // in everything except the one input a viewer actually looks at. It belongs
    // in this switch for the reason the switch exists: flipping three of four
    // gives a take that looks deterministic and is not.
    this.pump.setTakeFps(take.fps)
    this.resetSignal()
  }

  // Back to live, and the engine left as it was found — which is the contract
  // `ui/render.ts` already keeps for the loop, extended to the counter a take
  // rewound.
  //
  // It deliberately does not reset the signal path a second time. What the
  // render left on the tape and on the glass is the picture on screen when the
  // button goes back to ⎙, and blanking it on the way out would be the render
  // tidying away something the user is looking at. A take starts from a known
  // state; it does not have to end at one.
  endTake(): void {
    this.virtualFps = null
    this.dice = Math.random
    // Which closes the decoders as well as handing the decks back to their
    // elements. A picture left on a slot stays there — the live pump will
    // replace it on its first frame — so this is the same "left as it was
    // found" rule the counter below follows, not a tidy-up of the screen.
    this.pump.setTakeFps(null)
    if (this.takeFrom !== null) this.frame = this.takeFrom
    this.takeFrom = null
  }

  // Nothing on the tape, nothing left on the glass, no lock, frame zero.
  //
  // Every buffer and texture rather than the handful that carry state, for the
  // reason `storage` in the constructor gives: this is the constructed state by
  // definition, and it cannot be wrong about which those are. The CPU-side
  // modulators are the same statement in the other language — a fresh object
  // each, drawing from whichever dice `startTake` has just put in place.
  private resetSignal(): void {
    const d = this.gpu.device
    const enc = d.createCommandEncoder()
    for (const b of this.allBufs()) enc.clearBuffer(b)
    // A render pass whose only job is its `loadOp` — no shader and no bind
    // group, which is why the three textures carry RENDER_ATTACHMENT.
    for (const t of this.allTexs()) {
      enc
        .beginRenderPass({
          colorAttachments: [
            {
              view: t.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        })
        .end()
    }
    d.queue.submit([enc.finish()])

    this.lineState = new LineState(this.rand)
    this.mixState = new MixState(this.rand)
    this.tapeState = new TapeState(this.rand)
    this.modState = new ModState()
    this.bayDrive.clear()
    this.rfState = new RfState()
    this.synthState = new SynthState()
    this.strobeGate = new StrobeGate()
    this.stabGate = new StabGate()
    this.autoLock = new AutoLock()
    // A morph in flight is state stamped on the wall clock, and the take is
    // about to count from zero: left running, `now() - startMs` goes hugely
    // negative and the morph parks on its origin look for the whole render. The
    // board keeps the values it reached; what stops is the walk to the rest.
    this.glide.stop()
    // Same for a transition in flight: it is a span measured in frames, and the
    // counter is about to go back to zero underneath it.
    this.fault.stop()
    this.scPhase = 0
    this.shuttlePhase = 0
    this.tapeFrame = { a: 0, b: 0 }
    this.impulseTrainPos = 0
    this.impulseTrainStep = 0
    this.simAcc = 0
    this.lockPhase = 0
    this.frame = 0
    // Designed from a board that has not moved, but into a buffer that has just
    // been cleared with everything else.
    this.filtersDirty = true
  }

  // Take the frames away from rAF and hand them to whoever asked. Answers
  // whether the loop was in fact running, so the caller can put it back the way
  // it found it and not merely the way it assumed.
  //
  // This is the last thing an offline render needed and neither of the two
  // steps before it supplied. `step()` forces a sim step past `timeScale` and
  // the frame lock, so frames can always be pulled by hand — but while the rAF
  // loop is *also* running it advances the counter underneath, and two runs of
  // the same take step different totals. The virtual clock then faithfully
  // reports a different time for each. Determinism needs the clock and the
  // loop, and this is the loop.
  //
  // **Not a destroy, and nothing near one.** The device is untouched and the
  // loop is restartable by construction — `start()` resets every field a
  // previous run could have dirtied, so a resumed loop cannot inherit a stale
  // stall flag. See adr/0004 for what the tidier-looking teardown costs.
  pauseLoop(): boolean {
    const was = this.loop.running
    if (was) this.loop.stop()
    return was
  }

  resumeLoop(): void {
    if (!this.loop.running) this.loop.start()
  }

  // What the clock currently reads, in milliseconds — for a harness that needs
  // to prove the switch took, since every effect of it is otherwise a pixel.
  clockMs(): number {
    return this.now()
  }

  // Bender's modulation: LFOs / random walks / audio envelopes wiggle controls
  // around their slider settings, the way bent hardware has oscillators and
  // hands patched into pots. Applied by mutating `controls` for the duration
  // of one frame and restoring after, so uniforms, filter design, and pass
  // gating all see the modulated value while React, presets, and saved looks keep
  // the resting one (the same takeover semantics as MIDI).
  // Strike one routing's one-shot envelope, or every one in the bay. Unlike
  // every other way the bay is driven this is an *event*, not a setting, which
  // is why it is a method rather than another field on ModSlot: a fired flag
  // living in the slot list would have to be cleared by whoever set it, and the
  // list is rewritten by presets, links and undo.
  fireMod(id?: number, level = 1): void {
    if (id === undefined) this.modState.fireAll(this.modSlots, level)
    else this.modState.fire(id, level)
  }

  setModSlots(slots: ModSlot[]): void {
    this.modSlots = slots
  }

  // The stab gate: how often the look is poked into an otherwise clean picture,
  // and for how long. `hz` at 0 is off — the look runs continuously, which is
  // what every session that has not touched this has. Written to and never read
  // from, exactly like the modulation bay and for the same reason: it is applied
  // and undone inside one frame, so React has to be the store.
  setStab(stab: StabPlan): void {
    this.stab = stab
  }

  // The board the gate flips to. null is stock, which is what the gate has
  // always done and what every session that never holds a look gets.
  //
  // Same contract as `setStab` above — written to, never read from, applied and
  // undone inside one frame — with one addition that matters: this is the *only*
  // board in the engine that is not the live one, so it is copied on the way in.
  // Holding React's object would make a look someone held ten minutes ago
  // vulnerable to anything that ever mutates state in place, and the failure
  // would be a flip that quietly drifted toward the live board.
  setStabBoard(board: Controls | null): void {
    this.stabBoard = board === null ? DEFAULT_CONTROLS : { ...board }
  }

  // Run a transition: break the controls a recipe names, fire `onCut` on the
  // frame the picture is least legible, and heal (signal/fault.ts, and
  // docs/EDITOR.md › _Transitions_ for what a transition is here).
  //
  // A plan handed over once rather than a curve React draws, which is the same
  // contract `setStab` and the bay already keep and for a sharper reason: the
  // obvious spelling is a rAF loop in the panel writing `preview()` sixty times
  // a second, and that is React work at frame rate on the one path that must not
  // have any. It is also wrong offline, where there is no rAF and a frame is not
  // a millisecond — here it is frame-clocked, so it is already right under a
  // take's virtual clock with no second code path.
  startFault(plan: FaultPlan): void {
    this.fault.start(plan)
  }

  setDbgView(view: number): void {
    this.dbgView = view
  }

  getDbgView(): number {
    return this.dbgView
  }

  // One frame of the stab gate (signal/stab.ts): on a gated frame, every control
  // but the five in STOCK_HOLD is swapped for the far board and handed back at
  // the end of the frame. Deliberately *after* applyMod in `render`, so a gated
  // frame is the far board including whatever the LFOs were doing to it — at the
  // far end of the gate the picture is that board and still, which is what the
  // other half has to be for the flip to read as a hit rather than as a change
  // of setting.
  //
  // The waves still advance on a gated frame (applyMod ran), so the stabs land on
  // a look that is drifting underneath rather than on the same frozen frame each
  // time.
  //
  // `stabBoard` is stock unless a look is held there, so the loop below is
  // unchanged for every session that has never used the flip — including the
  // skip, which is still "this key is already where it is going".
  private applyStab(): () => void {
    const { far, changed } = this.stabGate.step(this.stab, this.now())
    // Only on the two edges of a cycle. Every frame inside one holds the same
    // values, so the bank designed on the way in is still the right bank —
    // marking each gated frame instead is a FIR redesign at the frame rate, which
    // is most of what this feature could cost and none of what it needs. It is
    // also the whole reason a *flip* between two looks is affordable where a
    // fade between them would not be.
    if (changed) this.filtersDirty = true
    if (!far) return NOOP
    this.stabLayer.begin()
    for (const k of CONTROL_KEYS) {
      const to = this.stabBoard[k]
      if (this.controls[k] === to || STOCK_HOLD.has(k)) continue
      this.stabLayer.write(k, to)
    }
    return this.stabLayer.seal()
  }

  // Lay the bay over the board for one frame, and hand back the way to undo it
  // (savedBoard.ts › Overlay, which is where the record and the bound restore
  // live). Unlike the two layers beside it this one runs on every frame a
  // routing exists rather than only on a gated one, which is what made the
  // allocation per frame worth taking out.
  private applyMod(): () => void {
    // A wire landed on another wire's depth or rate, resolved from *last*
    // frame's driver value. Keyed by the driven slot's id.
    //
    // One frame of lag rather than an ordering pass, and the lag is the design
    // rather than a shortcut. Sorting the bay so drivers run first would leave
    // a cycle to refuse, and refusing one means a patch the panel has to
    // explain — where at 60 Hz a cycle is simply two wires arguing, which is
    // the whole point of a patch bay on a bent circuit. The cost is that a
    // driven depth is 16 ms behind its driver, which is a sixtieth of a cycle
    // on the fastest LFO the bay offers and invisible on the slow drifts this
    // is for. Bender's trigger bus takes the same trade for the same reason.
    const eff = driveSlots(this.modSlots, this.bayDrive)
    // Emptied only after `driveSlots` has read it: what is in here on the
    // way in is last frame's, and what goes in below is next frame's.
    this.bayDrive.clear()
    // Advanced every frame, bay or no bay: with nothing patched this returns an
    // empty list, and the only work it does is letting an unclaimed trigger
    // expire (see ModState.update) instead of it queueing up for whenever a
    // routing next appears.
    const vals = this.modState.update(
      eff,
      this.audioState.level,
      this.audioState.hit,
      // The bay's random walk and its sample-hold, off the engine's dice rather
      // than `Math.random` — the two sources in the bay that a take could not
      // otherwise be asked for again. The other six are functions of a phase.
      this.rand,
    )
    this.modLayer.begin()
    if (eff.length === 0) return NOOP
    // Save-then-write in one pass, including where two routings drive the same
    // control — the second stacks on the first by design, and SavedBoard restores
    // backwards so the resting value is still the one that lands.
    for (let i = 0; i < eff.length; i++) {
      const s = eff[i]
      const swing = s.depth * (s.max - s.min) * vals[i]
      if (s.bay !== undefined) {
        // Onto the bay rather than onto the board: nothing here reaches a
        // uniform this frame, so there is nothing for the mod layer to save and
        // put back. Several wires onto one knob sum, the same way several
        // routings onto one control stack.
        const at = driveAt(s.bay.slot, s.bay.field)
        this.bayDrive.set(at, (this.bayDrive.get(at) ?? 0) + swing)
        continue
      }
      const v = this.controls[s.target] + swing
      this.modLayer.write(s.target, clamp(v, s.min, s.max))
    }
    return this.modLayer.seal()
  }

  // One frame of the transition in flight (signal/fault.ts): the few controls
  // its recipe names, carried from wherever they rest towards the peak by this
  // frame's depth, and handed back at the end of the frame.
  //
  // **Lerped from the live value rather than written from stock**, which is what
  // makes it compose instead of fight. The value it reads has already been
  // through the morph, the bay and the stab this frame, so a look gliding under
  // a transition keeps gliding and a patched LFO keeps wobbling — the fault
  // pulls whatever is there towards its peak and lets it back. Writing the peak
  // outright at depth 1 would be the same thing at the top of the curve and a
  // discontinuity everywhere else.
  private applyFault(): () => void {
    const step = this.fault.step()
    this.faultLayer.begin()
    if (step === null) return NOOP
    for (const k of CONTROL_KEYS) {
      const to = step.peak[k]
      if (to === undefined) continue
      const from = this.controls[k]
      this.faultLayer.write(k, from + (to - from) * step.depth)
    }
    return this.faultLayer.seal()
  }

  // One frame of the paperclip (signal/clip.ts): the controls its contact point
  // names, carried from wherever they rest toward the short by how much metal is
  // touching this frame.
  //
  // Lerped from the live value for the same reason the fault above is, and the
  // reason is stronger here because a clip repeats: a bite has to land on the
  // board as it is *now*, so a look being morphed or wobbled under the hand
  // keeps moving between contacts instead of being snapped back to whatever it
  // was when the first bite landed.
  //
  // Under the fault rather than over it. A transition is what hides a cut and
  // has to land on every frame it covers; a clip is something happening to the
  // set, which is exactly the sort of thing a transition is entitled to
  // overrule for the few frames it owns.
  private applyClip(): () => void {
    const step = this.clip.step(
      {
        hz: this.controls.clipHz,
        bite: this.controls.clipBite,
        dwellMs: this.controls.clipDwellMs,
        chatter: this.controls.clipChatter,
        point: clipPointAt(this.controls.clipPoint),
      },
      // The engine's dice, not `Math.random`: when the contacts land is the
      // whole character of this, so a take asked for again has to bite in the
      // same places.
      this.rand,
    )
    this.clipLayer.begin()
    if (step === null) return NOOP
    for (const k of CONTROL_KEYS) {
      const to = step.peak[k]
      if (to === undefined) continue
      const from = this.controls[k]
      this.clipLayer.write(k, from + (to - from) * step.depth)
    }
    return this.clipLayer.seal()
  }

  // Bent-crystal LO phase error keeps growing frame over frame; advance by
  // exactly one raster of samples so the shader's per-sample ramp is
  // continuous across the frame boundary.
  private advanceScPhase(detuneKHz: number): void {
    this.scPhase =
      (this.scPhase + loRadPerSample(detuneKHz) * N) % (2 * Math.PI)
  }

  // Crossing-pattern precession for the program deck. The mechanism and its
  // constants are shared with the delay loop's own transport — see
  // signal/crossings.ts — and what is this deck's own is only that its speed
  // arrives as a multiple of play, so the crossing count is one less.
  private advanceShuttle(shuttleX: number): void {
    this.shuttlePhase = advanceCrossings(this.shuttlePhase, shuttleX - 1)
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
    // Backwards by a raster, so `wrap` rather than `%`: the train runs the
    // other way to the frame counter and JS `%` keeps the sign of the dividend
    // (see math.ts, which exists for this one).
    this.impulseTrainPos = wrap(this.impulseTrainPos - N, this.impulseTrainStep)
  }

  // Slow motion gates the whole simulation on a fractional accumulator: below
  // 1, sim steps fire on a fraction of display frames and everything — noise,
  // rolls, sweeps, feedback, phosphor — slows together, exactly like slowed
  // footage of the rig. Skipped frames re-present the held picture so the
  // canvas survives resizes; modulation still advances at display rate, so an
  // LFO or audio envelope on timeScale warps time live.
  // Returns whether this refresh presented anything — the render loop counts
  // presented refreshes for the fps readout, so a lock-skipped refresh must
  // not read as a frame the user saw.
  private render(): boolean {
    // The frame lock renders every Nth refresh and submits *nothing* on the
    // refreshes in between — not even a held present. The canvas keeps its
    // last frame without help, and the idle refreshes have to stay genuinely
    // idle: re-presenting the held frame on them read as an idle page to
    // Firefox's scheduler, which slowed rAF delivery itself (measured on the
    // dev box: rAF fell 48→25 Hz and a 1/2 lock delivered 12 fps, not 24).
    // A counter rather than a divided accumulator so the cadence is exact for
    // every divisor, and checked before applyMod so a locked-out refresh does
    // no work at all — modulation therefore steps once per rendered frame and
    // slows with the lock, like everything else the sim clocks.
    const lockSel = Math.round(this.controls.frameLock)
    // Floored at 1, and this is the line that would spin — the same guard, for
    // the same reason, that `wrap` in gpu/videopump.ts puts on an empty region.
    // A divisor of 0 makes `lockPhase % lockDiv` NaN, so the `!== 0` below is
    // true on every refresh and nothing is ever rendered: a picture frozen on
    // frame 0, which is the signature docs/adr/0004 spends its length teaching
    // people to read as a lost rendering step rather than as a bug here.
    // `?set=` cannot reach it any more (ui/urlParams.ts clamps), but
    // `setControl` is on the public engine API that the harnesses drive, and a
    // control that stops the app is worth being unable to express at all.
    const lockDiv = Math.max(
      1,
      lockSel === LOCK_AUTO ? this.autoLock.tick(this.now()) : 1 + lockSel,
    )
    this.lockDivLive = lockDiv
    this.lockPhase = (this.lockPhase + 1) % lockDiv
    if (this.lockPhase !== 0) return false
    this.advanceGlide()
    const restoreMod = this.applyMod()
    // After the bay, and restored before it: the stab saves values the mod has
    // already written, so handing the board back has to unwind in that order or
    // the resting look ends up holding one frame of modulation.
    const restoreStab = this.applyStab()
    // Outermost, and that is the whole of why it is here rather than beside the
    // bay. A transition is what hides a cut, so it has to land on every frame it
    // covers — including the clean ones a stab gate is holding at stock, which
    // is the one layer that would otherwise swallow it.
    // Under the fault, over the stab — see applyClip.
    const restoreClip = this.applyClip()
    const restoreFault = this.applyFault()
    try {
      this.simAcc = Math.min(this.simAcc + this.controls.timeScale, 1)
      if (this.simAcc >= 1) {
        this.simAcc -= 1
        this.renderFrame()
      } else {
        this.presentHeld()
      }
    } finally {
      restoreFault()
      restoreClip()
      restoreStab()
      restoreMod()
    }
    return true
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
    if (c.aPause === 0) this.tapeFrame.a += 1
    if (c.bPause === 0) this.tapeFrame.b += 1
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
      // the video synth's two oscillators, advanced a frame's worth of samples
      // whether or not a slot is showing them — a bench generator left switched
      // on does not wait to be patched in, so cutting to it lands wherever it
      // has got to rather than restarting the pattern under the cut
      ...this.synthState.update({
        synthAHz: c.synthAHz,
        synthBHz: c.synthBHz,
      }),
    }
    packParams(vals, this.paramScratch)
    d.queue.writeBuffer(this.paramsBuf, 0, this.paramScratch)
    if (this.aFeedOn()) this.packFeed('a', vals, this.feedParamsA, mixU.decks.a)
    if (this.bFeedOn())
      this.packFeed('b', vals, this.feedParamsB, {
        ...mixU.decks.b,
        // Genlocked, the TBC the genlock implies strips B's timing damage, so
        // the pause fields stay zero on that path and feedB carries B's
        // amplitude damage alone through the clean dissolve.
        pause: c.bGenlock < 0.5 ? mixU.decks.b.pause : 0,
      })
    const lineControls: LineStateControls = {
      tbJitterNs: c.tbJitterNs,
      tbWowNs: c.tbWowNs,
      tbStickNs: c.tbStickNs,
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
    // Unconditional: disconnect() zeroes AudioState's waveform, but skipping
    // the upload while the input is off leaves the last frame's samples in
    // audioBuf, and audioBend/audioHue go on reading them — a bend and a hue
    // shift frozen into the picture after the audio is gone.
    d.queue.writeBuffer(this.audioBuf, 0, this.audioState.update(c.audioGain))
    // Each extra dub generation is an independent playback pass: its own gen
    // seed (decorrelating noise and dropouts) and a fresh time-base/phase
    // walk, staged now and copied over the live buffers between generations.
    const gens = clamp(Math.round(c.dubGens), 1, MAX_GENS)
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
    // Fresh video frames on the direct path, imported and blitted before
    // compose reads the slot textures. Imported here, inside the frame that
    // submits them, because an external texture expires with the task that
    // imported it — the pump only parked the elements.
    const ext = this.sources.takePendingExt()
    if (ext.a !== null && this.blitFitPl !== null) {
      const [w, h] = this.sources.sizeA
      this.blitExt(enc, this.blitFitPl, ext.a, this.sources.viewA(), w, h)
    }
    if (ext.b !== null && this.blitCropPl !== null)
      this.blitExt(
        enc,
        this.blitCropPl,
        ext.b,
        this.sources.viewB(),
        ACTIVE_WIDTH,
        ACTIVE_HEIGHT,
      )
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
    this.crtFacePass.bg =
      this.crtFaceBgs[c.crtCutoff > 0 || c.crtGamma !== 1 ? 1 : 0]
    for (const p of this.postPasses) run(p)
    const buzz = this.buzzDrive()
    if (buzz > 0) this.buzzRead.copy(enc, this.buzzBuf)

    this.presentPass(enc)

    if (this.frame < 3) {
      d.pushErrorScope('validation')
      d.pushErrorScope('internal')
    }
    d.queue.submit([enc.finish()])
    // After the submit that carries the copy, and never awaited: the map lands
    // a frame or two from now and the audio ring is built to glide over the
    // gap. The drive is read again on arrival rather than captured above, so
    // letting go of the slider stops the sound on the next frame instead of
    // playing out whatever was already in flight.
    if (buzz > 0)
      this.buzzRead.flush(tap =>
        this.audioState.pushBuzz(tap, this.buzzDrive()),
      )
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
