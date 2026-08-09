import {
  CAMERA_LOOP_STAGE,
  LOOP_STAGES,
  MIX_STAGE,
  MIXER_LOOP_STAGE,
  SOURCE_A_STAGE,
  TAPE_LOOP_STAGE,
} from './controls'

import type { LoopPlace } from './controls'

// The chain map's arithmetic, with none of its markup (see ChainMap.tsx for the
// drawing). Its own module because a filter hands the map any subset of the
// stages, and every bug it has shipped has been in this arithmetic rather than
// in the elements: an empty chain divided the width by zero and wrote `NaN` into
// every attribute, which the browser drops; a one-stage chain divided it by one
// and drew a 280px bar where a miniature belongs. Neither is visible to a test
// that renders the component and counts elements — both are one assertion away
// from a function that returns numbers (chainMap.test.ts).
//
// The svg stretches to its container, so every size here is really a ratio — but
// the units are px at the sidebar's width, so the labels come out at the size
// they say.
export const W = 304
// The band above the trunk holds the loops, and it grew from 18 units to 36 so
// each of them can carry its own name. Two unlabelled runs 8 apart said there
// were two loops and nothing about which; a hover said the rest, which is an
// answer you have to already suspect the question of. The whole map costs 18
// more units of sidebar — about 18 screen px at the panel's width — and it is
// the same 18 that let the third loop in, so the miniature stops disagreeing
// with the full diagram about how many there are.
export const H = 78
// Gap between boxes — the run each wire has to cross — and how far one opens
// when a filter leaves the row with room to spare.
export const GAP = 10
export const GAP_MAX = 26
// The stubs the signal arrives and leaves on, so the chain reads as something
// fed and something delivered rather than a row of stages that begins nowhere.
export const LEAD = 8
export const OUT = 10
export const MID_Y = 44
// The branch row, under the trunk: input B at its head and the sound under the
// receiver, both joining from below.
export const BRANCH_Y = 68
// Taller than the 13 the map shipped with: at that height a box was 14 screen
// pixels of hairline outline, which is a legend, not something a first visit
// reads as pressable. See ChainMap.module.css for the other half of that.
export const BOX_H = 16
// Half-width of a wire's arrowhead.
export const HEAD = 2.5
// Corner radius on a routed wire.
export const TURN = 4

// What a label costs, per uppercase character at the map's 8px type. Measured
// in Firefox against .mapLabel's own rules (system-ui, letter-spacing .02em):
// the widest real label averages 5.07 units a character and a lone 'A' costs
// 5.28, so 5.4 buys slack on a platform whose system font is wider than this
// one's. It only has to be *proportionally* right in any case — `fit` below
// scales the whole row to the width available, so a generous estimate spends
// padding rather than overflowing the map.
const CHAR = 5.4
// Breathing room inside a box, both sides together.
const PAD = 8
// A short label still needs to read as a box rather than a dot on the wire.
const MIN_BOX = 20

// Boxes are sized to what they say rather than to an equal share of the width.
// That is what let a sixth box onto the row back when the trunk had six: at
// equal columns RECEIVER got 38 units for 37 units of text while TAPE sat in
// the same 38 with 19. MIX asks for half of what RECEIVER does, and giving the
// difference back is what buys the shorter names their padding.
export const boxWidth = (name: string) =>
  Math.max(MIN_BOX, name.length * CHAR + PAD)

// The three feedback returns, which are different loops around different parts
// of the chain — not one arrow drawn three times, and not three arrows landing
// on one box either. That is what the drawing used to say, because a 'Feedback'
// stage sat on the trunk and all three re-entered *it*; the pass graph says
// otherwise (gpu/pipeline.ts), and the difference is the whole reason the three
// are worth telling apart:
//
//   camera — optical, and the only one that reaches back past the decoder: it
//     shoots the tube's face, so it taps after the Screen, and `compose` mixes
//     it in ahead of the encoder — which is inside Source A, before this signal
//     is a composite waveform at all.
//   mixer — electrical: `fbComposite` crossfades the bus against itself
//     straight after the A/B sum, so it re-enters at Mix, and it taps at the
//     Receiver because what goes round is the composite the decoder saw.
//   tape — mechanical, and the one that taps nowhere: `tapePlay` returns onto
//     the bus and `tapeRec` lays the sum back down at that same point, one pass
//     later. So it is a tight loop *across* the mixer's output rather than a
//     run around anything, which is why `self` is a field and not a special
//     case — the filter rules below are different for a return whose two ends
//     are one box.
//
// Each is routed rather than swooped — up, back along its run, then straight
// down into the stage it feeds, so the wire is vertical where the arrowhead
// sits, which is the only way the three agree.
//
// The camera return is drawn dashed and the other two solid, the way a
// schematic separates a light path from a wire. That was once the *whole*
// difference between them here, which is why the map used to be the one place
// both were visible and still could not say which was which: a hover carried
// the names, and a hover is an answer you have to already suspect the question
// of. Each now carries its own name on its own run — `short`, off LOOP_STAGES,
// because it has to ride a 304-unit drawing — and lights up while its own loop
// is actually running, so "which loop is on" is answered here rather than by
// opening a stage and reading three mixes.
//
// And each is the way into its own stage: a run is the box for a machine that
// has no place on the trunk to draw one.
interface ReturnSpec {
  // The stage it taps — where the wire leaves the chain. Named `tap` and not
  // `from` because the layout below hands back a `from`, and that one is the
  // x it leaves at: a spec is stage names and an output is coordinates.
  tap: string
  // The stage it re-enters — where the arrowhead lands.
  into: string
  loop: LoopPlace
  // The panel stage the run opens.
  stage: string
  optical: boolean
  // Which band it rides, and the corner radius at that height.
  y: number
  turn: number
  // A return whose two ends are the same box, drawn straddling it — see
  // SELF_STRADDLE. The other two land on the centre of what they tap and what
  // they re-enter, so they need no offsets at all.
  self: boolean
}

// How far outside its box a self loop's two ends sit. MIX is the narrowest box
// on the row, and stacking a self loop's pair on its top edge beside the mixer
// loop's single arrowhead put three verticals inside 16 units of a 24-unit box:
// a knot rather than three wires. Straddling the box says the same thing better
// — a machine patched *across* one node, which is what a loop bin is — and it
// leaves the mixer loop alone on the box top. Comfortably inside GAP, so the
// ends stay on the runs either side and never reach the next box.
const SELF_STRADDLE = 5

const RETURNS: readonly ReturnSpec[] = [
  {
    tap: 'Screen',
    into: SOURCE_A_STAGE,
    loop: 'camera',
    stage: CAMERA_LOOP_STAGE,
    optical: true,
    y: 7,
    turn: 4,
    self: false,
  },
  {
    tap: 'Receiver',
    into: MIX_STAGE,
    loop: 'mixer',
    stage: MIXER_LOOP_STAGE,
    optical: false,
    y: 18,
    turn: 4,
    self: false,
  },
  {
    // Straddling the mixer's box rather than landing on it twice. It is the
    // shortest run on the map because it is the shortest loop in the rig: it
    // leaves the bus and returns to it at the same node, one pass apart.
    tap: MIX_STAGE,
    into: MIX_STAGE,
    loop: 'tape',
    stage: TAPE_LOOP_STAGE,
    optical: false,
    y: 29,
    turn: 3,
    self: true,
  },
]

// The short word each run carries, off the one loop table, so the map cannot
// name a loop something the panel does not call it. Falls back to the placement
// key, which is the word the table's own `short` is: a loop added to RETURNS
// and not to LOOP_STAGES draws its own name rather than a blank.
const shortOf = (loop: LoopPlace): string =>
  LOOP_STAGES.find(l => l.loop === loop)?.short ?? loop

export function returnPath(
  from: number,
  to: number,
  top: number,
  y: number,
  turn: number,
) {
  return `M${from} ${top}V${y + turn}Q${from} ${y} ${from - turn} ${y}H${to + turn}Q${to} ${y} ${to} ${y + turn}V${top}`
}

// A box on the map: where it sits and how wide its own name made it.
export interface ChainBox {
  name: string
  x: number
  w: number
}

// A branch the caller wants drawn: something wired to one trunk stage rather
// than passing along the trunk. Three of them — input B, which joins at the
// mixer, the sound, which joins at the receiver, and the view, which is fed by
// the screen.
export interface BranchSpec {
  name: string
  // The trunk stage its wire runs to.
  join: string
  // Where its own box sits on the branch row. 'head' is under the head of the
  // trunk, sharing its left edge: the two inputs read as a column, which is the
  // whole point of drawing B there rather than beside the stage it feeds.
  // 'join' is directly under that stage, which is the only honest place for
  // something wired to one stage and nothing else — it meets the trunk where it
  // meets it, and the wire is a riser rather than a run along the row.
  under: 'head' | 'join'
  // Which way the signal goes, which is the whole difference between the two
  // inputs and the view. Both are drawn on the same row with the same wire; the
  // arrowhead is what says one is patched *into* the chain and the other is fed
  // *by* it. Without it the View box reads as a third source, which is the one
  // thing it is not. Defaults to 'in'.
  dir?: 'in' | 'out'
}

// A branch's box and the run out of it. Same routing vocabulary as the returns —
// orthogonal with a rounded corner — so the wires that come from below read as
// the same kind of thing as the two that come from above.
export interface ChainBranch extends ChainBox {
  // Where the wire turns up into the trunk: the centre of the box it joins.
  join: number
  // Where the wire *into* this box starts. An input arrives from off the left
  // edge like the trunk does; something wired to one stage arrives on a stub of
  // its own, so its lead-in cannot be read as a second signal running the length
  // of the row. An 'out' branch has no lead of its own — nothing arrives at it
  // from anywhere but the trunk — so its stub sits on its own box edge and draws
  // nothing.
  stub: number
  dir: 'in' | 'out'
}

// Where a branch's arrowhead sits and which way it points, as a unit vector, so
// the drawing does not have to re-derive which of branchPath's three routings it
// got. An 'in' branch points at the trunk box it joins; an 'out' branch points
// back at its own box, at whichever edge the wire actually meets it on.
export function branchArrow(b: ChainBranch): {
  x: number
  y: number
  dx: number
  dy: number
} {
  const right = b.x + b.w / 2
  const left = b.x - b.w / 2
  if (b.dir === 'in') {
    return { x: b.join, y: MID_Y + BOX_H / 2, dx: 0, dy: -1 }
  }
  if (b.join > right + TURN) return { x: right, y: BRANCH_Y, dx: -1, dy: 0 }
  if (b.join < left - TURN) return { x: left, y: BRANCH_Y, dx: 1, dy: 0 }
  return { x: b.join, y: BRANCH_Y - BOX_H / 2, dx: 0, dy: 1 }
}

// A branch's run: out of its box, along its own row, then up into the box above
// the join. Degenerates to a straight riser when the join is directly above —
// which is both what a 'join'-anchored branch normally wants and what a filter
// that has dropped B's mixer leaves, the box directly above B being upstream of
// everything left by definition. Routes left as well as right because a crowded
// row can push a box past the stage it feeds.
export function branchPath(b: ChainBranch) {
  const top = MID_Y + BOX_H / 2
  const right = b.x + b.w / 2
  const left = b.x - b.w / 2
  if (b.join > right + TURN) {
    return `M${right} ${BRANCH_Y}H${b.join - TURN}Q${b.join} ${BRANCH_Y} ${b.join} ${BRANCH_Y - TURN}V${top}`
  }
  if (b.join < left - TURN) {
    return `M${left} ${BRANCH_Y}H${b.join + TURN}Q${b.join} ${BRANCH_Y} ${b.join} ${BRANCH_Y - TURN}V${top}`
  }
  return `M${b.join} ${BRANCH_Y - BOX_H / 2}V${top}`
}

// Every coordinate the map draws, worked out from the stage names alone.
export function chainLayout(names: string[], specs: BranchSpec[] = []) {
  const asked = names.map(boxWidth)
  const total = asked.reduce((n, w) => n + w, 0)
  const runs = Math.max(names.length - 1, 0)
  // The row is laid out at the width its labels ask for, then made to fit: with
  // room to spare the gaps open (up to GAP_MAX) and the boxes keep their size,
  // and when there is not enough the gaps hold at GAP and every box is scaled
  // by the same factor. One of the two is always in play, so the drawing can
  // never run off the right edge however the estimate above lands.
  const spare = W - LEAD - OUT - total
  const gap =
    runs === 0 ? 0 : Math.max(GAP, Math.min(GAP_MAX, spare / Math.max(runs, 1)))
  // Never above 1: a box is only ever squeezed to fit the row, never stretched
  // to fill it. Growing one was the old bug — dividing the full width by a
  // filtered-down stage count drew a 280px bar where a miniature belongs.
  const fit =
    spare < GAP * runs ? Math.min(1, (W - LEAD - OUT - gap * runs) / total) : 1
  let cursor = LEAD
  const boxes: ChainBox[] = names.map((name, i) => {
    const w = asked[i] * fit
    const box = { name, x: cursor + w / 2, w }
    cursor += w + gap
    return box
  })
  const centers = boxes.map(b => b.x)
  const at = (name: string) => names.indexOf(name)
  const last = boxes.length - 1
  // Box to box down the row, plus the lead in off the left edge and the lead
  // out off the right.
  const wires = [
    ...(boxes.length === 0
      ? []
      : [{ key: 'in', x0: 0, x1: boxes[0].x - boxes[0].w / 2 }]),
    ...boxes.slice(0, -1).map((b, i) => ({
      key: b.name,
      x0: b.x + b.w / 2,
      x1: boxes[i + 1].x - boxes[i + 1].w / 2,
    })),
    ...(boxes.length === 0
      ? []
      : [{ key: 'out', x0: boxes[last].x + boxes[last].w / 2, x1: W }]),
  ]
  // A return only reads as a return if it comes back from somewhere downstream
  // of where it re-enters — except the loop bin, which taps the box it returns
  // to and so is the one return whose two ends are the same. Both cases need
  // both of their stages on the row, which a filter can take away.
  //
  // A self loop's two ends are taken off the box's own edges rather than from a
  // fixed offset: a squeezed row narrows every box, and a pair pinned at ±8
  // while the box between them shrank to 14 would end up straddling nothing.
  const returns = RETURNS.flatMap(r => {
    const tap = at(r.tap)
    const back = at(r.into)
    if (tap < 0 || back < 0 || (r.self ? tap !== back : tap <= back)) return []
    const straddle = boxes[back].w / 2 + SELF_STRADDLE
    const to = r.self ? centers[back] - straddle : centers[back]
    const from = r.self ? centers[tap] + straddle : centers[tap]
    // Where the run's own name rides it. A run that reaches back across the map
    // has its whole horizontal length to offer, and the name goes at the near
    // end of it — just clear of the box it lands on, so a name sits beside its
    // own arrowhead rather than somewhere along a span shared with two others.
    //
    // The loop bin gets the other side of the box it straddles. Centred on its
    // own run is the obvious place and the wrong one: that span is the box
    // itself, so the word comes down on top of the stage name and the two
    // arrowheads either side of it. Set to the left of the loop instead it is
    // clear of every wire and still at its own run's height.
    const edge = boxes[back].x + boxes[back].w / 2
    const nameAt = r.self
      ? { x: Math.min(from, to) - 4, anchor: 'end' as const }
      : { x: edge + 5, anchor: 'start' as const }
    return [{ ...r, name: shortOf(r.loop), from, to, nameAt }]
  })
  // The branch row, laid out left to right with a cursor: each box takes the
  // place its anchor asks for, and is pushed right if that would land it on the
  // box before it. Without the cursor a filter that leaves two stages standing
  // draws both branches on top of each other — the same class of bug as the
  // one-stage 280px bar, and just as invisible to a test that counts elements.
  //
  // A branch whose join stage the filter dropped falls back to the last box:
  // whatever is left, the sound still arrives inside the set, and a wire to a
  // box that isn't there is a wire to nowhere.
  let edge = -Infinity
  const branches: ChainBranch[] =
    boxes.length === 0
      ? []
      : specs.map(spec => {
          const w = boxWidth(spec.name) * fit
          const joinAt = at(spec.join)
          const target = joinAt >= 0 ? centers[joinAt] : centers[last]
          const want =
            spec.under === 'head' ? boxes[0].x - boxes[0].w / 2 + w / 2 : target
          const x = Math.max(want, edge + GAP + w / 2)
          edge = x + w / 2
          const dir = spec.dir ?? 'in'
          return {
            name: spec.name,
            x,
            w,
            join: joinAt >= 0 ? target : x,
            dir,
            stub:
              dir === 'out'
                ? x - w / 2
                : spec.under === 'head'
                  ? 0
                  : x - w / 2 - LEAD,
          }
        })
  return { width: W, boxes, centers, wires, returns, branches, gap, fit }
}
