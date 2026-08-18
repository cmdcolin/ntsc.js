// Audio into the analog chain, in two forms, because they fail differently.
//
// `data` is one audio sample per line — a field is ~1/60 s over 525 lines, so
// audio at line rate lands about one sample per line and the waveform becomes
// horizontal displacement directly, the way a synth patched at the yoke does
// it. Honest, but a periodic sound draws a periodic shape: a sustained tone
// traces a clean sine down the raster and reads as a filter effect, not a fault.
//
// `level` and `hit` are envelopes for driving the *oscillators* instead —
// detuning vertical and horizontal hold so transients knock sync out and the
// picture lurches and tears back into lock. That path is far more interesting,
// because what you see is a system losing and regaining control rather than a
// waveform traced onto the picture. `hit` is an onset envelope, not a level, so
// it punches on each kick instead of riding the bassline.

import { BuzzOut } from './buzz'
import { LINES } from './constants'

import type { Rand } from '../rng'

// Quietest input the auto-gain will still normalize against. Below this it
// stops chasing the signal down, so silence stays silent.
const PEAK_FLOOR = 0.05
// Same idea for the onset detector's reference.
const HIT_FLOOR = 0.01
// Per-frame release of the hit envelope: ~0.2 s at 60 fps, so a kick punches
// and falls away rather than smearing into the next bar.
const HIT_RELEASE = 0.82

export interface HitState {
  hit: number
  lowPrev: number
  ref: number
}

// The smack is the *attack*, not the level. Tracking positive low-band flux
// means a sustained bassline sits still while each kick punches; track the level
// instead and a steady groove holds the picture open, which reads as a stuck
// effect rather than a hit. Instant attack, exponential release, normalized
// against the biggest recent onset so any material lands near 1.
export function stepHit(s: HitState, low: number): HitState {
  const flux = Math.max(0, low - s.lowPrev)
  const ref = Math.max(flux, s.ref * 0.995, HIT_FLOOR)
  return {
    hit: Math.min(Math.max(s.hit * HIT_RELEASE, flux / ref), 1.5),
    lowPrev: low,
    ref,
  }
}

// How long the hall rings for, how long before its tail arrives, and where the
// tail stops being bright. The pre-delay and the damping are what keep the dry
// audible underneath: an undelayed full-band wash lands on the transient it is
// supposed to be following, and a track heard through one reads as further away
// — quieter — however much energy the mix knob is actually adding.
const TAIL_SECONDS = 2.5
const TAIL_PREDELAY = 0.025
const TAIL_DAMP_HZ = 5000

// Both levels glide rather than jump: a slider drag writes a gain per pointer
// event, and stepped gain on a live signal zippers.
const LEVEL_RAMP = 0.02

const ramp = (g: GainNode, value: number, at: number): void => {
  g.gain.setTargetAtTime(value, at, LEVEL_RAMP)
}

// A decaying-noise hall tail at unit energy per channel, so the send's gain is
// the whole level story: at mix 1 the tail comes back about as loud as what fed
// it, and the dry it is added to never moves.
//
// Unit energy is why the convolver runs with `normalize = false`. The browser's
// own normalization holds the *impulse response* to a fixed RMS, and for 2.5 s
// of dense wash that lands the return well under the dry and smeared across
// seconds — so winding the mix up added almost no level while burying the direct
// sound in noise, which is the "reverb turns the volume down" this replaced.
export function hallTail(
  out: Float32Array,
  rand: Rand = Math.random,
): Float32Array {
  let energy = 0
  for (let i = 0; i < out.length; i++) {
    const v = (rand() * 2 - 1) * (1 - i / out.length) ** 3
    out[i] = v
    energy += v * v
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0
  for (let i = 0; i < out.length; i++) out[i] *= scale
  return out
}

// The analysis context and the nodes that live as long as it does. `dry` and
// `send` are parallel: the reverb is a send, not a crossfade, so the tail only
// ever adds and how much direct sound sits under it is `dry`'s own question.
interface Graph {
  ctx: AudioContext
  analyser: AnalyserNode
  dry: GainNode
  send: DelayNode
  wet: GainNode
}

export class AudioState {
  readonly data = new Float32Array(LINES)
  private scratch = new Float32Array(2048)
  private spectrum = new Float32Array(1024)
  private peak = PEAK_FLOOR
  private lowPrev = 0
  private hitRef = HIT_FLOOR
  private stream: MediaStream | null = null
  // ONE context for the lifetime of this object. A media element binds to one
  // AudioContext for life, so tearing the context down to switch input source
  // stranded every <video> already adopted: the next routeMedia had to build a
  // second source node for an element that already had one, which throws
  // InvalidStateError out of a click handler. Sources come and go; this doesn't.
  private graph: Graph | null = null
  // Every element ever adopted, so one is never handed to
  // createMediaElementSource twice — the second call throws. Weak, because the
  // cache has to outlive the routing (an element muted now may be routed again
  // later) but must not outlive the element: a strong map keyed by every clip
  // and audio file ever picked would pin them all for the session.
  private mediaSources = new WeakMap<
    HTMLMediaElement,
    MediaElementAudioSourceNode
  >()
  // The analysed input (mic, or a picked file), and the vaporwave slots routed
  // to the speakers. Independent: enabling the mic no longer silences the clips.
  private input: AudioNode | null = null
  private routed: HTMLMediaElement[] = []
  // The return path — the picture arriving on the audio line. It lives here
  // rather than beside the engine because this object owns the context every
  // node in the page has to share, and because the rule keeping it off the
  // analyser is this object's to enforce. See `pushBuzz`.
  private buzz: BuzzOut | null = null
  private closed = false
  level = 0
  hit = 0

  get active(): boolean {
    return this.input !== null || this.routed.length > 0
  }

  // Build the graph on first use and size the analysis buffers to it, shared by
  // the mic, file and media paths so the FFT size lives in one place.
  private ensureGraph(): Graph {
    if (this.graph === null) {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      this.scratch = new Float32Array(analyser.fftSize)
      this.spectrum = new Float32Array(analyser.frequencyBinCount)
      const dry = ctx.createGain()
      dry.connect(ctx.destination)
      const send = ctx.createDelay()
      send.delayTime.value = TAIL_PREDELAY
      const damp = ctx.createBiquadFilter()
      damp.type = 'lowpass'
      damp.frequency.value = TAIL_DAMP_HZ
      const convolver = ctx.createConvolver()
      convolver.normalize = false
      convolver.buffer = this.impulse(ctx)
      const wet = ctx.createGain()
      wet.gain.value = 0
      send
        .connect(damp)
        .connect(convolver)
        .connect(wet)
        .connect(ctx.destination)
      this.graph = { ctx, analyser, dry, send, wet }
    }
    // Browsers hand back a suspended context unless creation is tied to a user
    // gesture; the enable button is one, but autoplay policies still vary, so
    // ask explicitly rather than silently analysing digital silence.
    void this.graph.ctx.resume()
    return this.graph
  }

  // Cache-or-create, never create twice: the second call for an element throws.
  private sourceFor(
    g: Graph,
    el: HTMLMediaElement,
  ): MediaElementAudioSourceNode {
    let src = this.mediaSources.get(el)
    if (src === undefined) {
      src = g.ctx.createMediaElementSource(el)
      this.mediaSources.set(el, src)
    }
    return src
  }

  async enableMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const g = this.ensureGraph()
    this.releaseInput()
    // Analysed but not heard: routing a live mic to the speakers is a howl.
    const src = g.ctx.createMediaStreamSource(stream)
    src.connect(g.analyser)
    this.input = src
    this.stream = stream
  }

  // A picked audio/video file: heard through the speakers and analysed, so a
  // track drives the same sync and deflection knobs the mic does.
  enableElement(el: HTMLMediaElement): void {
    const g = this.ensureGraph()
    this.releaseInput()
    const src = this.sourceFor(g, el)
    src.connect(g.ctx.destination)
    src.connect(g.analyser)
    this.input = src
  }

  // Two independent tails, so the hall is wider than the source rather than a
  // mono copy of it sitting on top.
  private impulse(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(
      2,
      Math.floor(ctx.sampleRate * TAIL_SECONDS),
      ctx.sampleRate,
    )
    for (let ch = 0; ch < 2; ch++) hallTail(buf.getChannelData(ch))
    return buf
  }

  // Route the given media elements' audio to the speakers and reverb send, and
  // into the analyser so a slowed clip drives the artifacts. Passing [] silences
  // them while leaving every source cached, since an element cannot be adopted
  // twice. Only the previously routed sources are touched, so this never cuts
  // the mic or a picked file out from under itself.
  routeMedia(
    els: HTMLMediaElement[],
    mix: { dry: number; reverb: number },
  ): void {
    if (els.length > 0 || this.graph !== null) {
      const g = this.ensureGraph()
      for (const el of this.routed) this.mediaSources.get(el)?.disconnect()
      this.routed = [...els]
      for (const el of els) {
        const src = this.sourceFor(g, el)
        src.connect(g.dry)
        // Ahead of the dry fader, deliberately: pulling the direct sound back to
        // sit the clip in the room must not also pull back what the sound does
        // to the picture. The analyser drives sync and deflection, and that is
        // not a listening level.
        src.connect(g.analyser)
        src.connect(g.send)
      }
      this.setDryLevel(mix.dry)
      this.setReverbMix(mix.reverb)
    }
  }

  // Video crosstalk out to the speakers, one measurement pair per line. Builds
  // the graph on first use, so the buzz works with no input source picked at
  // all — a set buzzes at whatever is on screen, and nothing about that needs a
  // microphone. The slider that raises `drive` is the user gesture the context
  // needs to leave suspended.
  //
  // BuzzOut connects to `ctx.destination` and to nothing else, deliberately.
  // Routing it into `analyser` would put it into `data`, which FMs the very
  // sound carrier the tap measures: video → audio → video, with gain.
  //
  // The `closed` guard is not belt and braces: this is the one caller that
  // arrives from a promise rather than a call stack — the GPU readback lands
  // whenever it lands — so it is the one that can turn up after teardown, and
  // `ensureGraph` would answer by building a whole new AudioContext for an
  // engine that no longer exists.
  pushBuzz(tap: Float32Array, drive: number): void {
    if (drive > 0 && !this.closed) {
      const g = this.ensureGraph()
      this.buzz ??= new BuzzOut(g.ctx)
      this.buzz.push(tap, drive)
    }
  }

  // How much direct sound the clips are heard at, with the tail unchanged
  // underneath. Wind this down against a raised mix and the clip moves into the
  // next room; leave it at 1 and the reverb is pure addition.
  setDryLevel(level: number): void {
    const g = this.graph
    if (g !== null) ramp(g.dry, level, g.ctx.currentTime)
  }

  setReverbMix(reverb: number): void {
    const g = this.graph
    if (g !== null) ramp(g.wet, reverb, g.ctx.currentTime)
  }

  // Drop an element's source when its <video> is retired for good (a new clip
  // is a new element). Muting keeps a source cached — an element binds to one
  // context for life and can't be re-adopted — so only true retirement evicts,
  // which is why the element's owner has to signal it rather than routeMedia.
  releaseMedia(el: HTMLMediaElement): void {
    this.mediaSources.get(el)?.disconnect()
    this.mediaSources.delete(el)
    this.routed = this.routed.filter(x => x !== el)
  }

  // Input off. The context, its analyser and every adopted element source stay
  // up: closing the context would strand each <video> already bound to it, and
  // the vaporwave clips are routed independently of whatever is being analysed.
  disconnect(): void {
    this.releaseInput()
    this.data.fill(0)
    this.level = 0
    this.hit = 0
    this.peak = PEAK_FLOOR
    this.lowPrev = 0
    this.hitRef = HIT_FLOOR
  }

  private releaseInput(): void {
    this.input?.disconnect()
    this.input = null
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
  }

  // Give the whole graph back, for good — the owner is going away. Distinct
  // from disconnect(), which is "input off" and deliberately keeps the context
  // so the clips still on screen stay adoptable. Nothing called this before, so
  // an engine torn down with the mic live (a hot reload, or the component
  // unmounting) left the browser recording into a graph no one was reading.
  close(): void {
    this.closed = true
    this.disconnect()
    this.buzz?.close()
    this.buzz = null
    void this.graph?.ctx.close()
    this.graph = null
    // Every source belonged to the closed context, so none can be reused; a
    // later routeMedia must build fresh ones against a fresh context.
    this.mediaSources = new WeakMap()
    this.routed = []
  }

  // Resample the most recent field's worth of audio down to one sample per
  // line, normalized against a slowly-decaying peak so any input level is
  // usable without riding a gain slider.
  update(gain: number): Float32Array<ArrayBuffer> {
    const g = this.graph
    if (g !== null) {
      g.analyser.getFloatTimeDomainData(this.scratch)
      const field = Math.round(g.ctx.sampleRate / 60)
      const span = Math.min(this.scratch.length, field)
      const start = this.scratch.length - span

      let hi = 0
      let sum = 0
      for (let row = 0; row < LINES; row++) {
        const v = this.scratch[start + Math.floor((row / LINES) * span)]
        this.data[row] = v
        hi = Math.max(hi, Math.abs(v))
        sum += v * v
      }
      // Fast attack, slow release, and a hard floor on the reference. Without
      // the floor a quiet passage lets the divisor decay toward zero and the
      // gain runs away, so room noise gets amplified to full-scale deflection
      // and the picture detonates — the auto-gain has to give up rather than
      // chase silence. Deflection is then clamped, so no input can drive it past
      // the range the sliders describe.
      this.peak = Math.max(hi, this.peak * 0.995, PEAK_FLOOR)
      const norm = gain / this.peak
      for (let row = 0; row < LINES; row++) {
        this.data[row] = Math.max(-2, Math.min(2, this.data[row] * norm))
      }
      this.level = Math.min(Math.sqrt(sum / LINES) / this.peak, 2)
      this.updateHit()
    }
    return this.data
  }

  private updateHit(): void {
    const next = stepHit(
      { hit: this.hit, lowPrev: this.lowPrev, ref: this.hitRef },
      this.lowEnergy(),
    )
    this.hit = next.hit
    this.lowPrev = next.lowPrev
    this.hitRef = next.ref
  }

  // Mean magnitude below ~200 Hz: kick and bass, where the punch lives.
  private lowEnergy(): number {
    const g = this.graph
    let acc = 0
    if (g !== null) {
      g.analyser.getFloatFrequencyData(this.spectrum)
      const hz = g.ctx.sampleRate / 2 / this.spectrum.length
      const bins = Math.max(1, Math.round(200 / hz))
      for (let i = 0; i < bins; i++) {
        // dB (-Inf..0) to a 0..1 weighting over the bottom 60 dB
        acc += Math.max(0, (this.spectrum[i] + 60) / 60)
      }
      acc /= bins
    }
    return acc
  }
}
