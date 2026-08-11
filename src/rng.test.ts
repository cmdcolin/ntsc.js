import { describe, expect, it } from 'vitest'

import { pickOne, randomIndex, rngFor } from './rng'

describe('rngFor', () => {
  // The whole contract in one assertion: this is what a recorded seed is worth,
  // and if it ever stops holding, every take and every vote in the dataset
  // silently stops meaning what it said.
  it('gives the same sequence for the same seed', () => {
    const a = rngFor(12345)
    const b = rngFor(12345)
    const runA = Array.from({ length: 20 }, a)
    const runB = Array.from({ length: 20 }, b)
    expect(runA).toEqual(runB)
  })

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, rngFor(1))
    const b = Array.from({ length: 20 }, rngFor(2))
    expect(a).not.toEqual(b)
  })

  // Pinned literally, not just self-consistently. The test above passes just as
  // happily against a generator someone swapped for a different one, and a
  // swap is exactly the change that would invalidate every seed already
  // written down — so the sequence itself is the fixture.
  it('is mulberry32, and stays mulberry32', () => {
    const first = Array.from({ length: 4 }, rngFor(1)).map(v => +v.toFixed(9))
    expect(first).toEqual([0.627073941, 0.002735721, 0.52744704, 0.981050967])
  })

  // The consumers are index-into-a-list and multiply-by-a-range; either breaks
  // quietly at the wrong bound — an out-of-range index reads `undefined`, and a
  // value that can reach 1 lands one past the end of a list.
  it('stays inside [0, 1)', () => {
    for (const seed of [0, 1, 7, 4294967295, -3]) {
      for (const v of Array.from({ length: 500 }, rngFor(seed))) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    }
  })

  // Seed 0 is what an uninitialised counter looks like, and a generator that
  // answers 0 forever from it would pin every roll on the first item of every
  // list — a fault that reads as "the roll button is broken" rather than as a
  // seeding bug.
  it('runs from a zero seed', () => {
    const run = Array.from({ length: 10 }, rngFor(0))
    expect(new Set(run).size).toBe(10)
  })
})

describe('randomIndex', () => {
  it('spans the list and never reaches its length', () => {
    expect(randomIndex(5, () => 0)).toBe(0)
    expect(randomIndex(5, () => 0.5)).toBe(2)
    // The bound that matters: a generator handing back its supremum must not
    // produce an index one past the end.
    expect(randomIndex(5, () => 0.999999999)).toBe(4)
  })

  it('defaults to unseeded, and stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const n = randomIndex(3)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(3)
    }
  })
})

describe('pickOne', () => {
  it('picks by the generator it is given', () => {
    const xs = ['a', 'b', 'c', 'd']
    expect(pickOne(xs, () => 0)).toBe('a')
    expect(pickOne(xs, () => 0.99)).toBe('d')
  })

  // Both pool sources call this on whatever a network request came back with,
  // where an empty page is an ordinary answer rather than a fault.
  it('reads an empty list as nothing', () => {
    expect(pickOne([], () => 0.5)).toBeNull()
  })

  it('takes the same element from the same seed', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(pickOne(xs, rngFor(99))).toBe(pickOne(xs, rngFor(99)))
  })
})
