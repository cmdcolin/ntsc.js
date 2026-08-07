import { describe, expect, it } from 'vitest'

import { boxWidth, chainLayout, LEAD, OUT, W } from './chainLayout'
import { PHASE_ORDER, SOURCE_B_STAGE } from './controls'

// The map lays out however many stages a live filter has left standing, so its
// geometry is a function of a subset — and every bug it has shipped has been in
// that arithmetic rather than in the markup. An empty chain divided by zero and
// wrote `NaN` into every attribute (the browser drops the element); a one-stage
// chain divided by one and drew a 280px bar where a miniature should be.
// Neither shows up in a test that renders the component and counts elements, so
// the arithmetic is tested on its own.
const FULL = [...PHASE_ORDER]

// Every non-empty subset of the six stages, in chain order — which is exactly
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
    expect(l.boxes).toHaveLength(6)
    // Fed from off the left edge and delivered off the right: the lead-out
    // reaches the edge rather than stopping short of it.
    expect(l.wires.at(-1)?.x1).toBe(W)
    // Boxes run left to right and never touch.
    for (let i = 1; i < l.boxes.length; i++)
      expect(l.boxes[i].x - l.boxes[i].w / 2).toBeGreaterThan(
        l.boxes[i - 1].x + l.boxes[i - 1].w / 2,
      )
  })

  // What made room for the sixth box: a box is as wide as its own name, so MIX
  // does not take the same share of a 304-unit row as FEEDBACK.
  it('sizes each box to its label', () => {
    const l = chainLayout(FULL)
    const w = (name: string) => l.boxes[FULL.indexOf(name)].w
    expect(w('Mix')).toBeLessThan(w('Feedback'))
    expect(w('Tape')).toBeLessThan(w('Receiver'))
    expect(w('Source A')).toBeCloseTo(w('Feedback'), 5)
  })

  // The regression, restated for a row that is no longer equal columns: with
  // one stage left, `W / 1` made the box the width of the panel. A box is never
  // wider than its own label asks for — only ever squeezed to fit the row.
  it('never stretches a box past what its label asks for', () => {
    for (const names of subsets(FULL)) {
      const l = chainLayout(names)
      expect(l.fit).toBeLessThanOrEqual(1)
      for (const box of l.boxes)
        expect(box.w).toBeLessThanOrEqual(boxWidth(box.name) + 1e-9)
    }
    expect(chainLayout(['Tape']).boxes[0].w).toBe(boxWidth('Tape'))
  })

  // The other half of fitting: the row cannot run off the right edge either,
  // however wide the labels of whatever the filter left.
  it('keeps every subset inside the map', () => {
    for (const names of subsets(FULL)) {
      const l = chainLayout(names, SOURCE_B_STAGE)
      const last = l.boxes.at(-1)
      expect(last === undefined ? 0 : last.x + last.w / 2).toBeLessThanOrEqual(
        W - OUT + 1e-9,
      )
      expect(l.boxes[0].x - l.boxes[0].w / 2).toBeGreaterThanOrEqual(
        LEAD - 1e-9,
      )
    }
  })

  it('gives every subset finite coordinates', () => {
    for (const names of [...subsets(FULL), []]) {
      const found = numbers(chainLayout(names, SOURCE_B_STAGE))
      expect(found.length).toBeGreaterThan(0)
      for (const n of found) expect(Number.isFinite(n)).toBe(true)
    }
  })

  // B arrives at the mixer — feedA / feedB → mixB — and sits under the head of
  // the trunk, sharing its left edge so the two inputs read as a column.
  it('runs B up into the Mix box', () => {
    const l = chainLayout(FULL, SOURCE_B_STAGE)
    expect(l.branch?.join).toBe(l.boxes[FULL.indexOf('Mix')].x)
    expect(l.branch === null ? -1 : l.branch.x - l.branch.w / 2).toBeCloseTo(
      l.boxes[0].x - l.boxes[0].w / 2,
      5,
    )
  })

  // A filter can drop Mix. B still has to arrive somewhere upstream of what is
  // left, and the box directly above it is upstream of everything by
  // definition — so the wire rises where it stands rather than running to a
  // box that isn't there.
  it('rises where it stands when Mix is filtered out', () => {
    const l = chainLayout(['Tape', 'Screen'], SOURCE_B_STAGE)
    expect(l.branch?.join).toBe(l.branch?.x)
    expect(l.branch?.join).toBeLessThan(l.boxes[0].x + l.boxes[0].w / 2)
  })

  it('draws no branch when there is none to draw', () => {
    expect(chainLayout(FULL).branch).toBe(null)
    expect(chainLayout([], SOURCE_B_STAGE).branch).toBe(null)
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
