import {
  BOX_H,
  BRANCH_Y,
  branchArrow,
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

import type { BranchSpec } from './chainLayout'
import type { LoopsLive } from './controls'

// The chain in miniature at the head of the sidebar: a box per stage, wired
// left to right in the order the picture travels, with the three feedback
// returns looping back over the top and the two branches — input B and the
// sound — joining from below, each at the stage it actually feeds. Clicking a
// box opens that stage's controls, so this is the sidebar's navigation rather
// than an illustration of it — and it has to look like navigation, which is why
// a box is a filled chip on the wire rather than another hairline rectangle in
// the same colour as the wire (see ChainMap.module.css).
//
// A return is navigation too, and its own kind of it: the box under the three
// of them opens the Feedback stage at whichever group comes first, so pressing
// the loop you can see running was never how you reached it. Each run carries
// its name and opens its own group.
//
// State reads as colour on one element: idle until you point at it, amber for a
// stage carrying an edit, accent for the stage that is open.
//
// Every coordinate comes from chainLayout.ts — the sizes and the arithmetic are
// there, and this file is the drawing.
export interface ChainStage {
  // A Phase for a trunk stage, and the branch's own name ('Source B', 'Sound')
  // for a branch. Not typed as Phase: a branch is something joining the trunk
  // rather than a further division of it, and the map addresses both the same
  // way.
  name: string
  blurb: string
  touched: number
  // Nothing patched into this stage, which leaves its *controls* with nothing to
  // act on: drawn dashed, and it wears no amber however far off stock those
  // controls sit. True of a branch with no input picked, and of Mix, whose every
  // control needs a second signal to have an effect.
  off?: boolean
  // What to say instead of the blurb while it is off.
  offHint?: string
  // Whether pressing the box opens the stage. Not the negation of `off`: a
  // source branch with nothing patched in is drawn inert and still opens,
  // because the picker that ends the off state is the first thing inside it —
  // it is the whole reason you would press SOURCE B. Mix is the one that is
  // both: there is no picker for "a second signal", only B's, so its box is a
  // statement about the chain rather than a door.
  //
  // Not a fact the panel hands over. SignalPath works it out from the same
  // record it renders the pickers out of, so a box that opens and a stage that
  // has something to show cannot come apart — see `opensOn` there.
  opens: boolean
}

// A stage that hangs under the trunk, plus where its wire goes — the two fields
// the layout needs and a trunk stage has no use for.
export interface ChainBranchStage extends ChainStage, BranchSpec {}

export function ChainMap(props: {
  stages: ChainStage[]
  // The branches, drawn under the trunk. Drawn whether or not anything is
  // patched into each — with `off` set a branch is the one thing on screen
  // saying that input exists at all. A live filter can leave one with nothing
  // to show, and it drops out.
  branches: ChainBranchStage[]
  open: string | null
  // Whether clicking the box that is already open folds its stage away. True on
  // the spine, where the map is the fold; false on the bench, where every stage
  // is mounted and a click only marks one. The map has to know because it is
  // the one place that can say so *before* the click — a box that opens a stage
  // does not otherwise announce that pressing it again closes one, and the ×
  // on the open stage's heading only answers that question once you are in.
  folds: boolean
  // Which returns are carrying signal, so the map can show a running loop
  // rather than only the two that exist in principle. Typed as all three even
  // though the miniature draws two: the shape is shared with the full diagram,
  // which has the room for the loop bin as well.
  live: LoopsLive
  onOpen: (name: string) => void
  // A run, as against the box under it: opens the Feedback stage at the one
  // group that loop's controls live in.
  onOpenLoop: (group: string) => void
}) {
  const { boxes, wires, returns, branches } = chainLayout(
    props.stages.map(s => s.name),
    props.branches,
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
      {returns.map(r => {
        const d = returnPath(r.from, r.to, top, r.y, r.turn)
        return (
          /* A run is a button of its own: the two loops are the one thing on
             this map that is visibly two things and used to open as one. The
             box below them still opens the stage; the run opens the loop. */
          <g
            key={r.loop}
            className={cx(
              styles.mapReturn,
              styles.mapLoopBtn,
              r.optical && styles.mapReturnOptical,
              props.live[r.loop] && styles.mapReturnLive,
            )}
            role="button"
            tabIndex={0}
            aria-label={`${r.label} — open its controls`}
            onClick={() => props.onOpenLoop(r.group)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onOpenLoop(r.group)
              }
            }}
          >
            <title>
              {`${props.live[r.loop] ? `${r.label} — running` : r.label} — click for its controls`}
            </title>
            {/* The run is a 1px hairline and the target. 8 units of transparent
                stroke is what makes it pressable without moving it, and it
                stays inside the 10 between one run and the next. */}
            <path className={styles.mapLoopHit} d={d} />
            <path className={styles.mapWire} d={d} />
            <path
              className={styles.mapArrow}
              d={`M${r.to - HEAD} ${top - HEAD * 1.5}L${r.to} ${top}L${r.to + HEAD} ${top - HEAD * 1.5}Z`}
            />
            {/* The run's own name, riding the wire rather than sitting above
                it — there is no above at this size. It is painted after the
                wire and carries a stroke of the panel behind it, so the run
                breaks around the word instead of running through it. */}
            <text
              className={styles.mapLoopLabel}
              x={r.nameAt.x}
              y={r.y}
              textAnchor={r.nameAt.anchor}
              dominantBaseline="central"
            >
              {r.name}
            </text>
          </g>
        )
      })}
      {branches.map((branch, i) => (
        /* Each branch arrives on a lead of its own, then runs up to the stage it
           is wired to. The wire takes the node's colour, so a patched-in branch
           lights its whole run rather than just the box on it. The arrowhead is
           the only thing that differs between an input and the view, and it is
           the whole statement: one is fed into the chain, the other out of it. */
        <g
          key={branch.name}
          className={cx(props.branches[i].off === true && styles.mapBranchOff)}
        >
          <line
            className={styles.mapWire}
            x1={branch.stub}
            y1={BRANCH_Y}
            x2={branch.x - branch.w / 2}
            y2={BRANCH_Y}
          />
          <path className={styles.mapWire} d={branchPath(branch)} />
          <Arrow at={branchArrow(branch)} />
          <Node
            stage={props.branches[i]}
            x={branch.x}
            y={BRANCH_Y}
            boxW={branch.w}
            open={props.open === branch.name}
            folds={props.folds}
            onOpen={props.onOpen}
          />
        </g>
      ))}
      {props.stages.map((stage, i) => (
        <Node
          key={stage.name}
          stage={stage}
          x={boxes[i].x}
          y={MID_Y}
          boxW={boxes[i].w}
          open={props.open === stage.name}
          folds={props.folds}
          onOpen={props.onOpen}
        />
      ))}
    </svg>
  )
}

// A branch's arrowhead, from the anchor and unit direction the layout worked
// out. Built off the direction rather than written out per case, so a wire that
// arrives sideways gets a head that points sideways without a fourth copy of
// this triangle.
function Arrow(props: {
  at: { x: number; y: number; dx: number; dy: number }
}) {
  const { x, y, dx, dy } = props.at
  // The two base corners sit HEAD*1.5 back along the wire and HEAD to either
  // side of it — the perpendicular being (-dy, dx).
  const bx = x - dx * HEAD * 1.5
  const by = y - dy * HEAD * 1.5
  return (
    <path
      className={styles.mapArrow}
      d={`M${bx - dy * HEAD} ${by + dx * HEAD}L${x} ${y}L${bx + dy * HEAD} ${by - dx * HEAD}Z`}
    />
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
  // See ChainMap's `folds`: only where a click can close a stage is this box a
  // disclosure, and only there does it have an expanded state to report or a
  // second thing to say in its tooltip.
  folds: boolean
  onOpen: (name: string) => void
}) {
  const { stage } = props
  // Drawn inert and opens onto something are two questions now, and a source
  // branch answers them differently — so every line below picks the one it is
  // actually about. `off` colours the box; `opens` decides whether it is a
  // button at all.
  const off = stage.off === true
  const opens = stage.opens
  const fold = props.folds && opens
  // An inert box that still opens has to say both things: what is missing, and
  // that this is where you fix it. The off hints are written to end in that
  // instruction, so there is nothing to append here.
  const title = off
    ? (stage.offHint ?? stage.blurb)
    : `${stage.name} — ${stage.blurb}${stage.touched > 0 ? ` (${stage.touched} off stock)` : ''}${fold ? (props.open ? ' — click to close' : ' — click to open') : ''}`
  return (
    <g
      className={cx(
        styles.mapNode,
        off && styles.mapNodeOff,
        !off && stage.touched > 0 && styles.mapNodeTouched,
        props.open && styles.mapNodeOn,
      )}
      role={opens ? 'button' : undefined}
      tabIndex={opens ? 0 : undefined}
      // A box that folds a stage is a disclosure and says so; on the bench it is
      // an index entry, which has no expanded state to claim.
      aria-expanded={fold ? props.open : undefined}
      // Named first either way — the name is what the box says on its face, and
      // a label that opened on the hint instead announced the Sound box as "no
      // sound reaching it". What follows it is the part that differs: an inert
      // box is announced by what it is *for*, which is picking the input it is
      // missing, rather than by the blurb of controls that cannot act yet.
      aria-label={
        opens
          ? `${stage.name} — ${off ? (stage.offHint ?? stage.blurb) : stage.blurb}`
          : undefined
      }
      onClick={opens ? () => props.onOpen(stage.name) : undefined}
      onKeyDown={e => {
        if (opens && (e.key === 'Enter' || e.key === ' ')) {
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
