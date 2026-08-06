import {
  BOX_H,
  BRANCH_Y,
  branchPath,
  chainLayout,
  GUTTER,
  H,
  HEAD,
  MID_Y,
  returnPath,
  W,
} from './chainLayout'
import styles from './ChainMap.module.css'
import { cx } from './cx'

// The chain in miniature at the head of the sidebar: a box per stage, wired
// left to right in the order the picture travels, with the two feedback returns
// looping back over the top and input B's branch joining from below. Clicking a
// box opens that stage's controls below, so this is the sidebar's navigation
// rather than an illustration of it.
//
// State reads as colour on one element: dim until you point at it, amber for a
// stage carrying an edit, accent for the stage that is open.
//
// Every coordinate comes from chainLayout.ts — the sizes and the arithmetic are
// there, and this file is the drawing.
export interface ChainStage {
  // A Phase for a trunk stage, and the branch's own name for the branch. Not
  // typed as Phase: the branch is a second signal joining the trunk rather than
  // a sixth division of it, and the map addresses both the same way.
  name: string
  blurb: string
  touched: number
}

// Input B's branch. Drawn whether or not B is patched in — with `on` false it
// is dim, dashed and inert, which is the one thing on screen saying a second
// input exists at all before you go looking for it in Input.
export interface ChainBranch extends ChainStage {
  on: boolean
}

export function ChainMap(props: {
  stages: ChainStage[]
  // null when a live filter has left the branch nothing to show.
  branch: ChainBranch | null
  open: string | null
  // Which returns are carrying signal, so the map can show a running loop
  // rather than only the two that exist in principle.
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
}) {
  const { boxW, centers, wires, returns, join } = chainLayout(
    props.stages.map(s => s.name),
  )
  const top = MID_Y - BOX_H / 2

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
          <title>{props.live[r.loop] ? `${r.label} — running` : r.label}</title>
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
      {/* The two inputs, named on the wires they come in on. A is the trunk's
          own lead-in, so it needs no branch; B is what the map used to be
          silent about. */}
      <text
        className={styles.mapTag}
        x="4"
        y={MID_Y}
        dominantBaseline="central"
      >
        A
      </text>
      {props.branch === null ? null : (
        <Branch
          branch={props.branch}
          x={centers[0]}
          boxW={boxW}
          join={join}
          open={props.open === props.branch.name}
          onOpen={props.onOpen}
        />
      )}
      {props.stages.map((stage, i) => (
        <Node
          key={stage.name}
          stage={stage}
          x={centers[i]}
          y={MID_Y}
          boxW={boxW}
          open={props.open === stage.name}
          onOpen={props.onOpen}
        />
      ))}
    </svg>
  )
}

// One box: its outline, its label, and the whole state of the stage as one
// colour. Shared by the trunk and the branch so the two can't drift apart in
// how they answer a hover, a keyboard focus or an edit.
function Node(props: {
  stage: ChainStage
  x: number
  y: number
  boxW: number
  open: boolean
  disabled?: boolean
  hint?: string
  onOpen: (name: string) => void
}) {
  const { stage, disabled = false } = props
  const title =
    props.hint ??
    `${stage.name} — ${stage.blurb}${stage.touched > 0 ? ` (${stage.touched} off stock)` : ''}`
  return (
    <g
      className={cx(
        styles.mapNode,
        disabled && styles.mapNodeOff,
        !disabled && stage.touched > 0 && styles.mapNodeTouched,
        props.open && styles.mapNodeOn,
      )}
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      aria-label={disabled ? undefined : `${stage.name} — ${stage.blurb}`}
      onClick={disabled ? undefined : () => props.onOpen(stage.name)}
      onKeyDown={e => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          props.onOpen(stage.name)
        }
      }}
    >
      <title>{title}</title>
      <rect
        className={styles.mapBox}
        x={props.x - props.boxW / 2}
        y={props.y - BOX_H / 2}
        width={props.boxW}
        height={BOX_H}
        rx="2"
      />
      <text
        className={styles.mapLabel}
        x={props.x}
        y={props.y}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {stage.name}
      </text>
    </g>
  )
}

// Input B, on its own row: its tag, its lead-in, the box, and the wire up into
// the trunk. The wire and tag take the node's colour, so a branch carrying an
// edit lights the whole run rather than just the box on it.
function Branch(props: {
  branch: ChainBranch
  x: number
  boxW: number
  join: number
  open: boolean
  onOpen: (name: string) => void
}) {
  const { branch } = props
  const off = !branch.on
  return (
    <g className={cx(off && styles.mapBranchOff)}>
      <line
        className={styles.mapWire}
        x1={GUTTER - 4}
        y1={BRANCH_Y}
        x2={props.x - props.boxW / 2}
        y2={BRANCH_Y}
      />
      <path
        className={styles.mapWire}
        d={branchPath(props.x + props.boxW / 2, props.join, BRANCH_Y)}
      />
      <path
        className={styles.mapArrow}
        d={`M${props.join - HEAD} ${MID_Y + HEAD * 1.5}L${props.join} ${MID_Y}L${props.join + HEAD} ${MID_Y + HEAD * 1.5}Z`}
      />
      <text
        className={styles.mapTag}
        x="4"
        y={BRANCH_Y}
        dominantBaseline="central"
      >
        B
      </text>
      <Node
        stage={branch}
        x={props.x}
        y={BRANCH_Y}
        boxW={props.boxW}
        open={props.open}
        disabled={off}
        hint={
          off ? 'no source B — pick one in Input to mix a second signal in' : ''
        }
        onOpen={props.onOpen}
      />
    </g>
  )
}
