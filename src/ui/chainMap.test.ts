import { describe, expect, it } from 'vitest'

import { chainLayout } from './chainLayout'
import { PHASE_ORDER } from './controls'

// The map divides the panel's width by however many stages a live filter has
// left standing, so its geometry is a function of a subset — and every bug it
// has shipped has been in that arithmetic rather than in the markup. An empty
// chain divided by zero and wrote `NaN` into every attribute (the browser drops
// the element); a one-stage chain divided by one and drew a 280px bar where a
// miniature should be. Neither shows up in a test that renders the component
// and counts elements, so the arithmetic is tested on its own.
const FULL = [...PHASE_ORDER]

// Every non-empty subset of the five stages, in chain order — which is exactly
// the set of shapes `groupMatches` can hand the map.
const subsets = (names: string[]): string[][] =>
  Array.from({ length: 1 << names.length }, (_, mask) =>
    names.filter((_, i) => (mask & (1 << i)) !== 0),
  ).filter(s => s.length > 0)

const numbers = (v: unknown): number[] =>
  typeof v === 'number'
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(numbers)
      : typeof v === 'object' && v !== null
        ? Object.values(v).flatMap(numbers)
        : []

describe('chain map geometry', () => {
  it('draws the full chain across the whole width', () => {
    const l = chainLayout(FULL)
    expect(l.centers).toHaveLength(5)
    // Fed from off the left edge and delivered off the right: the lead-out
    // reaches the edge rather than stopping short of it.
    expect(l.wires.at(-1)?.x1).toBe(l.width)
    // Boxes run left to right and never touch.
    for (let i = 1; i < l.centers.length; i++)
      expect(l.centers[i] - l.boxW / 2).toBeGreaterThan(
        l.centers[i - 1] + l.boxW / 2,
      )
  })

  // The regression: with one stage left, `W / 1` made the box the width of the
  // panel and the miniature stopped reading as a chain.
  it('never stretches a box past its full-chain width', () => {
    const full = chainLayout(FULL).boxW
    for (const names of subsets(FULL))
      expect(chainLayout(names).boxW).toBeLessThanOrEqual(full)
    expect(chainLayout(['Tape']).boxW).toBe(full)
  })

  it('gives every subset finite coordinates', () => {
    for (const names of subsets(FULL)) {
      const found = numbers(chainLayout(names))
      expect(found.length).toBeGreaterThan(0)
      for (const n of found) expect(Number.isFinite(n)).toBe(true)
    }
  })

  // B joins where mixB runs: after Source, before whatever comes next.
  it('joins B into the run just after Source', () => {
    const l = chainLayout(FULL)
    expect(l.join).toBeGreaterThan(l.centers[0] + l.boxW / 2)
    expect(l.join).toBeLessThan(l.centers[1] - l.boxW / 2)
  })

  // A filter can drop Source. B still has to arrive upstream of everything
  // left, or the drawing claims the second input joins in the middle.
  it('joins B upstream of everything when Source is filtered out', () => {
    const l = chainLayout(['Tape', 'Screen'])
    expect(l.join).toBeLessThan(l.centers[0] - l.boxW / 2)
    expect(l.join).toBeGreaterThan(0)
  })

  it('joins B after Source when Source is all that is left', () => {
    const l = chainLayout(['Source'])
    expect(l.join).toBeGreaterThan(l.centers[0] + l.boxW / 2)
    expect(l.join).toBeLessThanOrEqual(l.width)
  })

  // A return is a return only if it comes back from downstream. With Feedback
  // filtered out there is nothing for either to re-enter.
  it('draws a loop only when it taps downstream of Feedback', () => {
    expect(chainLayout(FULL).returns.map(r => r.loop)).toEqual([
      'camera',
      'mixer',
    ])
    expect(chainLayout(['Tape', 'Receiver', 'Screen']).returns).toEqual([])
    expect(
      chainLayout(['Feedback', 'Screen']).returns.map(r => r.loop),
    ).toEqual(['camera'])
    // Feedback downstream of the tap it would re-enter from is not a loop.
    expect(chainLayout(['Screen', 'Feedback']).returns).toEqual([])
  })
})
