import { describe, expect, it } from 'vitest'

import { rngFor } from '../rng'
import { hallTail, stepHit } from './audiostate'

import type { HitState } from './audiostate'

const START: HitState = { hit: 0, lowPrev: 0, ref: 0.01 }

// run a sequence of low-band energies through the envelope
const run = (levels: number[], from = START): HitState =>
  levels.reduce(stepHit, from)

describe('bass onset envelope', () => {
  it('punches on a kick', () => {
    const s = run([0.1, 0.1, 0.9])
    expect(s.hit).toBeGreaterThan(0.9)
  })

  it('does not hold open on a sustained bassline', () => {
    // the whole point: loud but *steady* low end must not pin the envelope high,
    // or a groove would leave the picture permanently distorted
    const s = run([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
    expect(s.hit).toBeLessThan(0.2)
  })

  it('releases within about a fifth of a second', () => {
    const kicked = run([0.1, 0.9])
    expect(kicked.hit).toBeGreaterThan(0.9)
    // 12 frames at 60 fps
    const later = run(Array<number>(12).fill(0.9), kicked)
    expect(later.hit).toBeLessThan(0.15)
  })

  it('rides quiet material back up to full scale', () => {
    // a faint kick should still read near 1 once the reference decays to it
    const s = run(
      Array<number>(400)
        .fill(0)
        .flatMap((_, i) => (i % 20 === 0 ? [0.05] : [0])),
    )
    expect(s.ref).toBeLessThan(0.06)
  })

  it('never exceeds its clamp', () => {
    const s = run([0, 1000])
    expect(s.hit).toBeLessThanOrEqual(1.5)
  })
})

describe('hall tail', () => {
  const energy = (a: Float32Array) => a.reduce((sum, v) => sum + v * v, 0)

  it('carries unit energy, whatever its length', () => {
    for (const len of [1000, 110250]) {
      const tail = hallTail(new Float32Array(len), rngFor(7))
      expect(energy(tail)).toBeCloseTo(1, 5)
    }
  })

  // The level claim the mix knob rests on: a send at gain 1 returns about as
  // much as it was given, so winding it up adds to the dry instead of washing
  // it out. White in, white through a unit-energy tail, out at the same RMS.
  it('returns what it is given, at gain 1', () => {
    const tail = hallTail(new Float32Array(2048), rngFor(11))
    const rand = rngFor(3)
    const dry = Float32Array.from({ length: 8192 }, () => rand() * 2 - 1)
    let wetEnergy = 0
    for (let i = tail.length; i < dry.length; i++) {
      let acc = 0
      for (let k = 0; k < tail.length; k++) acc += tail[k] * dry[i - k]
      wetEnergy += acc * acc
    }
    const span = dry.length - tail.length
    expect(Math.sqrt(wetEnergy / span)).toBeCloseTo(
      Math.sqrt(energy(dry) / dry.length),
      1,
    )
  })

  it('decays', () => {
    const tail = hallTail(new Float32Array(4096), rngFor(5))
    const half = tail.length / 2
    expect(energy(tail.subarray(half))).toBeLessThan(
      energy(tail.subarray(0, half)) / 10,
    )
  })
})
