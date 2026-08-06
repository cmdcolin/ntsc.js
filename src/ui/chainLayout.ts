// The chain map's arithmetic, with none of its markup (see ChainMap.tsx for the
// drawing). Its own module because a filter hands the map any subset of the five
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
export const H = 54
// Gap between boxes — the run each wire has to cross.
export const GAP = 12
// The left margin the two input tags sit in, ahead of the first box.
export const GUTTER = 13
export const MID_Y = 26
// The B branch's own row, under the trunk.
export const BRANCH_Y = 46
export const BOX_H = 13
// Half-width of a return wire's arrowhead.
export const HEAD = 2.5
// Corner radius on a routed wire.
export const TURN = 4
// What a stage gets when all five trunk stages are on the map. It is also the
// most one may have — see the 280px bar above.
const MAX_STEP = (W - GUTTER) / 5

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

// The B branch's wire: out of its box, along its own row, then up into the
// trunk. Same routing vocabulary as the returns — orthogonal with a rounded
// corner — so the one wire that comes from below reads as the same kind of
// thing as the two that come from above.
export function branchPath(from: number, to: number, y: number) {
  return `M${from} ${y}H${to - TURN}Q${to} ${y} ${to} ${y - TURN}V${MID_Y + 3}`
}

// Every coordinate the map draws, worked out from the stage names alone.
export function chainLayout(names: string[]) {
  const step = Math.min((W - GUTTER) / names.length, MAX_STEP)
  const boxW = step - GAP
  const centers = names.map((_, i) => GUTTER + step * (i + 0.5))
  const last = names.length - 1
  const feedbackAt = names.indexOf('Feedback')
  // Box to box down the row, plus the lead in off the left edge and the lead
  // out off the right — so the chain reads as something fed and something
  // delivered, rather than as five stages that begin and end nowhere.
  const wires = [
    { key: 'in', x0: GUTTER - 4, x1: centers[0] - boxW / 2 },
    ...centers.slice(0, -1).map((c, i) => ({
      key: names[i],
      x0: c + boxW / 2,
      x1: centers[i + 1] - boxW / 2,
    })),
    {
      key: 'out',
      x0: centers[last] + boxW / 2,
      x1: Math.min(W, centers[last] + boxW / 2 + 10),
    },
  ]
  // A return only reads as a return if it comes back from somewhere downstream.
  const returns = RETURNS.flatMap(r => {
    const at = names.indexOf(r.from)
    return feedbackAt >= 0 && at > feedbackAt
      ? [{ ...r, from: centers[at], to: centers[feedbackAt] + r.dx }]
      : []
  })
  // Where B joins: the run just after Source, which is where mixB sits in the
  // pass order (feedA / feedB → mixB → fbComposite). A filter can leave Source
  // out, and then there is no such run — B joins the lead-in instead, which is
  // still upstream of everything the filter left standing.
  const sourceAt = names.indexOf('Source')
  const join =
    sourceAt < 0
      ? (GUTTER - 4 + centers[0] - boxW / 2) / 2
      : sourceAt === last
        ? centers[last] + boxW / 2 + 5
        : (centers[sourceAt] + boxW / 2 + centers[sourceAt + 1] - boxW / 2) / 2
  return { width: W, step, boxW, centers, wires, returns, join }
}
