import { describe, expect, it } from 'vitest'

import { boxWidth, branchArrow, chainLayout, LEAD, OUT, W } from './chainLayout'
import {
  MIX_STAGE,
  PHASE_ORDER,
  SOUND_JOIN,
  SOUND_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './controls'

import type { BranchSpec } from './chainLayout'

// The map lays out however many stages a live filter has left standing, so its
// geometry is a function of a subset — and every bug it has shipped has been in
// that arithmetic rather than in the markup. An empty chain divided by zero and
// wrote `NaN` into every attribute (the browser drops the element); a one-stage
// chain divided by one and drew a 280px bar where a miniature should be.
// Neither shows up in a test that renders the component and counts elements, so
// the arithmetic is tested on its own.
const FULL = [...PHASE_ORDER]

// The two branches as the app hands them over: input B at the head of the row,
// joining the mixer, and the sound under the receiver it is patched into.
const B: BranchSpec = { name: SOURCE_B_STAGE, join: MIX_STAGE, under: 'head' }
const SOUND: BranchSpec = {
  name: SOUND_STAGE,
  join: SOUND_JOIN,
  under: 'join',
}
// The view, which hangs off Screen and is fed by it rather than into it.
const VIEW: BranchSpec = {
  name: VIEW_STAGE,
  join: 'Screen',
  under: 'join',
  dir: 'out',
}
const BOTH = [B, SOUND]
const ALL = [B, SOUND, VIEW]

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
      const l = chainLayout(names, ALL)
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
      const found = numbers(chainLayout(names, ALL))
      expect(found.length).toBeGreaterThan(0)
      for (const n of found) expect(Number.isFinite(n)).toBe(true)
    }
  })

  // B arrives at the mixer — feedA / feedB → mixB — and sits under the head of
  // the trunk, sharing its left edge so the two inputs read as a column.
  it('runs B up into the Mix box', () => {
    const [b] = chainLayout(FULL, [B]).branches
    expect(b.join).toBe(chainLayout(FULL).centers[FULL.indexOf('Mix')])
    expect(b.x - b.w / 2).toBeCloseTo(
      chainLayout(FULL).boxes[0].x - chainLayout(FULL).boxes[0].w / 2,
      5,
    )
  })

  // The sound is patched into the receiver rather than fed into the front of
  // the chain, so its box sits under that stage and its wire is a riser — the
  // one thing that says "this joins here" rather than "this is a third signal".
  it('rises straight into the stage the sound is patched into', () => {
    const l = chainLayout(FULL, BOTH)
    const sound = l.branches[1]
    expect(sound.join).toBe(l.centers[FULL.indexOf(SOUND_JOIN)])
    expect(sound.x).toBe(sound.join)
    // Its own lead-in, not a run from the left edge: that is B's, and two wires
    // the length of the row under the trunk read as two more signals.
    expect(sound.stub).toBeGreaterThan(l.branches[0].x)
  })

  // The one thing that separates the view from the two inputs, drawn on the
  // same row with the same wire: which end the arrowhead is on. Getting this
  // backwards draws the magnifier as a third source feeding the chain, which is
  // the exact class of mistake the placements exist to prevent.
  it('points an input at the trunk and the view at itself', () => {
    const l = chainLayout(FULL, [SOUND, VIEW])
    const [sound, view] = l.branches.map(branchArrow)
    // In: at the bottom edge of the trunk box it joins, pointing up.
    expect([sound.x, sound.dy]).toEqual([
      l.centers[FULL.indexOf(SOUND_JOIN)],
      -1,
    ])
    // Out: at the top edge of its own box, pointing down into it.
    expect([view.x, view.dy]).toEqual([l.branches[1].x, 1])
    expect(view.y).toBeGreaterThan(sound.y)
  })

  // A filter can drop the stage a branch joins. It still has to arrive
  // somewhere on what is left, and the box directly above it is one of them —
  // so the wire rises where it stands rather than running to a box that is not
  // there.
  it('rises where it stands when the joined stage is filtered out', () => {
    for (const spec of BOTH) {
      const [b] = chainLayout(['Tape', 'Screen'], [spec]).branches
      expect(b.join).toBe(b.x)
    }
  })

  // All three branches share one row, and a filter can squeeze the trunk until
  // two of them want the same place on it. None may end up drawn over another —
  // the same class of bug as the one-stage 280px bar, and just as invisible to a
  // test that counts elements. Every subset, because the crowding only shows up
  // once the trunk is short enough that two joins land on one box.
  it('never lands one branch on top of another', () => {
    for (const names of subsets(FULL)) {
      const { branches } = chainLayout(names, ALL)
      expect(branches).toHaveLength(ALL.length)
      for (let i = 1; i < branches.length; i++)
        expect(branches[i].x - branches[i].w / 2).toBeGreaterThan(
          branches[i - 1].x + branches[i - 1].w / 2,
        )
    }
  })

  it('draws no branch when there is none to draw', () => {
    expect(chainLayout(FULL).branches).toEqual([])
    expect(chainLayout([], ALL).branches).toEqual([])
  })

  // A return is a return only if it comes back from downstream. With Feedback
  // filtered out there is nothing for either to re-enter.
  it('draws a loop only when it taps downstream of Feedback', () => {
    expect(chainLayout(FULL).returns.map(r => r.loop)).toEqual([
      'camera',
      'mixer',
      'tape',
    ])
    expect(chainLayout(['Tape', 'Receiver', 'Screen']).returns).toEqual([])
    // The loop bin comes with Feedback, because Feedback is both of its ends —
    // it is the one return no filter can strand by dropping the stage it taps.
    expect(
      chainLayout(['Feedback', 'Screen']).returns.map(r => r.loop),
    ).toEqual(['camera', 'tape'])
    // Feedback downstream of the tap it would re-enter from is not a loop. The
    // loop bin survives: it taps the box it returns to, so there is no
    // downstream for it to be on the wrong side of.
    expect(
      chainLayout(['Screen', 'Feedback']).returns.map(r => r.loop),
    ).toEqual(['tape'])
  })

  // Each run carries its own name now, and where the name sits is the half of
  // that which can go wrong silently: a name off the end of its run reads as a
  // word floating over the chain. The two long returns start their names just
  // clear of the Feedback box and have run left to cover them; the loop bin
  // centres its name on the little run it has.
  it('puts each loop’s name on its own run', () => {
    const { boxes, returns } = chainLayout(FULL)
    const fb = boxes.find(b => b.name === 'Feedback')
    if (fb === undefined) throw new Error('no Feedback box')
    for (const r of returns) {
      if (r.self) {
        // set outside its own loop, on the far side from the two long runs'
        // names, and still on the map
        expect(r.nameAt.x, r.loop).toBeLessThan(Math.min(r.from, r.to))
        expect(r.nameAt.x, r.loop).toBeGreaterThan(0)
      } else {
        // on its own horizontal span, and clear of the box it lands on
        const [lo, hi] = [Math.min(r.from, r.to), Math.max(r.from, r.to)]
        expect(r.nameAt.x, r.loop).toBeGreaterThanOrEqual(lo)
        expect(r.nameAt.x, r.loop).toBeLessThanOrEqual(hi)
        expect(r.nameAt.x, r.loop).toBeGreaterThan(fb.x + fb.w / 2)
      }
    }
  })
})
