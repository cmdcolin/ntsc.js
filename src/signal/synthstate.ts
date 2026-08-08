// The video synth's two oscillators, as free-running phase. They are the only
// generators in the app that keep a phase across frames rather than being a
// function of the sample index, and that is the entire point of them: an
// oscillator that restarted every frame would draw a pattern nailed to the
// raster, which is a texture, not an instrument. Running free, where it sits
// relative to line and field rate is what the picture is.
//
// Phase is counted in cycles (0..1), never radians, so wrapping is fract() and
// the shader's waveform selector can slice a shape straight off it.
//
// The uniforms are the walk per line and per sample rather than the frequency
// they came from, for two reasons. Precision: a frame is 477750 samples, and an
// f32 phase accumulated to the far corner of one at subcarrier rate has lost
// several bits by the time it gets there — splitting the walk keeps both terms
// small. And legibility: the per-line walk IS the lean of the pattern, so the
// number the shader multiplies by the row is the number a reader can point at.

import { LINES, SAMPLE_RATE, SAMPLES_PER_LINE } from './constants'

const FRAME_SAMPLES = SAMPLES_PER_LINE * LINES

const fract = (x: number) => x - Math.floor(x)

export interface SynthControls {
  synthAHz: number // oscillator A frequency
  synthBHz: number // oscillator B frequency
}

export interface SynthUniforms {
  synthPhaseA: number
  synthPerLineA: number
  synthPerSampleA: number
  synthPhaseB: number
  synthPerLineB: number
  synthPerSampleB: number
}

// One oscillator's three uniforms from its frequency and its running phase.
const walk = (hz: number, phase: number) => ({
  phase: fract(phase),
  perLine: fract((hz * SAMPLES_PER_LINE) / SAMPLE_RATE),
  perSample: hz / SAMPLE_RATE,
})

export class SynthState {
  private phaseA = 0
  private phaseB = 0

  update(c: SynthControls): SynthUniforms {
    // Advance by a whole frame of samples, in f64 where the product is exact,
    // and hand the shader only the wrapped remainder.
    this.phaseA = fract(
      this.phaseA + (c.synthAHz * FRAME_SAMPLES) / SAMPLE_RATE,
    )
    this.phaseB = fract(
      this.phaseB + (c.synthBHz * FRAME_SAMPLES) / SAMPLE_RATE,
    )
    const a = walk(c.synthAHz, this.phaseA)
    const b = walk(c.synthBHz, this.phaseB)
    return {
      synthPhaseA: a.phase,
      synthPerLineA: a.perLine,
      synthPerSampleA: a.perSample,
      synthPhaseB: b.phase,
      synthPerLineB: b.perLine,
      synthPerSampleB: b.perSample,
    }
  }
}
