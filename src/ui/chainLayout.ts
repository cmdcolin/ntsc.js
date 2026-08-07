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
export const H = 60
// Gap between boxes — the run each wire has to cross — and how far one opens
// when a filter leaves the row with room to spare.
export const GAP = 10
export const GAP_MAX = 26
// The stubs the signal arrives and leaves on, so the chain reads as something
// fed and something delivered rather than six stages that begin nowhere.
export const LEAD = 8
export const OUT = 10
export const MID_Y = 26
// Input B's own row, under the trunk.
export const BRANCH_Y = 50
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

// The two feedback returns, which are two different loops around two different
// parts of the chain — not one arrow drawn twice. The camera loop is optical:
// it points at the tube's face, so it taps the picture after the Screen. The
// mixer loop is electrical: it patches the composite the decoder saw back into
// the bus, so it taps at the Receiver. Both re-enter at the Feedback stage,
// side by side, each on its own run.
//
// Each is routed rather than swooped — up, back along its run, then straight
// down into the stage it feeds, so the wire is vertical where the arrowhead
// sits, which is the only way the two agree.
//
// The camera return is drawn dashed and the mixer return solid, the way a
// schematic separates a light path from a wire — which is the whole difference
// between them, and the map is the one place both are visible at once. Each
// also lights up while its own loop is actually running, so "which loop is on"
// is answered here rather than by opening the stage and reading two mixes.
const RETURNS = [
  {
    from: 'Screen',
    loop: 'camera',
    label: 'camera loop (optical) — the tube, re-shot and fed back in',
    optical: true,
    y: 3,
    turn: 5,
    dx: -7,
  },
  {
    from: 'Receiver',
    loop: 'mixer',
    label:
      'mixer loop (electrical) — the composite the decoder saw, patched back in',
    optical: false,
    y: 11,
    turn: 3,
    dx: 7,
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

// Input B's box and the run out of it. Same routing vocabulary as the returns —
// orthogonal with a rounded corner — so the one wire that comes from below
// reads as the same kind of thing as the two that come from above.
export interface ChainBranch extends ChainBox {
  // Where the wire turns up into the trunk: the centre of the Mix box, because
  // that is the stage B arrives at (feedA / feedB → mixB).
  join: number
}

// B's run: out of its box, along its own row, then up into the box above the
// join. Degenerates to a straight riser when the join is not to the right —
// which is what a filter that has dropped Mix leaves, and the box directly
// above B is then the one it should arrive in anyway.
export function branchPath(b: ChainBranch) {
  const top = MID_Y + BOX_H / 2
  const right = b.x + b.w / 2
  return b.join > right + TURN
    ? `M${right} ${BRANCH_Y}H${b.join - TURN}Q${b.join} ${BRANCH_Y} ${b.join} ${BRANCH_Y - TURN}V${top}`
    : `M${b.join} ${BRANCH_Y - BOX_H / 2}V${top}`
}

// Every coordinate the map draws, worked out from the stage names alone.
export function chainLayout(names: string[], branchName: string | null = null) {
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
  // A return only reads as a return if it comes back from somewhere downstream.
  const feedbackAt = at('Feedback')
  const returns = RETURNS.flatMap(r => {
    const tap = at(r.from)
    return feedbackAt >= 0 && tap > feedbackAt
      ? [{ ...r, from: centers[tap], to: centers[feedbackAt] + r.dx }]
      : []
  })
  // B sits under the head of the trunk, sharing its left edge — the two inputs
  // as a column, which is the whole point of drawing them as a pair. Its wire
  // runs to the Mix box; with Mix filtered out it rises where it stands, which
  // is upstream of whatever the filter did leave.
  const mixAt = at('Mix')
  const branch: ChainBranch | null =
    branchName === null || boxes.length === 0
      ? null
      : (() => {
          const w = boxWidth(branchName) * fit
          const x = boxes[0].x - boxes[0].w / 2 + w / 2
          return {
            name: branchName,
            x,
            w,
            join: mixAt >= 0 ? centers[mixAt] : x,
          }
        })()
  return { width: W, boxes, centers, wires, returns, branch, gap, fit }
}
