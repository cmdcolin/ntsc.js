import { atRest } from '../core/controls'
import {
  DECK_BLURB,
  DECK_STAGE,
  FEED_A_GROUP,
  FEED_B_GROUP,
  LOOP_STAGES,
  MIX_STAGE,
  MOD_BLURB,
  MOD_STAGE,
  OFF_HINT,
  PHASES,
  PICKER_STAGES,
  SOUND_BLURB,
  SOUND_STAGE,
  SOURCE_A_STAGE,
  SOURCE_B_BLURB,
  SOURCE_B_STAGE,
  stageGroups,
  VIEW_BLURB,
  VIEW_STAGE,
} from './controls'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { MapBox, MapRun } from './MapBox'
import { fitCaption } from './patched'
import styles from './SignalPathDialog.module.css'
import ui from './ui.module.css'

import type { Controls } from '../core/controls'
import type { LoopsLive } from './controls'
import type { DeckLoad } from './deck'
import type { BayLoad } from './modSlots'

// The path drawn at a size that can carry it. The sidebar's miniature has room
// for the trunk, its branches and the three runs over the top, and nothing
// else, so what it cannot say is exactly what the second input made worth
// saying: that each source has a feed of its own before the mixer, and what
// each loop actually does rather than only which is which.
//
// Left to right, like the miniature — same drawing, unfolded — so opening this
// teaches the map rather than replacing it. Every box opens the panel where its
// controls are, which is what keeps it a diagram of *this app* rather than an
// illustration of NTSC.
const W = 660
// The trunk sits low enough for three loop runs to stack above it at the 22
// units apart their labels need. A box each would have been the obvious way to
// give the loops their own targets and it costs a column apiece; the loops earn
// their room vertically, where there was nothing but wire, rather than
// horizontally, where there is none — and dropping the box they used to share
// gave a column back.
const H = 180
const GUTTER = 14
const GAP = 14
const MID_Y = 92
const BRANCH_Y = 128
// The free row, under the branches: the boxes nothing is wired to. Parked among
// the wired boxes, a box with no wire has to be read as deliberate against a row
// full of wires, and there is only ever one gap wide enough to be that
// convincing. On a row of their own the emptiness is the row.
//
// The miniature carries the same row, at its own scale (chainLayout's FREE_Y).
// It went without one for a while — the two boxes were html chips under the svg,
// because at 304 units wide a row is the scarcest thing that drawing has, and 20
// of them bought its boxes a hittable height — and what brought the row back is
// that a chip is set in the panel's type inside a picture set in the map's. This
// drawing never had that problem: 180 units tall, with the room to say it the
// way it is said here. What must not differ between the two is whether pressing
// a box opens the stage, and that lives in MapBox for both.
const FREE_Y = 164
const BOX_H = 22
// What a caption costs per character here, for the cut `fitCaption` makes. The
// miniature measured 3.6 at 7px (chainLayout's SUB_CHAR) and this card sets the
// same text at 8.5 against an 11px label, so the estimate scales with the type.
// A box on this drawing is 92 units against the miniature's 50, so a name that
// was cut to two words there arrives whole here — which is the card doing what
// the card is for.
const SUB_CHAR = 4.4
// Both sides together, as the miniature's PAD is.
const SUB_PAD = 10
const HEAD = 3
const TURN = 5

// Six columns: A's two boxes, then the trunk's four. B's two sit under the
// first two, which is where a source and its feed belong on either row; the
// sound sits under the receiver, the one stage it is patched into; and the view
// sits under the screen, which is what feeds it. The lower row is therefore not
// "input B's row" but everything wired to one stage rather than passing along
// the trunk — and the arrowheads say which way each of them goes.
//
// It was seven while a FEEDBACK box stood between Mix and Tape. Nothing was
// removed from the drawing when it went — the three loops it stood for are
// still here, drawn where they actually re-enter — and every remaining box got
// 15% wider for it.
const COLS = 6
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
  row: 'a' | 'b' | 'trunk' | 'free'
  what: string
  // Nothing is drawn to this box, because it is not in the path: the modulation
  // bay acts on the controls rather than on the signal, and the deck is those
  // same controls gathered by the gesture that moves them. Both sit on the free
  // row, and the space around them is the whole of what says so — same decision
  // as the miniature's (chainLayout.ts, FreeBox).
  free?: true
}

const phaseBlurb = (name: string) =>
  PHASES.find(p => p.name === name)?.blurb ?? ''

const BOXES: Box[] = [
  {
    label: 'Source A',
    stage: SOURCE_A_STAGE,
    col: 0,
    row: 'a',
    what: phaseBlurb('Source A'),
  },
  {
    label: 'Feed A',
    stage: SOURCE_A_STAGE,
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
    label: 'Tape',
    stage: 'Tape',
    col: 3,
    row: 'trunk',
    what: phaseBlurb('Tape'),
  },
  {
    label: 'Receiver',
    stage: 'Receiver',
    col: 4,
    row: 'trunk',
    what: phaseBlurb('Receiver'),
  },
  {
    label: 'Screen',
    stage: 'Screen',
    col: 5,
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
    col: 4,
    row: 'b',
    what: SOUND_BLURB,
  },
  // The end of it, and the only box that is not the rig: where the picture is
  // watched from. Under Screen, because that is what feeds it.
  {
    label: 'View',
    stage: VIEW_STAGE,
    col: 5,
    row: 'b',
    what: VIEW_BLURB,
  },
  // And the two boxes wired to nothing at all, on the middle two columns of a
  // row of their own: what either is patched into is every control in every
  // other box, which is a line to two hundred sliders and therefore no line at
  // all. The pair is centred rather than anchored, because there is nothing here
  // for a column to mean.
  {
    label: 'Deck',
    stage: DECK_STAGE,
    col: 2,
    row: 'free',
    what: DECK_BLURB,
    free: true,
  },
  {
    label: 'Modulation',
    stage: MOD_STAGE,
    col: 3,
    row: 'free',
    what: MOD_BLURB,
    free: true,
  },
]

// The last trunk column, which the run out of the drawing leaves from and the
// camera loop taps — and the receiver's, which the sound climbs into. Named
// because losing the FEEDBACK column shifted every trunk index by one, and a
// literal 5 meant two different boxes on either side of that change.
const LAST_COL = 5
const SOUND_COL = 4

// Where each run leaves, where it lands, and which band it rides. Split from
// LOOP_STAGES because this half is geometry and that half is what the loop *is*
// — the panel and the miniature need the second and have no use for the first.
interface LoopRun {
  from: number
  to: number
  y: number
  turn: number
  // Where the name starts: just clear of the right edge of the box the run
  // lands on, so a name sits beside its own arrowhead rather than somewhere
  // along a span it shares with the other two.
  lx: number
  optical: boolean
}
// Just past the right edge of a landing column, which is where all three names
// begin. They no longer share one column of text, because they no longer share
// one box to land on.
const nameX = (col: number) => colX(col) + BOX_W / 2 + 10
const LOOP_RUN: Record<(typeof LOOP_STAGES)[number]['loop'], LoopRun> = {
  // The one run that reaches back past the decoder: it shoots the glass, so it
  // taps after the Screen, and what it returns is a picture rather than a
  // waveform — which is why it re-enters at the head of the chain, ahead of the
  // encoder, and not on the bus with the other two.
  camera: {
    from: colX(LAST_COL),
    to: colX(0),
    // The top run's name sits 5 above it and rises 7 more; below 16 the
    // ascenders are cut off by the top of the viewBox.
    y: 16,
    turn: 6,
    lx: nameX(0),
    optical: true,
  },
  // Off the bus and back onto it one pass later, so it taps at the Receiver —
  // what goes round is the composite the decoder saw.
  mixer: {
    from: colX(4),
    to: colX(2),
    y: 38,
    turn: 5,
    lx: nameX(2),
    optical: false,
  },
  // Both ends on the mixer's own box top, wide enough to clear the mixer loop's
  // single arrowhead at its centre — so three verticals on one box top still
  // read as a pair and a single.
  tape: {
    from: colX(2) + 26,
    to: colX(2) - 26,
    y: 60,
    turn: 5,
    lx: nameX(2),
    optical: false,
  },
}

// The three loops, each one its own button and its own stage. They were one box
// before — 'Feedback', standing on the trunk between Mix and Tape — and that
// box was the drawing's one lie: the three do not re-enter at the same place,
// so no single node could be where they land. The pass graph is what settled
// it (gpu/pipeline.ts): the camera comes back at `compose`, ahead of the
// encoder, which is inside Source A; the mixer at `fbComposite` and the loop
// bin at `tapePlay`/`tapeRec`, both straight after the A/B sum, which is Mix.
//
// So the wires are the whole of it now, which is what they had already become:
// dashed for light and solid for a wire, each with its own name, each lighting
// up while its loop runs. Making them the door as well costs the drawing no
// width — a box for each would have cost three columns — and it is what let the
// trunk drop from five boxes to four.
//
// Each label sits in the band above its own run, so the runs are what separate
// them — 22 units apart, because at the 18 they started on, two sentences read
// as one paragraph with a wire through it. `lx` is measured from the box the
// run lands on, so a name sits beside its own arrowhead.
//
// `from` and `to` are absolute, not column indices, because the delay loop is not
// a run around the chain at all: it leaves and re-enters the same box top, a
// second machine patched across one node, while the other two reach back from
// the stage they actually tap.
const RETURNS = LOOP_STAGES.map(l => ({ ...l, ...LOOP_RUN[l.loop] }))

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
  // How much the modulation bay is holding, and what that number counts. Handed
  // in rather than worked out here like every other box's, because a routing is
  // not a control: there is no group of sliders behind this box for `touchedIn`
  // to walk, and "off stock" is not what its count means.
  mod: BayLoad
  // And for the deck, for the same reason again: what its box counts is which
  // gestures are engaged, not controls off stock — every control it draws is
  // already counted on the box of the stage that owns it.
  deck: DeckLoad
  // The same question for the other branch: no audio input picked, so the box
  // is drawn and inert rather than absent.
  soundOn: boolean
  // What is standing in each box that has a picker, captioned under its name
  // (patched.ts). The same record the miniature draws from, so the two drawings
  // cannot name the same source two ways.
  patched: Readonly<Record<string, string | undefined>>
  onOpen: (stage: string, group: string) => void
  onClose: () => void
}) {
  const { controls, onOpen, onClose } = props
  // How much of each box is off stock. A box that narrows to one group counts
  // that group; a stage counts all of its own.
  const touchedIn = (box: Box): number => {
    if (box.stage === MOD_STAGE) return props.mod.n
    if (box.stage === DECK_STAGE) return props.deck.n
    const groups = stageGroups(box.stage).filter(
      g => box.group === undefined || g.name === box.group,
    )
    return groups
      .flatMap(g => g.sliders)
      .filter(s => !atRest(controls[s.key], s.key)).length
  }
  // The same count for a loop, which is a stage without being a box of its own —
  // its run is where a box would be, because there is no point on the trunk to
  // draw one at.
  const touchedInLoop = (stage: string) =>
    stageGroups(stage)
      .flatMap(g => g.sliders)
      .filter(s => !atRest(controls[s.key], s.key)).length
  const openStage = (stage: string, group?: string) => {
    onOpen(stage, group ?? stageGroups(stage)[0]?.name ?? '')
    onClose()
  }
  const open = (box: Box) => openStage(box.stage, box.group)
  const rowY = (row: Box['row']) =>
    row === 'b' ? BRANCH_Y : row === 'free' ? FREE_Y : MID_Y
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
  // The box that *is* a picker stage carries the caption; the feed beside it
  // narrows to a group inside that same stage and is not where anything is
  // patched in. Nothing on an inert box, which is already saying the opposite
  // in dashes.
  const holds = (box: Box): string | undefined =>
    box.group === undefined && !dead(box) ? props.patched[box.stage] : undefined

  return (
    <Dialog title="the signal path" size="diagram" onClose={onClose}>
      <p className={ui.helpText}>
        Two inputs, each with a feed of its own, meeting at the mixer — then one
        chain to the glass, with the sound patched into the receiver along the
        way and your own view at the end of it. Nothing here is a filter: every
        box is a piece of hardware misbehaving, and the artifacts come out of
        how they interfere. Click one to open its controls — and the three loops
        over the top are pressable too, each one its own way back into the
        chain. The two boxes on the bottom row have no wire on them: the
        modulation bay and the deck are patched into the controls rather than
        into the signal — one setting them moving on its own, the other
        gathering the ones a hand moves during a take — which is why they float.
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
        {Array.from({ length: LAST_COL }, (_, i) => (
          <path
            key={i}
            className={styles.wire}
            d={`M${colX(i) + BOX_W / 2} ${MID_Y}H${colX(i + 1) - BOX_W / 2}`}
          />
        ))}
        <path
          className={styles.wire}
          d={`M${colX(LAST_COL) + BOX_W / 2} ${MID_Y}H${W - 8}`}
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
            d={`M${colX(SOUND_COL) - BOX_W / 2 - 12} ${BRANCH_Y}H${colX(SOUND_COL) - BOX_W / 2}`}
          />
          <path
            className={styles.wire}
            d={`M${colX(SOUND_COL)} ${BRANCH_Y - BOX_H / 2}V${TOP + BOX_H}`}
          />
          <path
            className={styles.arrow}
            d={`M${colX(SOUND_COL) - HEAD} ${TOP + BOX_H + HEAD * 1.6}L${colX(SOUND_COL)} ${TOP + BOX_H}L${colX(SOUND_COL) + HEAD} ${TOP + BOX_H + HEAD * 1.6}Z`}
          />
        </g>
        {/* The view's run: the same riser under Screen, with the arrowhead at
            the other end. That one difference is the statement — everything
            else on this row is patched into the chain, and this is the only
            thing the chain is delivered to. */}
        <path
          className={styles.wire}
          d={`M${colX(LAST_COL)} ${TOP + BOX_H}V${BRANCH_Y - BOX_H / 2}`}
        />
        <path
          className={styles.arrow}
          d={`M${colX(LAST_COL) - HEAD} ${BRANCH_Y - BOX_H / 2 - HEAD * 1.6}L${colX(LAST_COL)} ${BRANCH_Y - BOX_H / 2}L${colX(LAST_COL) + HEAD} ${BRANCH_Y - BOX_H / 2 - HEAD * 1.6}Z`}
        />
        {RETURNS.map(r => {
          const d = returnPath(r.from, r.to, r.y, r.turn)
          const n = touchedInLoop(r.name)
          const live = props.live[r.loop]
          return (
            // Same press, same sentence and same keys as the miniature's runs —
            // see MapRun, which is where both drawings' copy of that rule lives
            // for the reason MapBox exists at all. What the card carries on its
            // face is the stage name: it is the heading you land on, and the
            // sentence about the loop is two inches below in the legend, where
            // it can be read rather than fitted.
            <MapRun
              key={r.loop}
              name={r.name}
              blurb={r.blurb}
              live={live}
              touched={n}
              // No fold on this card: a press marks and opens, never closes.
              pressHint=" — click for its controls"
              className={cx(
                styles.return,
                styles.loopBtn,
                r.optical && styles.optical,
                live && styles.live,
                n > 0 && styles.loopTouched,
              )}
              onOpen={() => openStage(r.name)}
            >
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
              <text className={styles.loopLabel} x={r.lx} y={r.y - 5}>
                {r.name}
                {live ? ' — running' : ''}
                {n > 0 ? ` • ${n}` : ''}
              </text>
            </MapRun>
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
          const held = holds(box)
          const sub =
            held === undefined
              ? undefined
              : fitCaption(held, BOX_W - SUB_PAD, SUB_CHAR)
          return (
            <MapBox
              key={box.label}
              name={box.label}
              blurb={box.what}
              offHint={deadHint(box)}
              patched={held}
              off={off}
              opens={opens(box)}
              touched={n}
              touchedSay={
                box.stage === MOD_STAGE
                  ? props.mod.say
                  : box.stage === DECK_STAGE
                    ? props.deck.say
                    : undefined
              }
              // No `foldHint`: this card marks and opens, it never closes a
              // stage, so the hover text stops at the off-stock count.
              className={cx(
                styles.node,
                box.free === true && styles.nodeFree,
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
                // Set off centre only where there is a caption to make room
                // for; every other box on the drawing is one line in the middle
                // of a chip and stays there.
                y={sub === undefined ? y : y - 4.5}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {box.label}
              </text>
              {sub === undefined ? null : (
                <text
                  className={styles.sub}
                  x={colX(box.col)}
                  y={y + 6.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {sub}
                </text>
              )}
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
                  {/* Whole here, where the row is html and wraps, rather than
                      cut to a box as the drawing has to cut it — the one place
                      a long filename can be read in full. Inside the sentence
                      rather than in a column of its own: a column between the
                      name and the blurb would start two of the twelve sentences
                      further right than the other ten, and the point of the
                      name holding its width is that the sentences line up. */}
                  {holds(box) === undefined ? null : (
                    <span className={styles.legendHolds}>{holds(box)} — </span>
                  )}
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
          const n = touchedInLoop(r.name)
          return (
            <li key={r.loop}>
              <button
                className={styles.legendBtn}
                onClick={() => openStage(r.name)}
              >
                <span className={styles.legendName}>{r.name}</span>
                <span className={styles.legendWhat}>
                  {r.what}
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
