import { describe, expect, it } from 'vitest'

import {
  boxWidth,
  BRANCH_Y,
  branchArrow,
  chainLayout,
  LEAD,
  OUT,
  runLabelWidth,
  W,
} from './chainLayout'
import {
  DELAY_LOOP_STAGE,
  LOOP_STAGES,
  MIX_STAGE,
  PHASE_ORDER,
  SOUND_JOIN,
  SOUND_STAGE,
  SOURCE_A_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './controls'

import type { WiredBranch } from './chainLayout'
import type { Phase } from './controls'

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
const B: WiredBranch = { name: SOURCE_B_STAGE, join: MIX_STAGE, under: 'head' }
const SOUND: WiredBranch = {
  name: SOUND_STAGE,
  join: SOUND_JOIN,
  under: 'join',
}
// The view, which hangs off Screen and is fed by it rather than into it.
const VIEW: WiredBranch = {
  name: VIEW_STAGE,
  join: 'Screen',
  under: 'join',
  dir: 'out',
}
const BOTH = [B, SOUND]
// Every box this drawing lays out. The two that are wired to nothing are not on
// it at all now — they are chips under the map (SignalPath), which is why there
// is no free row here to test.
const ALL = [B, SOUND, VIEW]

// Every non-empty subset of the five stages, in chain order — which is exactly
// the set of shapes `groupMatches` can hand the map.
const subsets = (names: string[]): string[][] =>
  Array.from({ length: 1 << names.length }, (_, mask) =>
    names.filter((__, i) => (mask & (1 << i)) !== 0),
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
    expect(l.boxes).toHaveLength(PHASE_ORDER.length)
    // Fed from off the left edge and delivered off the right: the lead-out
    // reaches the edge rather than stopping short of it.
    expect(l.wires.at(-1)?.x1).toBe(W)
    // Boxes run left to right and never touch.
    for (let i = 1; i < l.boxes.length; i++)
      expect(l.boxes[i].x - l.boxes[i].w / 2).toBeGreaterThan(
        l.boxes[i - 1].x + l.boxes[i - 1].w / 2,
      )
  })

  // What made room for a sixth box back when there were six: a box is as wide
  // as its own name, so MIX does not take the same share of a 304-unit row as
  // RECEIVER.
  it('sizes each box to its label', () => {
    const l = chainLayout(FULL)
    const w = (name: Phase) => l.boxes[FULL.indexOf(name)].w
    expect(w('Mix')).toBeLessThan(w('Screen'))
    expect(w('Tape')).toBeLessThan(w('Receiver'))
    expect(w('Source A')).toBeCloseTo(w('Receiver'), 5)
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

  // The three branches share one row, and a filter can squeeze the trunk until
  // two of them want the same place on it. None may end up drawn over another —
  // the same class of bug as the one-stage 280px bar, and just as invisible to a
  // test that counts elements. Every subset, because the crowding only shows up
  // once the trunk is short enough that two joins land on one box.
  //
  it('never lands one branch on top of another', () => {
    for (const names of subsets(FULL)) {
      const { branches } = chainLayout(names, ALL)
      expect(branches).toHaveLength(ALL.length)
      for (const b of branches) expect(b.y).toBe(BRANCH_Y)
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

  // A return is a return only if it comes back from downstream of where it
  // re-enters — and the three re-enter in two different places, which is the
  // whole reason there is no longer one FEEDBACK box for them all to land on.
  // Drop either end and the run has nothing to draw between.
  it('draws a loop only when both of its ends are on the row', () => {
    expect(chainLayout(FULL).returns.map(r => r.loop)).toEqual([
      'camera',
      'mixer',
      'tape',
    ])
    // The camera re-enters at the head of the chain (`compose`, ahead of the
    // encoder) and the other two on the bus out of the mixer, so a filter that
    // leaves the tail of the chain strands all three.
    expect(chainLayout(['Tape', 'Receiver', 'Screen']).returns).toEqual([])
    // With the mixer gone the camera loop still has both its ends.
    expect(
      chainLayout([SOURCE_A_STAGE, 'Screen']).returns.map(r => r.loop),
    ).toEqual(['camera'])
    // The delay loop comes with Mix, because Mix is both of its ends — it is the
    // one return no filter can strand by dropping the stage it taps.
    expect(chainLayout([MIX_STAGE]).returns.map(r => r.loop)).toEqual(['tape'])
    // A tap upstream of the re-entry is not a loop. The delay loop survives: it
    // taps the box it returns to, so there is no downstream for it to be on the
    // wrong side of.
    expect(
      chainLayout(['Screen', SOURCE_A_STAGE, MIX_STAGE]).returns.map(
        r => r.loop,
      ),
    ).toEqual(['tape'])
  })

  // A long return lands on the centre of the box it re-enters and leaves from
  // the centre of the box it taps. A self loop is the one that can silently
  // stop being drawable: it straddles its box, so its ends have to sit *outside*
  // that box and still inside the runs either side — and the box under them
  // narrows with `fit` while the runs do not. Every subset, because only the
  // crowded ones scale `fit` below 1.
  it('lands a return on its box and straddles it for a self loop', () => {
    for (const names of subsets(FULL)) {
      const { boxes, returns, gap } = chainLayout(names, ALL)
      for (const r of returns) {
        const box = boxes.find(b => b.name === r.into)
        if (box === undefined) throw new Error(`${r.loop}: no ${r.into} box`)
        const tap = boxes.find(b => b.name === r.tap)
        if (tap === undefined) throw new Error(`${r.loop}: no ${r.tap} box`)
        if (!r.self) {
          expect(r.to, r.loop).toBeCloseTo(box.x, 9)
          expect(r.from, r.loop).toBeCloseTo(tap.x, 9)
          continue
        }
        // Clear of the box on both sides…
        const out = box.w / 2
        expect(box.x - r.to, r.loop).toBeGreaterThan(out)
        expect(r.from - box.x, r.loop).toBeGreaterThan(out)
        // …and not so far clear that an end reaches the next box along. `gap`
        // is 0 with one stage on the row, and then the ends are out on the
        // lead-in and lead-out, which is still wire.
        const reach = out + Math.max(gap / 2, LEAD, OUT)
        expect(box.x - r.to, r.loop).toBeLessThanOrEqual(reach)
        expect(r.from - box.x, r.loop).toBeLessThanOrEqual(reach)
        // And on the map at all — a self loop on the first box reaches left
        // into the lead-in.
        expect(r.to, r.loop).toBeGreaterThan(0)
        expect(r.from, r.loop).toBeLessThan(W)
      }
    }
  })

  // Each run carries its own name, and where the name sits is the half of that
  // which can go wrong silently: a name off the end of its run reads as a word
  // floating over the chain. Each long return starts its name just clear of the
  // box it lands on and has run left to cover it; the tape loop sets its name
  // outside its own little loop, clear of the knot of wires at the box top.
  it('puts each loop’s name on its own run', () => {
    const { boxes, returns } = chainLayout(FULL)
    for (const r of returns) {
      const box = boxes.find(b => b.name === r.into)
      if (box === undefined) throw new Error(`${r.loop}: no ${r.into} box`)
      if (r.self) {
        // set outside its own loop, and still on the map
        expect(r.nameAt.x, r.loop).toBeLessThan(Math.min(r.from, r.to))
        expect(r.nameAt.x, r.loop).toBeGreaterThan(0)
      } else {
        // on its own horizontal span, and clear of the box it lands on
        const [lo, hi] = [Math.min(r.from, r.to), Math.max(r.from, r.to)]
        expect(r.nameAt.x, r.loop).toBeGreaterThanOrEqual(lo)
        expect(r.nameAt.x, r.loop).toBeLessThanOrEqual(hi)
        expect(r.nameAt.x, r.loop).toBeGreaterThan(box.x + box.w / 2)
      }
    }
  })

  // The map names a loop whatever the panel calls it — its `short`, which is the
  // machine the stage is named for. A run whose label came from anywhere but the
  // loop table could go on saying 'camera' about a stage renamed to something
  // else, and nothing renders wrong. Every subset, because a run only carries a
  // label on the rows where it is drawn at all.
  it('names each run out of the loop table', () => {
    const short = new Map(LOOP_STAGES.map(l => [l.loop, l.short]))
    for (const names of subsets(FULL))
      for (const r of chainLayout(names).returns) {
        expect(r.name, r.loop).toBe(short.get(r.loop))
        expect(r.name, r.loop).not.toBe('')
      }
  })

  // The tape loop's name is the one with a side to pick, and the pick is not
  // cosmetic: to the right of the box it straddles the label lands over the
  // TAPE box, and 'tape loop' over a box marked TAPE is the collision the stage
  // has been renamed twice to avoid (see DELAY_LOOP_STAGE). Left is over the
  // gap between the head of the chain and the mixer, where nothing is called
  // tape — so left whenever it fits, and the fit is the 39 units between the
  // mixer and the camera return's drop.
  it('sets the tape loop’s name away from the deck it is not', () => {
    const { boxes, returns } = chainLayout(FULL)
    const tape = returns.find(r => r.self)
    const box = boxes.find(b => b.name === 'Tape')
    if (tape === undefined || box === undefined) throw new Error('no tape run')
    expect(tape.name).toBe(DELAY_LOOP_STAGE)
    expect(tape.nameAt.anchor).toBe('end') // set leftwards, away from the box
    expect(tape.nameAt.x).toBeLessThan(box.x - box.w / 2)

    // …and to the other side when a filter leaves no room on that one, rather
    // than off the left edge of the drawing. TAPE is not on that row to be
    // confused with, which is what makes the second choice the safe one.
    const tight = chainLayout([MIX_STAGE, 'Receiver', 'Screen'])
    const moved = tight.returns.find(r => r.self)
    expect(moved?.nameAt.anchor).toBe('start')
    expect(moved?.nameAt.x).toBeGreaterThan(0)
  })

  // Whichever side it lands on, a label has to clear the wires that cross its
  // band. The runs drop their verticals from the trunk up to their own height,
  // so a label can only ever collide with a run drawn *above* it — and the tape
  // loop, whose name hangs off the end of a 30-unit run rather than riding a
  // 200-unit one, is the one with nothing but that clearance between it and the
  // next wire. It comes closest on the full row, where 'tape loop' takes 37 of
  // the 39 units between the mixer and the camera return's drop.
  //
  // Over every subset rather than a few by hand. The tightest row turned out to
  // be the full one — the rest of them are 5 units clear or better — which is
  // the opposite of where hand-picked rows would have looked.
  it('keeps every run’s label clear of the wires over it', () => {
    for (const names of subsets(FULL)) {
      const { returns } = chainLayout(names)
      for (const r of returns) {
        const w = runLabelWidth(r.name)
        const [lo, hi] =
          r.nameAt.anchor === 'end'
            ? [r.nameAt.x - w, r.nameAt.x]
            : [r.nameAt.x, r.nameAt.x + w]
        const where = `${r.loop} on a ${names.length}-box row`
        expect(lo, where).toBeGreaterThanOrEqual(0)
        expect(hi, where).toBeLessThanOrEqual(W)
        for (const above of returns.filter(o => o.y < r.y))
          for (const x of [above.from, above.to])
            expect(x < lo || x > hi, `${where}: crosses a wire at ${x}`).toBe(
              true,
            )
      }
    }
  })
})
