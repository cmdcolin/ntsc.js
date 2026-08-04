import styles from './ChainMap.module.css'
import { cx } from './cx'

import type { Phase } from './controls'

// The chain in miniature at the head of the sidebar: a box per stage, wired
// left to right in the order the picture travels, with the two feedback returns
// looping back over the top. Clicking a box opens that stage's controls below,
// so this is the sidebar's navigation rather than an illustration of it.
//
// State reads as colour on one element: dim until you point at it, amber for a
// stage carrying an edit, accent for the stage that is open.
//
// The svg stretches to its container, so every size below is really a ratio —
// but the units are px at the sidebar's width, so the labels come out at the
// size they say.
const W = 304
const H = 34
// Gap between boxes — the run each wire has to cross.
const GAP = 12
const MID_Y = 26
const BOX_H = 13
// Half-width of a return wire's arrowhead.
const HEAD = 2.5

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

function returnPath(
  from: number,
  to: number,
  top: number,
  y: number,
  turn: number,
) {
  return `M${from} ${top}V${y + turn}Q${from} ${y} ${from - turn} ${y}H${to + turn}Q${to} ${y} ${to} ${y + turn}V${top}`
}

export interface ChainStage {
  name: Phase
  blurb: string
  touched: number
}

export function ChainMap(props: {
  stages: ChainStage[]
  open: string | null
  // Which returns are carrying signal, so the map can show a running loop
  // rather than only the two that exist in principle.
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
}) {
  const step = W / props.stages.length
  const boxW = step - GAP
  const centers = props.stages.map((_, i) => step * (i + 0.5))
  const top = MID_Y - BOX_H / 2
  const feedbackAt = props.stages.findIndex(s => s.name === 'Feedback')
  const last = props.stages.length - 1
  // Box to box down the row, plus the lead in off the left edge and the lead
  // out off the right — so the chain reads as something fed and something
  // delivered, rather than as five stages that begin and end nowhere.
  const wires = [
    { key: 'in', x0: 0, x1: centers[0] - boxW / 2 },
    ...centers.slice(0, -1).map((c, i) => ({
      key: props.stages[i].name,
      x0: c + boxW / 2,
      x1: centers[i + 1] - boxW / 2,
    })),
    { key: 'out', x0: centers[last] + boxW / 2, x1: W },
  ]
  // A return only reads as a return if it comes back from somewhere downstream.
  const returns = RETURNS.flatMap(r => {
    const at = props.stages.findIndex(s => s.name === r.from)
    return feedbackAt >= 0 && at > feedbackAt
      ? [{ ...r, from: centers[at], to: centers[feedbackAt] + r.dx }]
      : []
  })

  return (
    <svg
      className={styles.map}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="signal chain"
    >
      {wires.map(({ key, x0, x1 }) => (
        <line
          key={key}
          className={styles.mapWire}
          x1={x0}
          y1={MID_Y}
          x2={x1}
          y2={MID_Y}
        />
      ))}
      {returns.map(r => (
        <g
          key={r.loop}
          className={cx(
            styles.mapReturn,
            r.optical && styles.mapReturnOptical,
            props.live[r.loop] && styles.mapReturnLive,
          )}
        >
          <title>
            {props.live[r.loop] ? `${r.label} — running` : r.label}
          </title>
          <path
            className={styles.mapWire}
            d={returnPath(r.from, r.to, top, r.y, r.turn)}
          />
          <path
            className={styles.mapArrow}
            d={`M${r.to - HEAD} ${top - HEAD * 1.5}L${r.to} ${top}L${r.to + HEAD} ${top - HEAD * 1.5}Z`}
          />
        </g>
      ))}
      {props.stages.map((stage, i) => (
        <g
          key={stage.name}
          className={cx(
            styles.mapNode,
            stage.touched > 0 && styles.mapNodeTouched,
            props.open === stage.name && styles.mapNodeOn,
          )}
          role="button"
          tabIndex={0}
          aria-label={`${stage.name} — ${stage.blurb}`}
          onClick={() => props.onOpen(stage.name)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              props.onOpen(stage.name)
            }
          }}
        >
          <title>{`${stage.name} — ${stage.blurb}${stage.touched > 0 ? ` (${stage.touched} off stock)` : ''}`}</title>
          <rect
            className={styles.mapBox}
            x={centers[i] - boxW / 2}
            y={top}
            width={boxW}
            height={BOX_H}
            rx="2"
          />
          <text
            className={styles.mapLabel}
            x={centers[i]}
            y={MID_Y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {stage.name}
          </text>
        </g>
      ))}
    </svg>
  )
}
