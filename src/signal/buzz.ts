// Intercarrier buzz, sound half. `audiostate.ts` is audio going *into* the
// analog chain; this is the return path — the picture arriving on the audio
// line, which is what a set does when the sound detector's limiter cannot keep
// video crosstalk off the 4.5 MHz beat. `gpu/shaders/buzz_tap.wgsl` measures it
// off the composite the receiver locked to, one pair of numbers per line, and
// everything below turns that into something a speaker can play.
//
// The point of tapping the real waveform rather than synthesising a buzz is
// that the faults arrive free and in the right relationship: a bright scene
// buzzes louder because peak white really does overmodulate, hum bars beat
// against the field rate, a head switch clicks on the line it damages, snow
// hisses. None of that is drawn.
//
// **The tap is ahead of the receiver, so it hears the signal domain and is deaf
// to the other two** — the three-domain distinction in `ARCHITECTURE.md`,
// arriving in the sound. A rolling picture does not slide the buzz in pitch,
// which is the tempting thing to assume: the roll is `timing[V_PHASE]`, written
// by `sync` and consumed by `decode`, both downstream of here. A real set is
// the same way round — the sound detector taps the signal, not the yoke — so a
// picture rolling over a steady buzz is correct and not a missed connection.
// What does move the buzz is anything that changes the *signal's* timing, which
// here means the rate fields are rendered at: `timeScale` lowers the pitch.
//
// **Nothing here may reach AudioState's analyser.** That analyser fills
// `audioBuf`, which FMs the sound carrier in `channel.wgsl` — the carrier this
// tap is measuring. Wire the output back into the input and video → audio →
// video is a closed loop with gain, which squeals. Speakers only.

import workletUrl from './buzz.worklet.js?url'
import { LINES } from './constants'

// Blanking sits at 0 IRE and peak white at 100, so a line's mean is mostly a
// large positive offset with the interesting part riding on it. Full scale is
// that swing.
const FULL_SCALE_IRE = 100

// How much of the within-line deviation to fold back in as noise. Tuned, with a
// bandwidth argument behind the order of magnitude: the per-line mean is a
// boxcar that keeps ~15.75 kHz of the noise, the real sound channel is a
// ~50 kHz slice and FM detection weights the top of it hardest, so a few times
// the boxcar's share is about right. Low enough that a clean picture's buzz
// still dominates, high enough that snow hisses.
const HISS = 0.15

// One-pole DC blocker, ~20 Hz, at the 31.5 kHz line rate. The offset itself is
// inaudible and only eats headroom; 60 Hz — the whole point — passes within
// half a dB.
const DC_POLE = 0.996

export interface DcState {
  x: number
  y: number
}

export const dcState = (): DcState => ({ x: 0, y: 0 })

// One audio sample per line from one line-measurement pair each, in place.
// `tap` is interleaved (mean, deviation) in IRE, straight off the GPU; `out`
// comes back at ±1, soft-clipped, so no drive setting and no runaway upstream
// can put a full-scale square wave through someone's speakers.
export function detect(
  tap: Float32Array,
  out: Float32Array,
  s: DcState,
  drive: number,
  rand: () => number,
): Float32Array {
  for (let i = 0; i < out.length; i++) {
    const x = tap[i * 2] + HISS * tap[i * 2 + 1] * (rand() * 2 - 1)
    s.y = DC_POLE * (s.y + x - s.x)
    s.x = x
    out[i] = Math.tanh((drive * s.y) / FULL_SCALE_IRE)
  }
  return out
}

// The detector, its worklet, and the one connection it is allowed to make.
export class BuzzOut {
  private node: AudioWorkletNode | null = null
  private readonly out = new Float32Array(LINES)
  private readonly dc = dcState()
  private closed = false

  // The module loads asynchronously and pushes before it lands are dropped,
  // which costs a few frames of buzz at the moment the slider first comes up
  // and nothing after that. A browser without AudioWorklet leaves this inert
  // rather than failing the render loop that called it.
  constructor(ctx: AudioContext) {
    void ctx.audioWorklet.addModule(workletUrl).then(
      () => {
        if (!this.closed) {
          this.node = new AudioWorkletNode(ctx, 'buzz', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          })
          this.node.connect(ctx.destination)
        }
      },
      (e: unknown) => console.warn('buzz worklet unavailable:', e),
    )
  }

  // Transferred rather than copied across, so the audio thread owns the samples
  // outright and neither side waits on the other.
  push(tap: Float32Array, drive: number): void {
    if (this.node !== null) {
      const samples = detect(tap, this.out, this.dc, drive, Math.random).slice()
      this.node.port.postMessage({ samples }, [samples.buffer])
    }
  }

  close(): void {
    this.closed = true
    this.node?.disconnect()
    this.node = null
  }
}
