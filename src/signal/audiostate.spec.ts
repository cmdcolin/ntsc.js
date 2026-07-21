import { describe, expect, it } from 'vitest'

import { stepHit } from './audiostate'

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
