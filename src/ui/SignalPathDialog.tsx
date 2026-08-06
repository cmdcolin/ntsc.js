import { DEFAULT_CONTROLS } from '../controls'
import {
  AB_GROUPS,
  FEED_A_GROUP,
  FEED_B_GROUP,
  MIX_BLURB,
  MIX_STAGE,
  PHASES,
  stageGroups,
} from './controls'
import { cx } from './cx'
import { Dialog } from './Dialog'
import styles from './SignalPathDialog.module.css'
import ui from './ui.module.css'

import type { Controls } from '../controls'

// The path drawn at a size that can carry it. The sidebar's miniature has room
// for the five trunk stages and B's branch and nothing else, so the two things
// it cannot say are exactly the two the second input made worth saying: that
// each source has a feed of its own before the mixer, and which loop is which.
//
// Left to right, like the miniature — same drawing, unfolded — so opening this
// teaches the map rather than replacing it. Every box opens the panel where its
// controls are, which is what keeps it a diagram of *this app* rather than an
// illustration of NTSC.
const W = 660
const H = 124
const GUTTER = 14
const GAP = 14
const MID_Y = 68
const BRANCH_Y = 104
const BOX_H = 22
const HEAD = 3
const TURN = 5

// Seven columns: A's two boxes, then the trunk's five. B's one box sits under
// the second column, which is where a feed belongs on either row.
const COLS = 7
const STEP = (W - GUTTER - 10) / COLS
const BOX_W = STEP - GAP
const colX = (i: number) => GUTTER + STEP * (i + 0.5)
const TOP = MID_Y - BOX_H / 2

// What each box is and what opening it should show. `stage` is the panel stage
// it belongs to; `group` narrows to one module inside it, which is how the two
// feeds get boxes of their own without being stages.
interface Box {
  label: string
  stage: string
  group?: string
  col: number
  row: 'a' | 'b' | 'trunk'
  what: string
}

const phaseBlurb = (name: string) =>
  PHASES.find(p => p.name === name)?.blurb ?? ''

const BOXES: Box[] = [
  {
    label: 'Source',
    stage: 'Source',
    col: 0,
    row: 'a',
    what: phaseBlurb('Source'),
  },
  {
    label: 'Feed A',
    stage: 'Source',
    group: FEED_A_GROUP,
    col: 1,
    row: 'a',
    what: 'input A’s own deck, cable and head-end, ahead of the mixer — damage here lands on this signal alone',
  },
  {
    label: 'Feed B',
    stage: MIX_STAGE,
    group: FEED_B_GROUP,
    col: 1,
    row: 'b',
    what: 'the same eight faults on input B’s own feed, so the two signals arrive at the mixer damaged differently',
  },
  { label: 'Mix', stage: MIX_STAGE, col: 2, row: 'trunk', what: MIX_BLURB },
  {
    label: 'Feedback',
    stage: 'Feedback',
    col: 3,
    row: 'trunk',
    what: phaseBlurb('Feedback'),
  },
  {
    label: 'Tape',
    stage: 'Tape',
    col: 4,
    row: 'trunk',
    what: phaseBlurb('Tape'),
  },
  {
    label: 'Receiver',
    stage: 'Receiver',
    col: 5,
    row: 'trunk',
    what: phaseBlurb('Receiver'),
  },
  {
    label: 'Screen',
    stage: 'Screen',
    col: 6,
    row: 'trunk',
    what: phaseBlurb('Screen'),
  },
]

// Same two loops the miniature draws, with the room to say which is which.
// Each label sits in the band above its own run, so the two runs are what
// separate them — 22 units apart, because at the 18 they started on the two
// sentences read as one paragraph with a wire through it.
const RETURNS = [
  {
    loop: 'camera' as const,
    from: 6,
    y: 12,
    turn: 6,
    dx: -9,
    optical: true,
    label: 'camera loop — optical, a camera on the tube',
  },
  {
    loop: 'mixer' as const,
    from: 5,
    y: 34,
    turn: 5,
    dx: 9,
    optical: false,
    label: 'mixer loop — the composite, patched back in',
  },
]

function returnPath(from: number, to: number, y: number, turn: number) {
  return `M${from} ${TOP}V${y + turn}Q${from} ${y} ${from - turn} ${y}H${to + turn}Q${to} ${y} ${to} ${y + turn}V${TOP}`
}

export function SignalPathDialog(props: {
  controls: Controls
  live: { camera: boolean; mixer: boolean }
  // Nothing patched into input B: its feed and the mixer are drawn and inert,
  // the same answer the miniature gives.
  bOn: boolean
  onOpen: (stage: string, group: string) => void
  onClose: () => void
}) {
  const { controls, onOpen, onClose } = props
  // How much of each box is off stock. A box that narrows to one group counts
  // that group; a stage counts all of its own.
  const touchedIn = (box: Box) => {
    const groups = (
      box.stage === MIX_STAGE ? AB_GROUPS : stageGroups(box.stage)
    ).filter(g => box.group === undefined || g.name === box.group)
    return groups
      .flatMap(g => g.sliders)
      .filter(s => controls[s.key] !== DEFAULT_CONTROLS[s.key]).length
  }
  const open = (box: Box) => {
    onOpen(box.stage, box.group ?? stageGroups(box.stage)[0]?.name ?? '')
    onClose()
  }
  const rowY = (row: Box['row']) => (row === 'b' ? BRANCH_Y : MID_Y)
  // B's feed joins the run between Feed A and the mixer, which is where mixB
  // sits in the pass order.
  const join = (colX(1) + colX(2)) / 2
  // With nothing patched into B, B's feed and the mixer are the two boxes that
  // have nothing to act on. The rest of the chain is carrying A regardless.
  const dead = (box: Box) => !props.bOn && box.stage === MIX_STAGE

  return (
    <Dialog title="the signal path" size="diagram" onClose={onClose}>
      <p className={ui.helpText}>
        Two inputs, each with a feed of its own, meeting at the mixer — then one
        chain to the glass. Nothing here is a filter: every box is a piece of
        hardware misbehaving, and the artifacts come out of how they interfere.
        Click one to open its controls.
      </p>
      <svg
        className={styles.diagram}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label="signal path"
      >
        {/* the runs, drawn before the boxes so a box sits on its wire */}
        <path
          className={styles.wire}
          d={`M10 ${MID_Y}H${colX(0) - BOX_W / 2}`}
        />
        {[0, 1, 2, 3, 4, 5].map(i => (
          <path
            key={i}
            className={styles.wire}
            d={`M${colX(i) + BOX_W / 2} ${MID_Y}H${colX(i + 1) - BOX_W / 2}`}
          />
        ))}
        <path
          className={styles.wire}
          d={`M${colX(6) + BOX_W / 2} ${MID_Y}H${W - 8}`}
        />
        <path
          className={styles.arrow}
          d={`M${W - 8} ${MID_Y - HEAD}L${W} ${MID_Y}L${W - 8} ${MID_Y + HEAD}Z`}
        />
        {/* B's run: in, through its feed, and up into the trunk */}
        <g className={cx(!props.bOn && styles.dim)}>
          <path
            className={styles.wire}
            d={`M10 ${BRANCH_Y}H${colX(1) - BOX_W / 2}`}
          />
          <path
            className={styles.wire}
            d={`M${colX(1) + BOX_W / 2} ${BRANCH_Y}H${join - TURN}Q${join} ${BRANCH_Y} ${join} ${BRANCH_Y - TURN}V${MID_Y + HEAD}`}
          />
          <path
            className={styles.arrow}
            d={`M${join - HEAD} ${MID_Y + HEAD * 1.6}L${join} ${MID_Y}L${join + HEAD} ${MID_Y + HEAD * 1.6}Z`}
          />
        </g>
        {RETURNS.map(r => (
          <g
            key={r.loop}
            className={cx(
              styles.return,
              r.optical && styles.optical,
              props.live[r.loop] && styles.live,
            )}
          >
            <path
              className={styles.wire}
              d={returnPath(colX(r.from), colX(3) + r.dx, r.y, r.turn)}
            />
            <path
              className={styles.arrow}
              d={`M${colX(3) + r.dx - HEAD} ${TOP - HEAD * 1.6}L${colX(3) + r.dx} ${TOP}L${colX(3) + r.dx + HEAD} ${TOP - HEAD * 1.6}Z`}
            />
            <text className={styles.loopLabel} x={colX(3) + 20} y={r.y - 5}>
              {r.label}
              {props.live[r.loop] ? ' — running' : ''}
            </text>
          </g>
        ))}
        {/* the two inputs, named on the wires they arrive on */}
        <text className={styles.tag} x="2" y={MID_Y} dominantBaseline="central">
          A
        </text>
        <text
          className={cx(styles.tag, !props.bOn && styles.dimTag)}
          x="2"
          y={BRANCH_Y}
          dominantBaseline="central"
        >
          B
        </text>
        {BOXES.map(box => {
          const y = rowY(box.row)
          const n = touchedIn(box)
          const off = dead(box)
          return (
            <g
              key={box.label}
              className={cx(
                styles.node,
                off && styles.nodeOff,
                !off && n > 0 && styles.nodeTouched,
              )}
              role={off ? undefined : 'button'}
              tabIndex={off ? undefined : 0}
              aria-label={off ? undefined : `${box.label} — ${box.what}`}
              onClick={off ? undefined : () => open(box)}
              onKeyDown={e => {
                if (!off && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  open(box)
                }
              }}
            >
              <title>
                {off
                  ? 'no source B — pick one in Input to mix a second signal in'
                  : `${box.label} — ${box.what}${n > 0 ? ` (${n} off stock)` : ''}`}
              </title>
              <rect
                className={styles.box}
                x={colX(box.col) - BOX_W / 2}
                y={y - BOX_H / 2}
                width={BOX_W}
                height={BOX_H}
                rx="3"
              />
              <text
                className={styles.label}
                x={colX(box.col)}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {box.label}
              </text>
            </g>
          )
        })}
      </svg>
      {/* The blurbs in full. The sidebar clamps a stage's line to one row —
          at 360px every one of them wraps to two — so this is the one place
          they are readable rather than hoverable. */}
      <ul className={styles.legend}>
        {BOXES.map(box => {
          const n = touchedIn(box)
          const off = dead(box)
          return (
            <li key={box.label}>
              <button
                className={styles.legendBtn}
                disabled={off}
                onClick={() => open(box)}
              >
                <span className={styles.legendName}>{box.label}</span>
                <span className={styles.legendWhat}>
                  {off ? 'no source B — pick one in Input' : box.what}
                </span>
                {n > 0 && !off ? (
                  <span className={styles.legendCount}>• {n}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
