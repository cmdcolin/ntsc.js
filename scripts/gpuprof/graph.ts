// The signal path's compute graph, stood up headless: the same buffers, the
// same shaders with the same prelude, the same per-frame CPU state, bound by
// the names each shader declares (core/gpu/reflect.ts) rather than by
// position. pipeline.ts remains the authority on the app's graph; this mirrors
// it closely enough to time and to read back, and a binding the shader names
// that this file does not supply throws at construction.

import { DEFAULT_CONTROLS } from '../../src/core/controls'
import {
  aFeedOn,
  bFeedOn,
  bOn,
  bWaveOn,
  FEEDS,
} from '../../src/core/gpu/feedgates'
import { designFilterBank } from '../../src/core/gpu/filterbank'
import {
  GEN_OFFSET,
  packParams,
  PARAM_BYTES,
  PRELUDE,
  TILE_WG,
} from '../../src/core/gpu/prelude'
import { reflectBindings } from '../../src/core/gpu/reflect'
import { loRadPerSample, uniformValues } from '../../src/core/gpu/uniforms'
import { wrap } from '../../src/core/math'
import { rngFor } from '../../src/core/rng'
import {
  ACTIVE_HEIGHT,
  ACTIVE_WIDTH,
  LINES,
  SAMPLE_RATE,
  SAMPLES_PER_LINE,
  TAPE_FRAMES,
} from '../../src/core/signal/constants'
import { advanceCrossings } from '../../src/core/signal/crossings'
import { FILTER_STRIDE, NUM_SECTIONS } from '../../src/core/signal/filters'
import { LineState } from '../../src/core/signal/linestate'
import { MixState } from '../../src/core/signal/mixstate'
import { valueNoise } from '../../src/core/signal/noise'
import { RfState } from '../../src/core/signal/rfstate'
import { StrobeGate } from '../../src/core/signal/strobe'
import { SynthState } from '../../src/core/signal/synthstate'
import { TapeState, tapeRecording } from '../../src/core/signal/tapeloop'

import type { Controls } from '../../src/core/controls'
import type { FeedSource } from '../../src/core/gpu/feedgates'
import type { ParamName } from '../../src/core/gpu/prelude'
import type { LineStateControls } from '../../src/core/signal/linestate'
import type { DeckPause } from '../../src/core/signal/mixstate'

const N = SAMPLES_PER_LINE * LINES
const LINE_PARAM_BYTES = LINES * 16
const MAX_GENS = 4

type Res = GPUBuffer | GPUTextureView | GPUSampler

export interface PassDef {
  label: string
  shader: string
  variants: Record<string, Record<string, Res>>
  pick?: () => string
  dispatch: readonly [number, number]
  when?: () => boolean
}

interface Pass {
  label: string
  pl: GPUComputePipeline
  bgs: Record<string, GPUBindGroup>
  pick: () => string
  x: number
  y: number
  when?: () => boolean
}

export interface GraphOptions {
  controls: Controls
  bEnabled: boolean
  sourceA: Uint8Array<ArrayBuffer>
  sourceB: Uint8Array<ArrayBuffer>
}

const shaderDir = new URL('../../src/core/gpu/shaders/', import.meta.url)

async function loadShader(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(`${name}.wgsl`, shaderDir))
}

export class Graph {
  readonly passes: Pass[] = []
  readonly device: GPUDevice
  readonly c: Controls
  frame = 0

  readonly compA: GPUBuffer
  readonly outTex: GPUTexture
  private readonly paramsBuf: GPUBuffer
  private readonly genParamsBuf: GPUBuffer
  private readonly genLineParamsBuf: GPUBuffer
  private readonly feedParamsA: GPUBuffer
  private readonly feedParamsB: GPUBuffer
  private readonly lineParamsBuf: GPUBuffer
  private readonly filterBuf: GPUBuffer
  private readonly audioBuf: GPUBuffer
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES)
  private readonly feedScratch = new ArrayBuffer(PARAM_BYTES)

  private readonly rand = rngFor(1)
  private readonly lineState = new LineState(this.rand)
  private readonly mixState = new MixState(this.rand)
  private readonly tapeState = new TapeState(this.rand)
  private readonly rfState = new RfState()
  private readonly synthState = new SynthState()
  private readonly strobeGate = new StrobeGate()
  private scPhase = 0
  private shuttlePhase = 0
  private tapeFrame = { a: 0, b: 0 }
  private impulseTrainPos = 0
  private impulseTrainStep = 0
  private readonly bEnabled: boolean

  private prePasses: Pass[] = []
  private loopPasses: Pass[] = []
  private postPasses: Pass[] = []

  private constructor(device: GPUDevice, opts: GraphOptions) {
    this.device = device
    this.c = opts.controls
    this.bEnabled = opts.bEnabled
    const d = device
    const uniform = () =>
      d.createBuffer({
        size: PARAM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    const storage = (size: number, extra = 0) =>
      d.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
      })
    this.paramsBuf = uniform()
    this.feedParamsA = uniform()
    this.feedParamsB = uniform()
    this.genParamsBuf = d.createBuffer({
      size: MAX_GENS * PARAM_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.genLineParamsBuf = d.createBuffer({
      size: MAX_GENS * LINE_PARAM_BYTES,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.filterBuf = storage(NUM_SECTIONS * FILTER_STRIDE * 4)
    this.lineParamsBuf = storage(LINE_PARAM_BYTES)
    this.audioBuf = storage(LINES * 4)
    this.compA = storage(N * 4, GPUBufferUsage.COPY_SRC)
    const yuvBuf = storage(N * 16)
    const yuvBBuf = storage(N * 16)
    const uvfBBuf = storage(N * 8)
    const compB = storage(N * 4)
    const bCompBuf = storage(N * 4)
    const compPrev = storage(N * 4)
    const chromaBuf = storage(N * 4)
    const underBuf = storage(N * 4)
    const lineInfoBuf = storage(LINES * 16)
    const timingBuf = storage((LINES * 2 + 8) * 4)
    const syncMeasureBuf = storage(LINES * 16)
    const buzzBuf = storage(LINES * 8, GPUBufferUsage.COPY_SRC)
    const persist = [
      storage(ACTIVE_WIDTH * ACTIVE_HEIGHT * 8),
      storage(ACTIVE_WIDTH * ACTIVE_HEIGHT * 8),
    ]
    const tex = () =>
      d.createTexture({
        size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      })
    const srcTexA = tex()
    const srcTexB = tex()
    const inputTex = tex()
    this.outTex = tex()
    const faceTex = tex()
    const samp = d.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const upload = (t: GPUTexture, px: Uint8Array<ArrayBuffer>) =>
      d.queue.writeTexture(
        { texture: t },
        px,
        { bytesPerRow: ACTIVE_WIDTH * 4 },
        [ACTIVE_WIDTH, ACTIVE_HEIGHT],
      )
    upload(srcTexA, opts.sourceA)
    upload(srcTexB, opts.sourceB)
    d.queue.writeBuffer(this.filterBuf, 0, designFilterBank(this.c))
    d.queue.writeBuffer(this.audioBuf, 0, new Float32Array(LINES))

    const c = this.c
    const perLine = [Math.ceil(SAMPLES_PER_LINE / 64), LINES] as const
    const perLineW = [Math.ceil(SAMPLES_PER_LINE / 2 / 64), LINES] as const
    const perPixel = [Math.ceil(ACTIVE_WIDTH / 64), ACTIVE_HEIGHT] as const
    const perLineT = [Math.ceil(SAMPLES_PER_LINE / TILE_WG), LINES] as const
    const perPixelT = [
      Math.ceil(ACTIVE_WIDTH / TILE_WG),
      ACTIVE_HEIGHT,
    ] as const
    const perTile = [
      Math.ceil(ACTIVE_WIDTH / 8),
      Math.ceil(ACTIVE_HEIGHT / 8),
    ] as const
    const perRow = [Math.ceil(LINES / 64), 1] as const
    const bChainOn = () => bOn(c, this.bEnabled)
    const P = this.paramsBuf
    const filters = this.filterBuf
    const lineParams = this.lineParamsBuf
    const audio = this.audioBuf
    const one = (res: Record<string, Res>) => ({ main: res })

    const tapeOn = c.tapeMix !== 0 || tapeRecording(c)
    const tape = tapeOn ? storage(TAPE_FRAMES * N * 2) : null

    this.pre = [
      {
        label: 'compose',
        shader: 'compose',
        variants: one({
          P,
          srcTex: srcTexA.createView(),
          prevTex: faceTex.createView(),
          samp,
          inputTex: inputTex.createView(),
          timing: timingBuf,
        }),
        dispatch: perTile,
      },
      {
        label: 'encodeYuv',
        shader: 'encode_yuv',
        variants: one({ inputTex: inputTex.createView(), samp, yuv: yuvBuf }),
        dispatch: perPixel,
      },
      {
        label: 'encodeComposite',
        shader: 'encode_composite',
        variants: {
          main: { P, filters, yuv: yuvBuf, comp: this.compA },
          feed: { P, filters, yuv: yuvBuf, comp: compB },
        },
        pick: () => (aFeedOn(c) ? 'feed' : 'main'),
        dispatch: perLineT,
      },
      {
        label: 'feedA',
        shader: 'feed',
        variants: one({ P: this.feedParamsA, src: compB, dst: this.compA }),
        dispatch: perLine,
        when: () => aFeedOn(c),
      },
      {
        label: 'composeB',
        shader: 'compose_b',
        variants: one({ P, srcTexB: srcTexB.createView() }),
        dispatch: perTile,
        when: () => false,
      },
      {
        label: 'encodeYuvB',
        shader: 'encode_yuv',
        variants: one({ inputTex: srcTexB.createView(), samp, yuv: yuvBBuf }),
        dispatch: perPixel,
        when: bChainOn,
      },
      {
        label: 'encodeChromaB',
        shader: 'encode_chroma_b',
        variants: one({ filters, yuvB: yuvBBuf, uvfB: uvfBBuf }),
        dispatch: perPixelT,
        when: bChainOn,
      },
      {
        label: 'encodeCompositeB',
        shader: 'encode_composite_b',
        variants: {
          main: { P, yuvB: yuvBBuf, uvfB: uvfBBuf, outB: bCompBuf },
          feed: { P, yuvB: yuvBBuf, uvfB: uvfBBuf, outB: compB },
        },
        pick: () => (bFeedOn(c, this.bEnabled) ? 'feed' : 'main'),
        dispatch: perLine,
        when: () => bWaveOn(c, this.bEnabled),
      },
      {
        label: 'feedB',
        shader: 'feed',
        variants: one({ P: this.feedParamsB, src: compB, dst: bCompBuf }),
        dispatch: perLine,
        when: () => bFeedOn(c, this.bEnabled),
      },
      {
        label: 'mixB',
        shader: 'mix_b',
        variants: one({
          P,
          yuvB: yuvBBuf,
          uvfB: uvfBBuf,
          comp: this.compA,
          bComp: bCompBuf,
          loopBus: compPrev,
        }),
        dispatch: perLine,
        when: bChainOn,
      },
      {
        label: 'fbComposite',
        shader: 'fb_composite',
        variants: one({ P, prev: compPrev, comp: this.compA }),
        dispatch: perLine,
        when: () => c.cfbMix !== 0,
      },
      ...(tape === null
        ? []
        : [
            {
              label: 'tapePlay',
              shader: 'tape_play',
              variants: one({ P, tape, comp: this.compA }),
              dispatch: perLine,
              when: () => c.tapeMix !== 0,
            },
            {
              label: 'tapeRec',
              shader: 'tape_rec',
              variants: one({ P, comp: this.compA, tape }),
              dispatch: perLineW,
              when: () => tapeRecording(c),
            },
          ]),
    ]
    this.loop = [
      {
        label: 'chromaExtract',
        shader: 'chroma_extract',
        variants: one({ filters, comp: this.compA, chroma: chromaBuf }),
        dispatch: perLineT,
      },
      {
        label: 'underDown',
        shader: 'under_down',
        variants: one({
          filters,
          chroma: chromaBuf,
          lineParams,
          under: underBuf,
        }),
        dispatch: perLineT,
        when: () => c.colorUnderMix > 0,
      },
      {
        label: 'channel',
        shader: 'channel',
        variants: one({
          P,
          filters,
          comp: this.compA,
          chroma: chromaBuf,
          under: underBuf,
          lineParams,
          outBuf: compB,
          audio,
        }),
        dispatch: perLineT,
      },
      {
        label: 'timebase',
        shader: 'timebase',
        variants: one({ lineParams, src: compB, dst: this.compA }),
        dispatch: perLine,
      },
    ]
    this.post = [
      {
        label: 'enhancer',
        shader: 'enhancer',
        variants: one({ P, comp: this.compA }),
        dispatch: perRow,
        when: () =>
          c.enhClampUs !== 0 ||
          c.enhDroopUs > 0 ||
          (c.enhPeakMHz > 0 && c.enhPeakBoost > 0) ||
          c.enhSync > 0,
      },
      {
        label: 'buzzTap',
        shader: 'buzz_tap',
        variants: one({ comp: this.compA, buzz: buzzBuf }),
        dispatch: perRow,
        when: () => this.buzzDrive() > 0,
      },
      {
        label: 'syncMeasure',
        shader: 'sync_measure',
        variants: one({
          P,
          comp: this.compA,
          timing: timingBuf,
          measure: syncMeasureBuf,
        }),
        dispatch: perRow,
      },
      {
        label: 'sync',
        shader: 'sync',
        variants: one({ P, measure: syncMeasureBuf, timing: timingBuf, audio }),
        dispatch: [1, 1],
      },
      {
        label: 'lineAnalyze',
        shader: 'line_analyze',
        variants: one({
          P,
          comp: this.compA,
          timing: timingBuf,
          lineInfo: lineInfoBuf,
        }),
        dispatch: perRow,
      },
      {
        label: 'decode',
        shader: 'decode',
        variants: {
          even: {
            P,
            filters,
            comp: this.compA,
            lineInfo: lineInfoBuf,
            timing: timingBuf,
            outTex: this.outTex.createView(),
            held: persist[0],
            heldNext: persist[1],
            audio,
          },
          odd: {
            P,
            filters,
            comp: this.compA,
            lineInfo: lineInfoBuf,
            timing: timingBuf,
            outTex: this.outTex.createView(),
            held: persist[1],
            heldNext: persist[0],
            audio,
          },
        },
        pick: () => (this.frame % 2 === 0 ? 'even' : 'odd'),
        dispatch: perPixelT,
      },
      {
        label: 'crtFace',
        shader: 'crt_face',
        variants: one({
          P,
          srcTex: this.outTex.createView(),
          samp,
          faceTex: faceTex.createView(),
          timing: timingBuf,
        }),
        dispatch: perTile,
      },
      {
        label: 'storePrev',
        shader: 'store_prev',
        variants: one({ P, comp: this.compA, prev: compPrev }),
        dispatch: perLine,
        when: () => {
          const period =
            c.cfbTrail > 0
              ? 2 * Math.ceil((c.cfbHold + 1) / 2)
              : Math.round(c.cfbHold) + 1
          return c.cfbMix !== 0 && this.frame % period === 0
        },
      },
    ]
  }

  private pre: PassDef[] = []
  private loop: PassDef[] = []
  private post: PassDef[] = []

  static async create(device: GPUDevice, opts: GraphOptions): Promise<Graph> {
    const g = new Graph(device, opts)
    const build = async (defs: PassDef[]): Promise<Pass[]> =>
      await Promise.all(defs.map(def => g.buildPass(def)))
    g.prePasses = await build(g.pre)
    g.loopPasses = await build(g.loop)
    g.postPasses = await build(g.post)
    g.passes.push(...g.prePasses, ...g.loopPasses, ...g.postPasses)
    return g
  }

  private async buildPass(def: PassDef): Promise<Pass> {
    const d = this.device
    const src = await loadShader(def.shader)
    const module = d.createShaderModule({ code: PRELUDE + src })
    const info = await module.getCompilationInfo()
    for (const m of info.messages) {
      if (m.type === 'error')
        throw new Error(
          `${def.shader}.wgsl:${m.lineNum}:${m.linePos} ${m.message}`,
        )
    }
    const pl = d.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })
    const bindings = reflectBindings(src)
    const bgs: Record<string, GPUBindGroup> = {}
    for (const [key, res] of Object.entries(def.variants)) {
      const extra = Object.keys(res).filter(
        n => !bindings.some(b => b.name === n),
      )
      if (extra.length > 0)
        throw new Error(
          `${def.label}: ${def.shader}.wgsl declares no binding named ${extra.join(', ')}`,
        )
      bgs[key] = d.createBindGroup({
        layout: pl.getBindGroupLayout(0),
        entries: bindings.map(b => {
          const r = res[b.name]
          if (r === undefined)
            throw new Error(
              `${def.label}: ${def.shader}.wgsl binding ${b.name} not supplied`,
            )
          return {
            binding: b.binding,
            resource: r instanceof GPUBuffer ? { buffer: r } : r,
          }
        }),
      })
    }
    return {
      label: def.label,
      pl,
      bgs,
      pick: def.pick ?? (() => 'main'),
      x: def.dispatch[0],
      y: def.dispatch[1],
      when: def.when,
    }
  }

  private buzzDrive(): number {
    const c = this.c
    return Math.min(1.5, c.buzzLevel + 0.6 * Math.max(c.rfMistuneMHz, 0))
  }

  private packFeed(
    src: FeedSource,
    vals: Record<ParamName, number>,
    buf: GPUBuffer,
    deck: DeckPause,
  ): void {
    const c = this.c
    const f = FEEDS[src]
    packParams(
      {
        ...vals,
        gen: f.gen,
        srcFrame: this.tapeFrame[src],
        scramble: c[f.scramble],
        scrambleMode: c[f.scrambleMode],
        termination: c[f.termination],
        noiseSigma: c[f.noise],
        polarityFlip: c[f.polarity],
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
    this.device.queue.writeBuffer(buf, 0, this.feedScratch)
  }

  // The CPU half of one frame, mirroring Engine.renderFrame up to the encoder.
  private stage(): number {
    const c = this.c
    const d = this.device
    this.scPhase =
      (this.scPhase + loRadPerSample(c.scDetuneKHz) * N) % (2 * Math.PI)
    this.shuttlePhase = advanceCrossings(this.shuttlePhase, c.shuttleX - 1)
    if (c.aPause === 0) this.tapeFrame.a += 1
    if (c.bPause === 0) this.tapeFrame.b += 1
    if (c.impulseHz <= 0) {
      this.impulseTrainStep = 0
    } else {
      const fEff =
        c.impulseHz * (1 + 0.25 * valueNoise((this.frame / 60) * 0.4, 3))
      this.impulseTrainStep = SAMPLE_RATE / fEff
      this.impulseTrainPos = wrap(
        this.impulseTrainPos - N,
        this.impulseTrainStep,
      )
    }
    const mixU = this.mixState.update({
      aPause: c.aPause,
      bLineHz: c.bLineHz,
      bDetuneHz: c.bDetuneHz,
      bRollLps: c.bRollLps,
      bPause: c.bPause,
      wipePos: c.wipePos,
      wipeRateHz: c.wipeRate,
    })
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
      ...uniformValues(c, {
        frame: this.frame,
        canvasW: 1508,
        canvasH: 1131,
        srcAspect: 4 / 3,
        srcNoise: 0,
        srcNoiseB: 0,
        srcFrame: this.tapeFrame.a,
        beamBlank: this.strobeGate.step(
          { hz: c.strobeHz, ms: c.strobeMs },
          (this.frame * 1000) / 60,
        ),
        scPhase: this.scPhase,
        audioHit: 0,
        audioLevel: 0,
        impulseTrainPos: this.impulseTrainPos,
        impulseTrainStep: this.impulseTrainStep,
        shuttlePhase: this.shuttlePhase,
        dbgView: 0,
      }),
      ...mixU,
      ...tapeU,
      ...this.rfState.update(this.frame),
      ...this.synthState.update({ synthAHz: c.synthAHz, synthBHz: c.synthBHz }),
    }
    packParams(vals, this.paramScratch)
    d.queue.writeBuffer(this.paramsBuf, 0, this.paramScratch)
    if (aFeedOn(c)) this.packFeed('a', vals, this.feedParamsA, mixU.decks.a)
    if (bFeedOn(c, this.bEnabled))
      this.packFeed('b', vals, this.feedParamsB, {
        ...mixU.decks.b,
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
    const gens = Math.min(Math.max(Math.round(c.dubGens), 1), MAX_GENS)
    const dv = new DataView(this.paramScratch)
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
    return gens
  }

  // Encode one frame. `dispatch` is handed every pass that is due, in order,
  // so the caller decides how to time it and which to leave out.
  encode(
    enc: GPUCommandEncoder,
    dispatch: (
      p: Pass,
      run: (timestamps?: GPUComputePassTimestampWrites) => void,
    ) => void,
  ): void {
    const gens = this.stage()
    const run = (p: Pass) => {
      if (p.when !== undefined && !p.when()) return
      dispatch(p, timestampWrites => {
        const cp = enc.beginComputePass({ timestampWrites })
        cp.setPipeline(p.pl)
        cp.setBindGroup(0, p.bgs[p.pick()])
        cp.dispatchWorkgroups(p.x, p.y)
        cp.end()
      })
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
    if (gens > 1)
      enc.copyBufferToBuffer(
        this.genParamsBuf,
        0,
        this.paramsBuf,
        0,
        PARAM_BYTES,
      )
    for (const p of this.postPasses) run(p)
    this.frame += 1
  }
}

export function stockControls(): Controls {
  return { ...DEFAULT_CONTROLS }
}
