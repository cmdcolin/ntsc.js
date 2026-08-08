import {
  CAMERA_LOOP_GROUP,
  MIXER_LOOP_GROUP,
  TAPE_LOOP_GROUP,
} from './controls'

// The chain map's arithmetic, with none of its markup (see ChainMap.tsx for the
// drawing). Its own module because a filter hands the map any subset of the six
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
// fed and something delivered rather than six stages that begin nowhere.
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
// That is what let a sixth box onto the row: at equal columns six stages gave
// RECEIVER 38 units for 37 units of text, while TAPE sat in the same 38 with 19.
// MIX asks for a third of what FEEDBACK does, and the difference is exactly the
// room the mixer's own box needed.
export const boxWidth = (name: string) =>
  Math.max(MIN_BOX, name.length * CHAR + PAD)

// The three feedback returns, which are different loops around different parts
// of the chain — not one arrow drawn three times. The camera loop is optical:
// it points at the tube's face, so it taps the picture after the Screen. The
// mixer loop is electrical: it patches the composite the decoder saw back into
// the bus, so it taps at the Receiver. The loop bin is mechanical, and it is
// the one that taps nowhere: `tapePlay` returns onto the bus and `tapeRec` lays
// the sum back down at that same point, so it is a tight loop *across* the
// Feedback node rather than a run around anything. All three re-enter at the
// Feedback stage, each on its own run.
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
// of. Each now carries its own name on its own run — `name`, short enough to
// ride a 304-unit drawing, as against `label`, which is what the hover and the
// screen reader get. Each also lights up while its own loop is actually
// running, so "which loop is on" is answered here rather than by opening the
// stage and reading three mixes.
//
// And each is a button: the run opens the Feedback stage at its own group. That
// is what none of them had ever been — the box under them opened all five of
// the stage's groups at whichever came first, so the loop you could see running
// was not the loop a click reached.
const RETURNS = [
  {
    from: 'Screen',
    loop: 'camera',
    group: CAMERA_LOOP_GROUP,
    name: 'camera',
    label: 'camera loop (optical) — the tube, re-shot and fed back in',
    optical: true,
    y: 7,
    turn: 4,
    dx: -7,
    fromDx: 0,
    self: false,
  },
  {
    from: 'Receiver',
    loop: 'mixer',
    group: MIXER_LOOP_GROUP,
    name: 'mixer',
    label:
      'mixer loop (electrical) — the composite the decoder saw, patched back in',
    optical: false,
    y: 18,
    turn: 4,
    dx: 7,
    fromDx: 0,
    self: false,
  },
  {
    // Both ends on the Feedback box's own top edge, far enough apart to clear
    // the other two arrowheads at ±7 and still land inside the box. It is the
    // shortest run on the map because it is the shortest loop in the rig.
    from: 'Feedback',
    loop: 'tape',
    group: TAPE_LOOP_GROUP,
    name: 'tape',
    label: 'tape loop (mechanical) — a loop bin patched across the bus',
    optical: false,
    y: 29,
    turn: 3,
    dx: -16,
    fromDx: 16,
    self: true,
  },
] as const

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
  // — except the loop bin, which taps the node it re-enters and so is the one
  // return whose two ends are the same box. Both cases need Feedback on the row
  // at all, which a filter can take away.
  const feedbackAt = at('Feedback')
  const returns = RETURNS.flatMap(r => {
    const tap = at(r.from)
    if (feedbackAt < 0 || (r.self ? tap !== feedbackAt : tap <= feedbackAt))
      return []
    const to = centers[feedbackAt] + r.dx
    const from = centers[tap] + r.fromDx
    // Where the run's own name rides it. A run that reaches back across the map
    // has its whole horizontal length to offer, and the name goes at the near
    // end of it — just clear of the Feedback box, so the two read down as a
    // column beside the stage they return to rather than scattering along two
    // different spans.
    //
    // The loop bin gets the other side. Centred on its own run is the obvious
    // place and the wrong one: that run is four units of span between the two
    // arrowheads the long returns land on, so the word comes down in the one
    // spot on the map where three wires converge, and knocking it out of them
    // leaves a knot rather than a label. Set to the left of the loop instead it
    // is clear of every wire, still at its own run's height, and the three names
    // balance either side of the stage they all belong to.
    const nameAt = r.self
      ? { x: Math.min(from, to) - 4, anchor: 'end' as const }
      : {
          x: centers[feedbackAt] + boxes[feedbackAt].w / 2 + 5,
          anchor: 'start' as const,
        }
    return [{ ...r, from, to, nameAt }]
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
