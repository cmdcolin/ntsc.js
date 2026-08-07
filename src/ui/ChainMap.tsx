import {
  BOX_H,
  BRANCH_Y,
  branchPath,
  chainLayout,
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
// looping back over the top and input B joining from below. Clicking a box
// opens that stage's controls, so this is the sidebar's navigation rather than
// an illustration of it — and it has to look like navigation, which is why a
// box is a filled chip on the wire rather than another hairline rectangle in
// the same colour as the wire (see ChainMap.module.css).
//
// State reads as colour on one element: idle until you point at it, amber for a
// stage carrying an edit, accent for the stage that is open.
//
// Every coordinate comes from chainLayout.ts — the sizes and the arithmetic are
// there, and this file is the drawing.
export interface ChainStage {
  // A Phase for a trunk stage, and 'Source B' for the branch. Not typed as
  // Phase: the branch is a second signal joining the trunk rather than a
  // seventh division of it, and the map addresses both the same way.
  name: string
  blurb: string
  touched: number
  // Nothing patched into source B, which leaves this stage with nothing to act
  // on: drawn dashed and inert, and it opens nothing. True of the branch itself
  // and of Mix, whose every control needs a second signal to have an effect.
  off?: boolean
  // What to say instead of the blurb while it is off.
  offHint?: string
}

export function ChainMap(props: {
  stages: ChainStage[]
  // Input B, drawn under the head of the trunk. Drawn whether or not B is
  // patched in — with `off` set it is the one thing on screen saying a second
  // input exists at all. null when a live filter has left it nothing to show.
  branch: ChainStage | null
  open: string | null
  // Which returns are carrying signal, so the map can show a running loop
  // rather than only the two that exist in principle.
  live: { camera: boolean; mixer: boolean }
  onOpen: (name: string) => void
}) {
  const { boxes, wires, returns, branch } = chainLayout(
    props.stages.map(s => s.name),
    props.branch?.name ?? null,
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
      {props.branch === null || branch === null ? null : (
        <g className={cx(props.branch.off === true && styles.mapBranchOff)}>
          {/* B arrives on a stub of its own, then runs up into the mixer. The
              wire takes the node's colour, so a patched-in B lights its whole
              run rather than just the box on it. */}
          <line
            className={styles.mapWire}
            x1={0}
            y1={BRANCH_Y}
            x2={branch.x - branch.w / 2}
            y2={BRANCH_Y}
          />
          <path className={styles.mapWire} d={branchPath(branch)} />
          <path
            className={styles.mapArrow}
            d={`M${branch.join - HEAD} ${MID_Y + BOX_H / 2 + HEAD * 1.5}L${branch.join} ${MID_Y + BOX_H / 2}L${branch.join + HEAD} ${MID_Y + BOX_H / 2 + HEAD * 1.5}Z`}
          />
          <Node
            stage={props.branch}
            x={branch.x}
            y={BRANCH_Y}
            boxW={branch.w}
            open={props.open === props.branch.name}
            onOpen={props.onOpen}
          />
        </g>
      )}
      {props.stages.map((stage, i) => (
        <Node
          key={stage.name}
          stage={stage}
          x={boxes[i].x}
          y={MID_Y}
          boxW={boxes[i].w}
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
  onOpen: (name: string) => void
}) {
  const { stage } = props
  const off = stage.off === true
  const title = off
    ? (stage.offHint ?? stage.blurb)
    : `${stage.name} — ${stage.blurb}${stage.touched > 0 ? ` (${stage.touched} off stock)` : ''}`
  return (
    <g
      className={cx(
        styles.mapNode,
        off && styles.mapNodeOff,
        !off && stage.touched > 0 && styles.mapNodeTouched,
        props.open && styles.mapNodeOn,
      )}
      role={off ? undefined : 'button'}
      tabIndex={off ? undefined : 0}
      aria-label={off ? undefined : `${stage.name} — ${stage.blurb}`}
      onClick={off ? undefined : () => props.onOpen(stage.name)}
      onKeyDown={e => {
        if (!off && (e.key === 'Enter' || e.key === ' ')) {
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
        rx="3"
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
