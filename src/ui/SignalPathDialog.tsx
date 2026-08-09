import { atRest } from '../controls'
import {
  CAMERA_LOOP_GROUP,
  FEED_A_GROUP,
  FEED_B_GROUP,
  FEEDBACK_STAGE,
  MIX_STAGE,
  MIXER_LOOP_GROUP,
  OFF_HINT,
  PHASES,
  PICKER_STAGES,
  SOUND_BLURB,
  SOUND_STAGE,
  SOURCE_B_BLURB,
  SOURCE_B_STAGE,
  stageGroups,
  TAPE_LOOP_GROUP,
  VIEW_BLURB,
  VIEW_STAGE,
} from './controls'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { MapBox } from './MapBox'
import styles from './SignalPathDialog.module.css'
import ui from './ui.module.css'

import type { Controls } from '../controls'
import type { LoopsLive } from './controls'

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
// The trunk sits low enough for three loop runs to stack above it at the 22
// units apart their labels need. That band is the only thing that grew: a third
// *column* would have been the obvious way to give the loops their own targets
// and it costs every box 12% of its width — at 7 columns 'Receiver' already
// fills its box at 11px type, so the loops earn their room vertically, where
// there was nothing but wire, rather than horizontally, where there is none.
const H = 148
const GUTTER = 14
const GAP = 14
const MID_Y = 92
const BRANCH_Y = 128
const BOX_H = 22
const HEAD = 3
const TURN = 5

// Seven columns: A's two boxes, then the trunk's five. B's two sit under the
// first two, which is where a source and its feed belong on either row; the
// sound sits under the receiver, the one stage it is patched into; and the view
// sits under the screen, which is what feeds it. The lower row is therefore not
// "input B's row" but everything wired to one stage rather than passing along
// the trunk — and the arrowheads say which way each of them goes.
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
    label: 'Source A',
    stage: 'Source A',
    col: 0,
    row: 'a',
    what: phaseBlurb('Source A'),
  },
  {
    label: 'Feed A',
    stage: 'Source A',
    group: FEED_A_GROUP,
    col: 1,
    row: 'a',
    what: 'input A’s own deck, cable and head-end, ahead of the mixer — damage here lands on this signal alone. Two groups: what the deck did to the tape, and what the wire out of it did after',
  },
  {
    label: 'Source B',
    stage: SOURCE_B_STAGE,
    col: 0,
    row: 'b',
    what: SOURCE_B_BLURB,
  },
  {
    label: 'Feed B',
    stage: SOURCE_B_STAGE,
    group: FEED_B_GROUP,
    col: 1,
    row: 'b',
    what: 'the same deck and cable faults again on input B’s own feed, in the same order — so the two signals arrive at the mixer damaged differently and the difference is what the rig reacts to',
  },
  {
    label: 'Mix',
    stage: MIX_STAGE,
    col: 2,
    row: 'trunk',
    what: phaseBlurb(MIX_STAGE),
  },
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
  // The one box that is not a signal on its way to the glass: sound, patched
  // into the set. It sits under the receiver rather than at the head of a row
  // because that is where every one of its routings lands, and the diagram is
  // the place with room to say so.
  {
    label: 'Sound',
    stage: SOUND_STAGE,
    col: 5,
    row: 'b',
    what: SOUND_BLURB,
  },
  // The end of it, and the only box that is not the rig: where the picture is
  // watched from. Under Screen, because that is what feeds it.
  {
    label: 'View',
    stage: VIEW_STAGE,
    col: 6,
    row: 'b',
    what: VIEW_BLURB,
  },
]

// The Feedback column, which every run leaves from or returns to.
const FB_COL = 3

// The three loops, each one its own button. They were one box before, and the
// box is still there — but "Feedback" is the *node* the returns land on, and
// what a first visit wants to press is the loop it can see running. The wires
// were already the only thing telling the three apart (dashed for light, solid
// for a wire, and each with its own name on it), so the wires are what became
// pressable rather than a row of new boxes; that also costs the drawing no
// width, which a fourth trunk column would have.
//
// Each label sits in the band above its own run, so the runs are what separate
// them — 22 units apart, because at the 18 they started on, two sentences read
// as one paragraph with a wire through it.
//
// `from` and `to` are absolute, not column indices, because the loop bin is not
// a run around the chain at all: `tapePlay` returns onto the bus and `tapeRec`
// lays the sum back down at that same point, both ahead of the deck's own
// playback block. So it is drawn as a tight loop leaving and re-entering the
// Feedback box's own top edge — a second machine patched across one node —
// while the other two reach back from the stage they actually tap.
const RETURNS = [
  {
    loop: 'camera' as const,
    group: CAMERA_LOOP_GROUP,
    from: colX(6),
    // The top run's name sits 5 above it and rises 7 more; below 16 the
    // ascenders are cut off by the top of the viewBox.
    to: colX(FB_COL) - 9,
    y: 16,
    turn: 6,
    lx: 20,
    optical: true,
    label: 'camera loop — optical, a camera on the tube',
  },
  {
    loop: 'mixer' as const,
    group: MIXER_LOOP_GROUP,
    from: colX(5),
    to: colX(FB_COL) + 9,
    y: 38,
    turn: 5,
    lx: 20,
    optical: false,
    label: 'mixer loop — the composite, patched back in',
  },
  {
    loop: 'tape' as const,
    group: TAPE_LOOP_GROUP,
    // Wide enough to clear the other two arrowheads at ±9, so four verticals
    // landing on one box top still read as two pairs.
    from: colX(FB_COL) + 26,
    to: colX(FB_COL) - 26,
    y: 60,
    turn: 5,
    // Clear of its own run, which is the only one that does not reach past the
    // Feedback column — and no further, because this is the label that starts
    // furthest right and so the one that decides whether any of them can run
    // off the drawing.
    lx: 30,
    optical: false,
    // Kept short for the same reason. With ' — running • 1' on the end at
    // 10.5px this reached 652 of 660 units, which is not margin, it is luck
    // holding on a font metric.
    label: 'tape loop — a loop bin across the bus',
  },
]

// A loop's sentence for the legend, where there is room for one. The three are
// named for the physics that closes them, because that is the only thing that
// tells them apart once more than one is running.
const LOOP_WHAT: Record<(typeof RETURNS)[number]['loop'], string> = {
  camera:
    'light rather than wire — a camera on the tube’s face, its picture mixed back into the input ahead of the encoder. It carries an image that has already been decoded and lit, so it can only do what a lens can: zoom, shift, defocus, cut a black level. Past unity gain it breeds structure on its own',
  mixer:
    'the composite itself, patched off the bus into an input and crossfaded against the live signal. The subcarrier rides round with it, so each sample of cable delay spins fed-back hue 90° a generation and colour does things optics cannot',
  tape: 'a second machine threaded with a loop of tape, patched across the bus rather than round the chain: a play head returns what was laid down a lap ago, a record head lays the sum back down, and whatever keeps circulating ages a generation every time round',
}

// What an inert box says instead of its blurb, off the one table both drawings
// read (controls.ts). It used to be written out here as well, and the two copies
// had already drifted — this one still sent you to an `Input` section that no
// longer exists. A feed box carries its own source's stage, so Feed B answers
// with B's hint without a case of its own.
const deadHint = (box: Box) => OFF_HINT[box.stage] ?? ''

function returnPath(from: number, to: number, y: number, turn: number) {
  return `M${from} ${TOP}V${y + turn}Q${from} ${y} ${from - turn} ${y}H${to + turn}Q${to} ${y} ${to} ${y + turn}V${TOP}`
}

export function SignalPathDialog(props: {
  controls: Controls
  live: LoopsLive
  // Nothing patched into input B: its feed and the mixer are drawn and inert,
  // the same answer the miniature gives.
  bOn: boolean
  // The same question for the other branch: no audio input picked, so the box
  // is drawn and inert rather than absent.
  soundOn: boolean
  onOpen: (stage: string, group: string) => void
  onClose: () => void
}) {
  const { controls, onOpen, onClose } = props
  // How much of each box is off stock. A box that narrows to one group counts
  // that group; a stage counts all of its own.
  const touchedIn = (box: Box) => {
    const groups = stageGroups(box.stage).filter(
      g => box.group === undefined || g.name === box.group,
    )
    return groups
      .flatMap(g => g.sliders)
      .filter(s => !atRest(controls[s.key], s.key)).length
  }
  // The same count for a loop, which is a group of the Feedback stage without
  // being a box of its own.
  const touchedInGroup = (group: string) =>
    (
      stageGroups(FEEDBACK_STAGE).find(g => g.name === group)?.sliders ?? []
    ).filter(s => !atRest(controls[s.key], s.key)).length
  const open = (box: Box) => {
    onOpen(box.stage, box.group ?? stageGroups(box.stage)[0]?.name ?? '')
    onClose()
  }
  const openLoop = (group: string) => {
    onOpen(FEEDBACK_STAGE, group)
    onClose()
  }
  const rowY = (row: Box['row']) => (row === 'b' ? BRANCH_Y : MID_Y)
  // B's feed joins the run between Feed A and the mixer, which is where mixB
  // sits in the pass order.
  const join = (colX(1) + colX(2)) / 2
  // A branch with no input patched into it, and — for B — the mixer it arrives
  // at, have nothing to act on. The rest of the chain is carrying A regardless.
  const dead = (box: Box) =>
    (!props.bOn && (box.stage === MIX_STAGE || box.stage === SOURCE_B_STAGE)) ||
    (!props.soundOn && box.stage === SOUND_STAGE)
  // Drawn inert and opens onto something are two questions, and on the branches
  // they part company: a source branch with nothing patched in still opens,
  // because the picker that ends that state heads its stage in the panel and is
  // the whole reason to press it. Off `PICKER_STAGES`, which is the same list
  // app.tsx keys its pickers by — a box that opened here and not on the
  // miniature was the same drawing answering twice, which is what it did until
  // this stopped being written out per drawing.
  const opens = (box: Box) => !dead(box) || PICKER_STAGES.has(box.stage)

  return (
    <Dialog title="the signal path" size="diagram" onClose={onClose}>
      <p className={ui.helpText}>
        Two inputs, each with a feed of its own, meeting at the mixer — then one
        chain to the glass, with the sound patched into the receiver along the
        way and your own view at the end of it. Nothing here is a filter: every
        box is a piece of hardware misbehaving, and the artifacts come out of
        how they interfere. Click one to open its controls — and the three loops
        over the top are pressable too, each one its own way back into the
        chain.
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
        {/* B's run: in, through its own two boxes, and up into the trunk — the
            same two columns A gets on the row above, because it is the same
            rig. */}
        <g className={cx(!props.bOn && styles.dim)}>
          <path
            className={styles.wire}
            d={`M10 ${BRANCH_Y}H${colX(0) - BOX_W / 2}`}
          />
          <path
            className={styles.wire}
            d={`M${colX(0) + BOX_W / 2} ${BRANCH_Y}H${colX(1) - BOX_W / 2}`}
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
        {/* The sound's run: a lead of its own and a short riser into the
            receiver. Deliberately not fed from the left edge like the two
            signals are — it is patched into one stage, not sent down the
            chain, and a wire the length of the row would say the opposite. */}
        <g className={cx(!props.soundOn && styles.dim)}>
          <path
            className={styles.wire}
            d={`M${colX(5) - BOX_W / 2 - 12} ${BRANCH_Y}H${colX(5) - BOX_W / 2}`}
          />
          <path
            className={styles.wire}
            d={`M${colX(5)} ${BRANCH_Y - BOX_H / 2}V${TOP + BOX_H}`}
          />
          <path
            className={styles.arrow}
            d={`M${colX(5) - HEAD} ${TOP + BOX_H + HEAD * 1.6}L${colX(5)} ${TOP + BOX_H}L${colX(5) + HEAD} ${TOP + BOX_H + HEAD * 1.6}Z`}
          />
        </g>
        {/* The view's run: the same riser under Screen, with the arrowhead at
            the other end. That one difference is the statement — everything
            else on this row is patched into the chain, and this is the only
            thing the chain is delivered to. */}
        <path
          className={styles.wire}
          d={`M${colX(6)} ${TOP + BOX_H}V${BRANCH_Y - BOX_H / 2}`}
        />
        <path
          className={styles.arrow}
          d={`M${colX(6) - HEAD} ${BRANCH_Y - BOX_H / 2 - HEAD * 1.6}L${colX(6)} ${BRANCH_Y - BOX_H / 2}L${colX(6) + HEAD} ${BRANCH_Y - BOX_H / 2 - HEAD * 1.6}Z`}
        />
        {RETURNS.map(r => {
          const d = returnPath(r.from, r.to, r.y, r.turn)
          const n = touchedInGroup(r.group)
          return (
            <g
              key={r.loop}
              className={cx(
                styles.return,
                styles.loopBtn,
                r.optical && styles.optical,
                props.live[r.loop] && styles.live,
                n > 0 && styles.loopTouched,
              )}
              role="button"
              tabIndex={0}
              aria-label={`${r.label} — open its controls`}
              onClick={() => openLoop(r.group)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openLoop(r.group)
                }
              }}
            >
              <title>
                {`${r.label}${props.live[r.loop] ? ' — running' : ''}${n > 0 ? ` (${n} off stock)` : ''} — click for its controls`}
              </title>
              {/* The wire is 1.25 units of stroke and the thing you are meant to
                  press, so it carries a transparent one wide enough to hit. At
                  14 it stays inside the 22 units between one run and the next,
                  so a click can never land on the wrong loop. */}
              <path className={styles.loopHit} d={d} />
              <path className={styles.wire} d={d} />
              <path
                className={styles.arrow}
                d={`M${r.to - HEAD} ${TOP - HEAD * 1.6}L${r.to} ${TOP}L${r.to + HEAD} ${TOP - HEAD * 1.6}Z`}
              />
              <text
                className={styles.loopLabel}
                x={colX(FB_COL) + r.lx}
                y={r.y - 5}
              >
                {r.label}
                {props.live[r.loop] ? ' — running' : ''}
                {n > 0 ? ` • ${n}` : ''}
              </text>
            </g>
          )
        })}
        {/* The two inputs used to be named by an 'A' and a 'B' parked on the
            wires here, because the first box on each row was named after
            something else. Each row now opens with the input's own box, so the
            tags were the label repeated smaller. */}
        {BOXES.map(box => {
          const y = rowY(box.row)
          const n = touchedIn(box)
          const off = dead(box)
          return (
            <MapBox
              key={box.label}
              name={box.label}
              blurb={box.what}
              offHint={deadHint(box)}
              off={off}
              opens={opens(box)}
              // No fold to describe here — this card marks and opens, it never
              // closes a stage — so the hover text stops at the off-stock count.
              title={`${box.label} — ${box.what}${n > 0 ? ` (${n} off stock)` : ''}`}
              className={cx(
                styles.node,
                off && styles.nodeOff,
                !off && n > 0 && styles.nodeTouched,
              )}
              onOpen={() => open(box)}
            >
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
            </MapBox>
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
                disabled={!opens(box)}
                onClick={() => open(box)}
              >
                <span className={styles.legendName}>{box.label}</span>
                <span className={styles.legendWhat}>
                  {off ? deadHint(box) : box.what}
                </span>
                {n > 0 && !off ? (
                  <span className={styles.legendCount}>• {n}</span>
                ) : null}
              </button>
            </li>
          )
        })}
        {/* The three loops on the same list as the boxes, because they are the
            same kind of thing to press and the svg gives them no rows to read.
            It is also the only way to reach one from the keyboard in reading
            order: a run is a path, and a path with role=button is a tab stop on
            a picture rather than a line you can find. */}
        {RETURNS.map(r => {
          const n = touchedInGroup(r.group)
          return (
            <li key={r.loop}>
              <button
                className={styles.legendBtn}
                onClick={() => openLoop(r.group)}
              >
                <span className={styles.legendName}>{r.loop} loop</span>
                <span className={styles.legendWhat}>
                  {LOOP_WHAT[r.loop]}
                  {props.live[r.loop] ? ' — running now' : ''}
                </span>
                {n > 0 ? (
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
