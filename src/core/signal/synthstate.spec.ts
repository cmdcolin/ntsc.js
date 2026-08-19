import { describe, expect, it } from 'vitest'

import { F_H, LINES, SAMPLE_RATE, SAMPLES_PER_LINE } from './constants'
import { SynthState } from './synthstate'

import type { SynthControls } from './synthstate'

const STILL: SynthControls = { synthAHz: 0, synthBHz: 0 }

const step = (s: SynthState, c: Partial<SynthControls>, n: number) => {
  let out = s.update({ ...STILL, ...c })
  for (let i = 1; i < n; i++) out = s.update({ ...STILL, ...c })
  return out
}

// What the shader computes: phase in cycles at (row, sample).
const phaseAt = (u: ReturnType<SynthState['update']>, row: number, s: number) =>
  u.synthPhaseA + u.synthPerLineA * row + u.synthPerSampleA * s

describe('SynthState', () => {
  it('holds an unpatched oscillator at zero', () => {
    const out = step(new SynthState(), {}, 30)
    expect(out.synthPhaseA).toBe(0)
    expect(out.synthPerLineA).toBe(0)
    expect(out.synthPerSampleA).toBe(0)
  })

  // The mechanism the whole instrument rests on: an oscillator on an exact
  // multiple of line rate walks zero phase per line, so every line starts the
  // wave in the same place and the bars stand up straight. This is what makes
  // the leaning ones lean.
  it('walks no phase per line at an exact multiple of line rate', () => {
    const out = step(new SynthState(), { synthAHz: F_H * 8 }, 1)
    expect(out.synthPerLineA).toBeCloseTo(0, 9)
    // and eight whole cycles across a line
    expect(out.synthPerSampleA * SAMPLES_PER_LINE).toBeCloseTo(8, 9)
  })

  // Detuned off line rate, the per-line walk is the lean, and it is exactly the
  // fraction of a cycle the extra hertz buy in one line's worth of time.
  it('leans by the frequency error against line rate', () => {
    const out = step(new SynthState(), { synthAHz: F_H + 100 }, 1)
    expect(out.synthPerLineA).toBeCloseTo(100 / F_H, 9)
  })

  it('accumulates phase across frames so the pattern creeps', () => {
    const s = new SynthState()
    const one = step(s, { synthAHz: F_H + 100 }, 1).synthPhaseA
    const two = step(s, { synthAHz: F_H + 100 }, 1).synthPhaseA
    expect(one).not.toBe(two)
    // one frame of a 100 Hz error against line rate, wrapped
    const perFrame = (100 * SAMPLES_PER_LINE * LINES) / SAMPLE_RATE
    expect(two - one - (perFrame % 1)).toBeCloseTo(0, 6)
  })

  it('keeps phase in cycles, wrapped', () => {
    const out = step(new SynthState(), { synthAHz: 1e6 }, 40)
    expect(out.synthPhaseA).toBeGreaterThanOrEqual(0)
    expect(out.synthPhaseA).toBeLessThan(1)
  })

  // Splitting the walk has to reconstruct the same phase the unsplit product
  // would, modulo a whole cycle — otherwise the pattern is simply in the wrong
  // place and nothing else here would notice.
  it('reconstructs the true phase at the far corner of the frame', () => {
    const hz = 3579545
    const out = step(new SynthState(), { synthAHz: hz }, 1)
    const row = LINES - 1
    const s = SAMPLES_PER_LINE - 1
    const truth =
      out.synthPhaseA + (hz * (row * SAMPLES_PER_LINE + s)) / SAMPLE_RATE
    const got = phaseAt(out, row, s)
    expect((got - truth) % 1).toBeCloseTo(0, 6)
  })

  it('runs the two oscillators independently', () => {
    const out = step(new SynthState(), { synthAHz: F_H, synthBHz: 60 }, 5)
    expect(out.synthPerSampleA).not.toBe(out.synthPerSampleB)
    expect(out.synthPhaseA).not.toBe(out.synthPhaseB)
  })
})
