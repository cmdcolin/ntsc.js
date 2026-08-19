import {
  BOX_H,
  BRANCH_Y,
  branchArrow,
  branchPath,
  chainLayout,
  FREE_Y,
  freeRow,
  H,
  HEAD,
  MID_Y,
  returnPath,
  W,
} from './chainLayout'
import styles from './ChainMap.module.css'
import { cx } from './cx'
import { MapBox, MapRun } from './MapBox'

import type { WiredBranch } from './chainLayout'
import type { LoopPlace, LoopsLive } from './controls'

// The chain in miniature at the head of the sidebar: a box per stage, wired
// left to right in the order the picture travels, with the three feedback
// returns looping back over the top and the two branches — input B and the
// sound — joining from below, each at the stage it actually feeds. Clicking a
// box opens that stage's controls, so this is the sidebar's navigation rather
// than an illustration of it — and it has to look like navigation, which is why
// a box is a filled chip on the wire rather than another hairline rectangle in
// the same colour as the wire (see ChainMap.module.css).
//
// A return is navigation of the same kind, and it is the *only* way into one of
// the three loops: none of them is a stage of the trunk, so none of them has a
// box. A run carries its name, wears the same three states a box does, and
// opens its own stage — where a single FEEDBACK box used to open all five of
// three machines' groups at once, and the loop you could see running was not
// the loop a click reached.
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
  // What the count counts, where "controls off stock" is the wrong noun for it —
  // see MapBox.touchedSay. Only the modulation bay sets it.
  touchedSay?: string
  // Nothing patched into this stage, which leaves its *controls* with nothing to
  // act on: drawn dashed, and it wears no amber however far off stock those
  // controls sit. True of a branch with no input picked, and of Mix, whose every
  // control needs a second signal to have an effect.
  off?: boolean
  // What to say instead of the blurb while it is off.
  offHint?: string
  // A live filter did not reach this stage. Drawn faint and pressing it does
  // nothing — it is on the map as context, so the chain still reads as a chain
  // while a query narrows what is listed under it. Different from `off`, which
  // is about the rig: an inert stage has nothing patched into it whatever is in
  // the search box, and a dimmed one is a statement about the search box alone.
  dim?: boolean
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

// A stage that hangs under the trunk, plus where its wire goes — the fields the
// layout needs and a trunk stage has no use for. `WiredBranch` and not the wider
// `BranchSpec`: a box with nothing wired to it is not on this drawing at all
// (see FreeBox), so the map cannot be handed one.
export type ChainBranchStage = ChainStage & WiredBranch

// A stage that hangs *over* the trunk, on its own return. Where it leaves and
// re-enters is not the caller's to say — that is the pass graph's, and it is
// written down once in chainLayout's RETURNS — so all this adds is which of the
// three runs is this stage's.
interface ChainLoopStage extends ChainStage {
  loop: LoopPlace
}

export function ChainMap(props: {
  stages: ChainStage[]
  // The branches, drawn under the trunk. Drawn whether or not anything is
  // patched into each — with `off` set a branch is the one thing on screen
  // saying that input exists at all. A live filter can leave one with nothing
  // to show, and it drops out.
  branches: ChainBranchStage[]
  // The boxes nothing is wired to, on their own row under the branches. They
  // are stages of the panel rather than of the chain — the modulation bay and
  // the deck — so they take the same box, the same states and the same press as
  // everything else here, and say what they are by the row being empty of wires
  // rather than by being drawn in some other register.
  free: ChainStage[]
  // The loops, drawn over the trunk. Each is a stage in its own right and the
  // run is its only door, so a loop the filter has left nothing to show simply
  // is not in here and its run is not drawn.
  loops: ChainLoopStage[]
  open: string | null
  // Whether clicking the box that is already open folds its stage away. True on
  // the spine, where the map is the fold; false on the bench, where every stage
  // is mounted and a click only marks one. The map has to know because it is
  // the one place that can say so *before* the click — a box that opens a stage
  // does not otherwise announce that pressing it again closes one, and the ×
  // on the open stage's heading only answers that question once you are in.
  folds: boolean
  // Which returns are carrying signal, so the map can show a running loop
  // rather than only the three that exist in principle. The same shape the full
  // diagram takes, which is what stops the two drawings disagreeing about which
  // of three machines is on.
  live: LoopsLive
  // Opens a stage by name — a box or a run, because both are stages now.
  onOpen: (name: string) => void
}) {
  // Nothing to draw without a trunk: every wire, every branch and every return
  // is placed off a trunk box, so a filter that leaves only a loop or a branch
  // standing leaves this an empty 304×98 hole. The stages themselves still
  // list — SignalPath draws them under a header with no map, which is why this
  // is a hole here rather than a bail-out there.
  if (props.stages.length === 0) return null
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
          // The lead-out stops short of the edge to leave room for its head.
          x2={key === 'out' ? x1 - HEAD : x1}
          y1={MID_Y}
          y2={MID_Y}
        />
      ))}
      {/* Where the picture leaves. Every other wire on this drawing carries a
          head that says which way it goes — both branches, all three returns —
          and the trunk, whose direction is the whole premise, was relying on
          left-to-right being read as a convention. The full card has always
          drawn this one (SignalPathDialog); the miniature now agrees. */}
      <path
        className={styles.mapArrow}
        d={`M${W - HEAD} ${MID_Y - HEAD}L${W} ${MID_Y}L${W - HEAD} ${MID_Y + HEAD}Z`}
      />
      {returns.map(r => {
        const node = props.loops.find(l => l.loop === r.loop)
        // A filter can leave a loop with nothing to show. Its run goes with it:
        // the run is the stage's only door, so drawing one onto nothing would be
        // the map's version of a heading over a blank.
        if (node === undefined) return null
        const d = returnPath(r.from, r.to, top, r.y, r.turn)
        const open = props.open === node.name
        const live = props.live[r.loop]
        const dim = node.dim === true
        // The same three things a box says, on a wire that has no fill to say
        // them with: idle, carrying an edit, open. `live` is the fourth and the
        // one only a loop has — its mix is off zero, so this machine is actually
        // running — and it outranks the amber, because "is it on" is the
        // question you ask of a loop and "have I touched it" is not.
        // A dimmed run outranks all four: while a query is live, "the search did
        // not reach this" is the only thing this run is on the drawing to say.
        const state = dim
          ? styles.mapReturnDim
          : open
            ? styles.mapReturnOn
            : live
              ? styles.mapReturnLive
              : node.touched > 0
                ? styles.mapReturnTouched
                : undefined
        return (
          /* A run is a button, and for a loop it is the whole of the door: none
             of the three has a box on the trunk, because none of them is a stage
             the picture passes through. What being that button *is* — the role,
             the tab stop, Enter and Space, the sentence it announces — lives in
             MapRun, with the box's copy of the same rule and for the same
             reason: the card draws these three runs too. */
          <MapRun
            key={r.loop}
            name={node.name}
            blurb={node.blurb}
            live={live}
            touched={node.touched}
            opens={!dim}
            pressHint={
              dim
                ? ''
                : !props.folds
                  ? ' — click for its controls'
                  : open
                    ? ' — click to close'
                    : ' — click to open'
            }
            className={cx(
              styles.mapReturn,
              // Not a button while it is dim, so it takes neither the pointer
              // nor the hover that would promise one.
              !dim && styles.mapLoopBtn,
              r.optical && styles.mapReturnOptical,
              state,
            )}
            expanded={props.folds && !dim ? open : undefined}
            onOpen={() => props.onOpen(node.name)}
          >
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
          </MapRun>
        )
      })}
      {branches.map((branch, i) => (
        /* Each branch arrives on a lead of its own, then runs up to the stage it
           is wired to. The wire takes the node's colour, so a patched-in branch
           lights its whole run rather than just the box on it. The arrowhead is
           the only thing that differs between an input and the view, and it is
           the whole statement: one is fed into the chain, the other out of it.

           Every box on this row has all of that, because every box in this
           drawing is wired to something now — the ones that are not are chips
           under it (SignalPath). */
        <g
          key={branch.name}
          className={cx(
            props.branches[i].off === true && styles.mapBranchOff,
            props.branches[i].dim === true && styles.mapBranchDim,
          )}
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
            y={branch.y}
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
      {freeRow(props.free.map(f => f.name)).map((box, i) => (
        /* Dotted, which is the card's mark for the same box and a different
           statement from the dashed one an inert branch wears: dashed is a box
           drawn absent, dotted is a box nothing arrives at — and this one is as
           pressable as any on the trunk. */
        <g key={box.name} className={styles.mapFree}>
          <Node
            stage={props.free[i]}
            x={box.x}
            y={FREE_Y}
            boxW={box.w}
            open={props.open === props.free[i].name}
            folds={props.folds}
            onOpen={props.onOpen}
          />
        </g>
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
  const off = stage.off === true
  const dim = stage.dim === true
  // Only where a click can close a stage is this box a disclosure — see `folds`.
  const fold = props.folds && stage.opens
  return (
    <MapBox
      name={stage.name}
      blurb={stage.blurb}
      offHint={stage.offHint ?? stage.blurb}
      off={off}
      opens={stage.opens}
      touched={stage.touched}
      touchedSay={stage.touchedSay}
      // The miniature's own addition to the hover text, and the only part of it
      // the card has no equivalent for: whether pressing again folds the stage
      // back up.
      foldHint={
        fold
          ? props.open
            ? ' — click to close'
            : ' — click to open'
          : undefined
      }
      className={cx(
        // Dim replaces the idle rule rather than layering over it: it is not a
        // shade of the three states below, it is the box saying the query went
        // somewhere else.
        dim ? styles.mapNodeDim : styles.mapNode,
        !dim && off && styles.mapNodeOff,
        !dim && !off && stage.touched > 0 && styles.mapNodeTouched,
        !dim && props.open && styles.mapNodeOn,
      )}
      expanded={fold ? props.open : undefined}
      onOpen={() => props.onOpen(stage.name)}
    >
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
    </MapBox>
  )
}
