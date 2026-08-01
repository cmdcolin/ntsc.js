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

import { LINES } from './constants'

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

// The analysis context and the nodes that live as long as it does.
interface Graph {
  ctx: AudioContext
  analyser: AnalyserNode
  wet: GainNode
  convolver: ConvolverNode
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
      const wet = ctx.createGain()
      const convolver = ctx.createConvolver()
      convolver.buffer = this.impulse(ctx)
      convolver.connect(wet).connect(ctx.destination)
      this.graph = { ctx, analyser, wet, convolver }
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

  // A short decaying-noise impulse — a plausible hall tail for the reverb send.
  private impulse(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2.5)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
      }
    }
    return buf
  }

  // Route the given media elements' audio to the speakers and reverb send, and
  // into the analyser so a slowed clip drives the artifacts. Passing [] silences
  // them while leaving every source cached, since an element cannot be adopted
  // twice. Only the previously routed sources are touched, so this never cuts
  // the mic or a picked file out from under itself.
  routeMedia(els: HTMLMediaElement[], reverb: number): void {
    if (els.length > 0 || this.graph !== null) {
      const g = this.ensureGraph()
      for (const el of this.routed) this.mediaSources.get(el)?.disconnect()
      this.routed = [...els]
      for (const el of els) {
        const src = this.sourceFor(g, el)
        src.connect(g.ctx.destination)
        src.connect(g.analyser)
        src.connect(g.convolver)
      }
      g.wet.gain.value = reverb
    }
  }

  setReverbMix(reverb: number): void {
    if (this.graph !== null) this.graph.wet.gain.value = reverb
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
    this.disconnect()
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
