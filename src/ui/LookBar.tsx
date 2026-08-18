import { useSyncExternalStore } from 'react'

import { cx } from './cx'
import styles from './LookBar.module.css'
import { MORPH_LABELS, MORPH_SECONDS } from './morph'
import { mutateAmountFor } from './mutate'
import { MenuItem, Popover } from './Popover'

import type { MorphSeconds, MorphStore } from './morph'
import type { MutateAmount } from './mutate'
import type { ReactNode } from 'react'

// The verbs that act on the whole look, in one row under the masthead.
//
// They used to sit at the foot of Presets, where they were the last 58px of the
// section that already took a quarter of the sidebar — and none of them is a
// preset. Compare previews the stock signal, the two random rolls move the
// board wherever it happens to be, undo walks the history: all of them apply
// just as much to a look built slider by slider as to one picked off a chip.
//
// Chrome, not controls, so they wear the quiet outline the masthead icons and
// the catalog handle wear rather than the filled look of the preset chips and
// the control rows. That is the distinction the row is drawing: these do things
// to the board, the buttons below it are the board.
//
// "copy link" used to be the widest of them, and it was a button for something
// the address bar was already doing: useUrlState mirrors the live look into the
// query string every time it changes, so the URL is always the link and copying
// it is the browser's own gesture. It survives in the ⌘K palette for anyone who
// wants one keystroke for it. Losing it is what lets the row carry the panel's
// ordinary type size and still hold all five verbs — including redo, which
// never fit before at either size.
export function LookBar(props: {
  comparing: boolean
  onStartCompare: () => void
  onEndCompare: () => void
  onSurprise: () => void
  onMutate: (amount: MutateAmount) => void
  // The third roll, and the only one that leaves every resting value alone: it
  // re-cables the modulation bay. It belongs in this segmented set rather than
  // in the bay's own stage — which is a box on the map, shut until you press it
  // — because it is the same gesture as the two beside it and gets pressed the
  // same way, repeatedly, while looking at the picture.
  onRollMotion: (amount: MutateAmount) => void
  // The three rolls that did not earn a word in the row. Each is a different
  // *shape* of random rather than a different amount of the ones above — see
  // the menu at the foot of this file for what each is for — and they are
  // behind the set's `⋯` because the row has no width left for a fourth word
  // and the segmented three are the ones a session reaches for by reflex.
  onSurpriseOne: () => void
  onSpike: (amount: MutateAmount) => void
  onCross: () => void
  // How long the verbs in this row take to arrive, and the button that cycles
  // it. It belongs here rather than in a settings dialog because it changes what
  // every other button in the row *does*, and because the duration you want is a
  // function of what you are doing right now: a cut while dialing a look in, a
  // long morph while performing one.
  morphSeconds: MorphSeconds
  onSetMorph: (seconds: MorphSeconds) => void
  // A morph's progress, as a store rather than a value: it changes every frame,
  // and a prop would mean App re-rendering the whole panel at that rate to carry
  // it down here. Subscribed to by the one button that draws it.
  morphStore: MorphStore
  onStopMorph: () => void
  // The tags menu, passed in rather than built here: it owns a popover, and this
  // row's job is to seat it among the other whole-board verbs. It goes after the
  // two that produce a look worth describing — roll something up with the
  // segmented pair, then tag it — and before the buttons that walk the history,
  // which stay the row's tail.
  tags: ReactNode
  // The whole board back to stock. Among the take-back verbs rather than beside
  // `compare` — which is the other button in this row about the clean signal —
  // because what it has in common with undo is what a hand reaching for it
  // wants: out of here. Compare is a look at stock with your finger down, and
  // seating a wipe next to a preview is how a held gesture becomes a lost look.
  onReset: () => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
}) {
  return (
    <div className={styles.bar}>
      {/* Held, not clicked, so it stays a gesture: press and the picture goes
          to stock, release and it comes back. The label says which state you
          are in, since the button is under your finger while it happens. */}
      <button
        className={cx(styles.btn, props.comparing && styles.btnOn)}
        onPointerDown={props.onStartCompare}
        onPointerUp={props.onEndCompare}
        onPointerLeave={props.onEndCompare}
        title="hold to preview the clean signal, release to return (or hold C)"
      >
        {props.comparing ? 'showing clean…' : 'compare'}
      </button>
      {/* The two rolls, joined into one segmented control. They were `surprise`
          and `mutate`, sat apart in a line of six unrelated verbs, and nothing
          about either word said they were a pair or which way they differed —
          you had to already know the mechanism to guess it from the label.
          Two fixes: sharing a border says "one thing, two modes", and sharing
          the word `random` leaves the second word carrying the whole
          difference — a whole look, or a nudge to the one you have.
          Deliberately no jargon in either. The mechanism is presets against
          per-control jitter, and naming it that way ("shuffle presets") asks
          you to already know what a preset is, which is exactly the knowledge
          somebody reaching for a random button has not got yet. `look` and
          `nudge` say what you get instead, and the chips below fill in where a
          look came from once you have pressed it. */}
      <div className={styles.pair}>
        <button
          className={cx(styles.btn, styles.pairLeft)}
          onClick={props.onSurprise}
          title="a look you have not seen: a few random presets from different groups, stacked over stock — the preset chips light up to show what went in. This replaces the look you have; random nudge keeps it"
        >
          random look
        </button>
        <button
          className={cx(styles.btn, styles.pairMid)}
          onClick={e => props.onMutate(mutateAmountFor(e))}
          title="keep this look and nudge every control randomly around where it sits, for a related variation (also happy accidents) — shift for a wilder roll, alt for a gentler one, ctrl (or cmd) for turbo, which throws most controls past anything a real set would do. The die on a stage heading nudges that stage alone"
        >
          random nudge
        </button>
        {/* Third rather than second, because the pair reads left to right by how
            much of the look it disturbs — a whole new one, then a nudge to it —
            and this one disturbs none of it: every slider stays exactly where it
            is and what changes is what is moving them. Same modifier ladder as
            its neighbour, so the keys mean one thing across the set. */}
        <button
          className={cx(styles.btn, styles.pairMid)}
          onClick={e => props.onRollMotion(mutateAmountFor(e))}
          title="keep every slider where it is and re-cable what is moving them: a fresh patch of LFOs, drift and sample-and-hold onto controls this look is actually using. It replaces what is in the modulation bay, and undo puts it back — shift for more and deeper, alt for a single slow one, ctrl (or cmd) for turbo"
        >
          random motion
        </button>
        <RollsMenu
          onSurpriseOne={props.onSurpriseOne}
          onSpike={props.onSpike}
          onCross={props.onCross}
        />
      </div>
      <MorphControl
        morphSeconds={props.morphSeconds}
        onSetMorph={props.onSetMorph}
        store={props.morphStore}
        onStop={props.onStopMorph}
      />
      {props.tags}
      <button
        className={styles.btn}
        onClick={props.onReset}
        title="put the whole board back to stock: every control, the modulation bay and the stab gate — the same as the “clean” chip. Your sources and where you are looking stay as they are, and ctrl+z takes the look back"
      >
        reset
      </button>
      <button
        className={cx(styles.btn, !props.canUndo && styles.btnOff)}
        onClick={props.onUndo}
        disabled={!props.canUndo}
        title="step back through the looks you have been through (ctrl+z). It arrives however morph says looks arrive, so at a long one the way back is a transition too"
      >
        undo
      </button>
      {/* Only once there is a walk to step forward into: a permanently greyed
          redo would cost a slot in the row on every session that never undid
          anything, and this row has one line to fit in. */}
      {props.canRedo ? (
        <button
          className={styles.btn}
          onClick={props.onRedo}
          title="step forward again (ctrl+shift+z)"
        >
          redo
        </button>
      ) : null}
    </div>
  )
}

// The rolls that did not fit the row, in the row's own segmented set.
//
// A menu rather than three more modifiers on the buttons beside it, because the
// ladder those carry (shift, alt, ctrl) says *how hard* and none of these is a
// harder or softer version of anything. A preset drawn whole, two controls
// thrown a long way, and this look crossed with a fresh one are three different
// answers to "give me something else", and which one is wanted depends on how
// attached you are to what is on screen — which is what the order here is: the
// roll that keeps least of your look at the top, the one that keeps most at the
// foot.
//
// A glyph rather than a fourth word, and the row's width is the whole reason:
// the three labels next to it come to 190px of a 332px row, and `more…` on the
// end took it past 332 — which `.pair` cannot wrap, so instead every one of the
// four squeezed and broke its label over two lines. `⋯` costs 26px, keeps the
// set on one line, and is the glyph the masthead's own menu already wears.
function RollsMenu(props: {
  onSurpriseOne: () => void
  onSpike: (amount: MutateAmount) => void
  onCross: () => void
}) {
  return (
    <Popover
      trigger={attrs => (
        <button
          {...attrs}
          className={cx(styles.btn, styles.pairRight)}
          title="three more rolls: one authored preset whole, a couple of controls thrown hard, or this look crossed with a fresh one"
        >
          ⋯
        </button>
      )}
    >
      {id => (
        <>
          <MenuItem
            icon="◆"
            label="random preset"
            hint=""
            title="one of the authored looks, whole and at full strength — no stacking and no jitter, so what you get is what somebody tuned. The chip lights up to say which"
            closes={id}
            onClick={props.onSurpriseOne}
          />
          <MenuItem
            icon="↯"
            label="random fault"
            hint=""
            title="throw a couple of controls a long way and touch nothing else: one fault you can see, name and take back, on a look otherwise exactly as you left it"
            closes={id}
            onClick={() => props.onSpike('normal')}
          />
          <MenuItem
            icon="⤫"
            label="random cross"
            hint=""
            title="keep some circuits of this look — the tape, the tube, whichever way it falls — and let a fresh roll answer for the rest"
            closes={id}
            onClick={props.onCross}
          />
        </>
      )}
    </Popover>
  )
}

// The morph slot, which holds one of two things: the duration a look *will*
// take, or — while one is travelling — how far along it is and the way to stop
// it. One slot rather than two, because they are one widget read two ways and
// this row has no sixth place to give.
//
// The flight readout is worth drawing at all because a long morph is otherwise
// indistinguishable from an app that ignored you: at 30s the first second of a
// step back moves almost nothing, and undo is exactly the verb where "did that
// register?" is the question. The bar answers it, and pressing it answers "I
// liked it better half way" — which until now you could only say by grabbing a
// slider, that is, by changing the look you wanted to keep.
//
// This is the only component that subscribes to the morph, and that is the
// point: progress moves every frame, so anything holding it as state re-renders
// at the frame rate. Held here it costs one button per frame, for the seconds a
// morph lasts. Held in App — which builds the whole panel — it would cost ~200
// control rows per frame, which is why the engine publishes it as a store
// instead of the app threading it down as a prop.
function MorphControl(props: {
  morphSeconds: MorphSeconds
  onSetMorph: (seconds: MorphSeconds) => void
  store: MorphStore
  onStop: () => void
}) {
  const progress = useSyncExternalStore(props.store.subscribe, props.store.get)
  if (progress === null) {
    return (
      <MorphSelect
        morphSeconds={props.morphSeconds}
        onSetMorph={props.onSetMorph}
      />
    )
  }
  return (
    <button
      className={cx(styles.btn, styles.flight)}
      onClick={props.onStop}
      title={`travelling to the new look over ${props.morphSeconds}s — press to stop here and keep the half-way look, which is a look like any other. Grabbing any slider does the same`}
    >
      <span
        className={styles.flightFill}
        style={{ transform: `scaleX(${progress})` }}
      />
      <span className={styles.flightLabel}>stop here</span>
    </button>
  )
}

// How long a look takes to arrive. Split out only so the row above reads as the
// five verbs it is rather than as four verbs and a select's worth of markup.
function MorphSelect(props: {
  morphSeconds: MorphSeconds
  onSetMorph: (seconds: MorphSeconds) => void
}) {
  return (
    <select
      className={cx(
        styles.btn,
        styles.morphSelect,
        props.morphSeconds > 0 && styles.btnOn,
      )}
      value={props.morphSeconds}
      onChange={e => {
        const picked = MORPH_SECONDS.find(s => String(s) === e.target.value)
        if (picked !== undefined) props.onSetMorph(picked)
      }}
      title={
        props.morphSeconds > 0
          ? `presets, both rolls and undo travel to the new look over ${props.morphSeconds}s instead of cutting to it — change it here. While one travels this button becomes the way to stop it. Rolling again mid-morph carries on from wherever the board has got to`
          : 'presets, rolls and undo land in one frame — pick a duration to make them travel there instead, which is where the looks between two presets live'
      }
    >
      {MORPH_SECONDS.map(s => (
        <option key={s} value={s}>{`morph: ${MORPH_LABELS[s]}`}</option>
      ))}
    </select>
  )
}
