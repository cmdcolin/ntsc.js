import { describe, expect, it } from 'vitest'

import { dcState, detect } from './buzz'
import { LINES } from './constants'

// rand() at 0.5 is the midpoint, so the hiss term vanishes and the buzz is the
// only thing under test.
const QUIET = () => 0.5

// A field's worth of line measurements: `mean` IRE for the active lines,
// blanking level for the vertical interval at the top, and `dev` throughout.
const field = (mean: number, dev = 0, blankLines = 20): Float32Array => {
  const tap = new Float32Array(LINES * 2)
  for (let row = 0; row < LINES; row++) {
    tap[row * 2] = row < blankLines ? -8 : mean
    tap[row * 2 + 1] = dev
  }
  return tap
}

// Push `fields` copies of one field through and return the last one's output.
const run = (
  tap: Float32Array,
  fields: number,
  drive = 1,
  rand = QUIET,
): Float32Array => {
  const s = dcState()
  const out = new Float32Array(LINES)
  for (let i = 0; i < fields; i++) detect(tap, out, s, drive, rand)
  return out
}

const rms = (x: Float32Array): number =>
  Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length)

const peak = (x: Float32Array): number =>
  x.reduce((a, v) => Math.max(a, Math.abs(v)), 0)

describe('the sound detector', () => {
  it('rejects the standing level a picture sits at', () => {
    // A steady grey field is a large positive mean on every line. That offset
    // is inaudible and would only eat headroom, so what comes out is the
    // structure riding on it and not the level itself.
    const flat = new Float32Array(LINES * 2).fill(0)
    for (let row = 0; row < LINES; row++) flat[row * 2] = 50
    expect(peak(run(flat, 20))).toBeLessThan(0.01)
  })

  it('hands back the vertical interval as the buzz', () => {
    // The 20 blanked lines at the top of each field are a step against the
    // picture, once per field — which at line rate is the 60 Hz buzz. This is
    // the whole feature: nothing draws it, it is the shape of the signal.
    const out = run(field(60), 20)
    expect(rms(out)).toBeGreaterThan(0.05)
    // and it lands where the interval is, not spread over the picture
    expect(peak(out.subarray(0, 40))).toBeGreaterThan(
      4 * peak(out.subarray(80)),
    )
  })

  it('buzzes louder on a brighter picture', () => {
    // Peak white really does overmodulate, so this ordering is the physics and
    // not a curve someone chose.
    const level = (mean: number) => rms(run(field(mean), 20))
    expect(level(90)).toBeGreaterThan(level(45))
    expect(level(45)).toBeGreaterThan(level(10))
  })

  it('turns within-line deviation into hiss', () => {
    // Snow and fine detail live above line rate, where the per-line mean cannot
    // see them. Without this term a snowy channel would go nearly silent.
    let seed = 1
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    // No vertical interval, so the mean is flat and the deviation is the only
    // thing left that could make a sound.
    expect(peak(run(field(0, 0, 0), 4, 1, rand))).toBe(0)
    // 40 IRE of deviation at the 0.15 mix, uniform: 40 × 0.15 / √3 ≈ 3.5 IRE
    // RMS, a bit over -30 dBFS. Loud enough to hear under a picture's buzz and
    // nowhere near loud enough to bury it.
    const snowy = rms(run(field(0, 40, 0), 4, 1, rand))
    expect(snowy).toBeGreaterThan(0.02)
    expect(snowy).toBeLessThan(0.06)
  })

  it('is silent at zero drive', () => {
    expect(peak(run(field(80, 40), 20, 0))).toBe(0)
  })

  it('cannot be driven past full scale', () => {
    // This reaches someone's speakers, so no control setting and no runaway
    // upstream may put a full-scale square wave through them.
    const out = run(field(100, 100), 20, 1000)
    expect(peak(out)).toBeLessThanOrEqual(1)
  })
})
