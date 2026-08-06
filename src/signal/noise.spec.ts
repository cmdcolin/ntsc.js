import { describe, expect, it } from 'vitest'

import { Lorenz, StickSlip, Wow, valueNoise } from './noise'

describe('valueNoise', () => {
  it('is bounded, continuous, and returns lattice points exactly', () => {
    const a = valueNoise(3, 7)
    const b = valueNoise(4, 7)
    expect(valueNoise(3.0, 7)).toBe(a) // integer t hits the lattice
    // smoothstep interpolates monotonically toward the next lattice value
    const mid = valueNoise(3.5, 7)
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b))
    expect(mid).toBeLessThanOrEqual(Math.max(a, b))
    for (let t = 0; t < 50; t += 0.13) {
      expect(Math.abs(valueNoise(t, 1))).toBeLessThanOrEqual(1)
    }
  })

  it('decorrelates across seeds', () => {
    expect(valueNoise(2.5, 1)).not.toBe(valueNoise(2.5, 2))
  })
})

describe('Lorenz', () => {
  it('does not diverge even with a large step', () => {
    const l = new Lorenz()
    let last = 0
    for (let i = 0; i < 500; i++) last = l.step(0.2)
    expect(Number.isFinite(last)).toBe(true)
    expect(Math.abs(last)).toBeLessThan(1.2)
  })
})

describe('StickSlip', () => {
  it('builds slowly, snaps back fast, and stays bounded', () => {
    const s = new StickSlip(() => 0.5)
    const xs: number[] = []
    for (let i = 0; i < 2000; i++) xs.push(s.step())
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(1.5)
    const diffs = xs.slice(1).map((v, i) => v - xs[i])
    // a relaxation oscillator is asymmetric: most lines are the slow build...
    expect(
      diffs.filter(d => d > 0 && d <= 0.008 + 1e-9).length,
    ).toBeGreaterThan(1200)
    // ...punctuated by snaps an order of magnitude steeper than any build step
    expect(diffs.filter(d => d < -0.05).length).toBeGreaterThan(5)
  })

  it('never settles into one period', () => {
    // Random grips plus tension stranded by re-grabs mid-ring: with a varying
    // rand the gaps between snaps must not collapse to a single cycle length.
    let seed = 1
    const lcg = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const s = new StickSlip(lcg)
    const xs: number[] = []
    for (let i = 0; i < 6000; i++) xs.push(s.step())
    const snaps: number[] = []
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] < -0.05) snaps.push(i)
    }
    const gaps = new Set(
      snaps
        .slice(1)
        .map((v, i) => v - snaps[i])
        .filter(g => g > 3),
    )
    expect(gaps.size).toBeGreaterThan(3)
  })
})

describe('Wow', () => {
  it('stays bounded and does not repeat like a single sine', () => {
    const w = new Wow(() => 0.5) // deterministic drift
    const samples: number[] = []
    for (let f = 0; f < 600; f++) {
      w.advance(1 / 60)
      samples.push(w.at(f / 60, 0.5))
    }
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1.1)
    // a pure 0.6 Hz sine over 10 s would repeat every 100 frames; the quasi-
    // periodic sum should not line up with any single-period shift
    const period = 100
    let err = 0
    for (let i = 0; i < samples.length - period; i++) {
      err += Math.abs(samples[i] - samples[i + period])
    }
    expect(err / (samples.length - period)).toBeGreaterThan(0.1)
  })
})
