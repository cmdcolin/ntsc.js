import { useState, useSyncExternalStore } from 'react'

import { cx } from './cx'
import { MORPH_LABEL_CHARS, MORPH_LABELS } from './morph'
import { PROFILE_NAME_MAX } from './profileModel'
import {
  derivedLabel,
  holdLabel,
  HOLD_LABEL_CHARS,
  named,
  rowLabel,
  transitionLabel,
} from './strip'
import { useStripApi } from './StripContext'
import styles from './StripRow.module.css'
import { transitionOf } from './transitions'
import ui from './ui.module.css'

import type { Row } from './strip'
import type { CSSProperties } from 'react'

// How much room the two word chips reserve: the widest their own ring can say,
// so stepping one cannot re-solve the card it is on. The stylesheet's `.hchip`
// has the measurement; both are constants because a ring is, and neither wants
// a fresh object per card per frame.
type RingWidth = CSSProperties & Record<'--ring-ch', number>
const HOLD_WIDTH: RingWidth = { '--ring-ch': HOLD_LABEL_CHARS }
const ARRIVE_WIDTH: RingWidth = { '--ring-ch': MORPH_LABEL_CHARS }

// The hold's fill, and the only thing in the tray that moves at frame rate.
//
// Its own component, subscribing on its own, which is the whole architecture in
// four lines: the store notifies every frame, so anything reading it re-renders
// every frame, and what re-renders is one `<i>` rather than the rundown around
// it. Rendered only inside the live card, since it is the only one with a hold
// running. Same arrangement as the morph readout in `LookBar` — see
// docs/EDITOR.md › _The React shape_.
function HoldBar() {
  const api = useStripApi()
  const through = useSyncExternalStore(api.subscribeProgress, api.progress)
  return (
    <i
      className={styles.fill}
      style={{ transform: `scaleX(${through ?? 0})` }}
      aria-hidden
    />
  )
}

// One row of the rundown.
//
// A button, not a div with a click: firing a row is the card's primary action,
// so it wants the keyboard and the focus ring for free. The two things that are
// *not* that action — the hold, and removing the row — are their own controls
// inside it, which is why this is a `<div role=listitem>` holding a button
// rather than a button holding buttons (which is invalid, and which Firefox
// resolves by dropping the inner ones).
export function StripRow(props: {
  row: Row
  index: number
  live: boolean
  dragging: boolean
}) {
  const api = useStripApi()
  const { row } = props
  // Undefined for a plain cut, and for a name off a shelf this build does not
  // have — which the chip draws the same way, since both mean "nothing off the
  // shelf is armed here".
  const transition =
    row.arrive.transition === null
      ? undefined
      : transitionOf(row.arrive.transition)
  // Whether this card is being renamed. Local to the card and not in the strip:
  // it is a state of the *pointer*, not of the rundown, so it must not be
  // persisted and must not survive the row being dragged elsewhere.
  const [editing, setEditing] = useState(false)
  const commit = (value: string) => {
    setEditing(false)
    // Compared before writing, so a field opened and closed without a change
    // does not bank a rundown edit — which would persist, and which undo (when
    // it arrives) would have to step back through.
    if (value !== row.name) api.renameRow(props.index, value)
  }
  return (
    <div
      className={cx(
        styles.card,
        props.live && styles.live,
        props.dragging && styles.dragging,
      )}
      role="listitem"
      data-index={props.index}
    >
      <div className={styles.face}>
        {/* `data-drag` marks this as the reorder handle: the tray starts a drag
            from a press here and from nowhere else on the card, so the chips
            and the ✕ below stay pressable. */}
        <button
          className={styles.fire}
          data-drag=""
          onClick={() => api.fireRow(props.index)}
          title={`fire row ${props.index + 1}`}
        >
          <span className={styles.head}>
            <span className={styles.num}>{props.index + 1}</span>
            {/* The kind rides on a data attribute rather than on three classes
              picked by `styles[fill.kind]`. Dynamic indexing is invisible to
              cssModules.test.ts's scan, which would read all three as dead
              rules and delete them at the next tidy-up. */}
            <span className={styles.kind} data-kind={row.fill.kind}>
              {row.fill.kind === 'roll'
                ? '⟳'
                : row.fill.kind === 'jitter'
                  ? '⚄'
                  : '▤'}
            </span>
          </span>
          {/* A given name and a derived one are the same kind of string, so they
            are drawn differently: the author's words in the panel's own colour,
            the app's guess dimmed and in the prose grey. Otherwise there is no
            reading a rundown for what somebody actually decided. */}
          <span className={cx(styles.name, !named(row) && styles.guessed)}>
            {rowLabel(row)}
          </span>
        </button>
        {/* The field covers the face rather than replacing it, which is what
            keeps the card the size it was — `.face` in the stylesheet has the
            measurement. A *sibling* of the button and not a child: an input
            inside a button is interactive content inside a button, which is
            invalid and which Firefox resolves by dropping the input. Being a
            sibling is also what keeps a press in the field from starting a
            drag, since the handle is the button and `closest` does not find it
            from here. */}
        {!editing ? null : (
          <input
            className={styles.field}
            defaultValue={row.name}
            // What the card would say anyway, so the field shows what clearing
            // it gets you rather than an empty box.
            placeholder={derivedLabel(row)}
            maxLength={PROFILE_NAME_MAX}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') commit(e.currentTarget.value)
              if (e.key === 'Escape') {
                // Escape is the panel's own "back out of whatever mode this
                // is", and it would otherwise close something behind the card
                // as well.
                e.stopPropagation()
                setEditing(false)
              }
            }}
            // Commits rather than cancels: clicking away from a name you have
            // typed means the name, and a field that threw it away on the way
            // out would be the more surprising of the two.
            onBlur={e => commit(e.currentTarget.value)}
          />
        )}
      </div>
      <div className={styles.feet}>
        {/* The field a hand touches most, so it is on the card rather than in
            the menu — the design's one placement rule for the row. */}
        <button
          className={cx(ui.bare, styles.chip, styles.hchip)}
          style={HOLD_WIDTH}
          data-act="hold"
          onClick={() => api.cycleHold(props.index)}
          title="how long this row holds — click to step"
        >
          {holdLabel(row.hold)}
        </button>
        {/* Two chips, because "how it arrives" is two different things: the
            look glides over `seconds`, and the *source* arrives behind a fault
            off the shelf. They compose — the board walks while the fault does
            the cutting — which is why neither is a mode of the other. */}
        <button
          className={cx(ui.bare, styles.chip, styles.arrive, styles.achip)}
          style={ARRIVE_WIDTH}
          data-act="arrive"
          onClick={() => api.cycleArrive(props.index)}
          title="how this row's look arrives — click to step"
        >
          {MORPH_LABELS[row.arrive.seconds]}
        </button>
        {/* One glyph, not the shelf's word: six controls share 190px and
            "collapse" pushed the ✕ out past the card's `overflow: hidden`. The
            name it stands for is in the title, which is the arrangement the
            `.kind` glyph above already uses. */}
        <button
          className={cx(
            ui.bare,
            styles.chip,
            styles.arrive,
            styles.tchip,
            row.arrive.transition !== null && styles.chipOn,
          )}
          data-act="transition"
          onClick={() => api.cycleTransition(props.index)}
          title={
            transition === undefined
              ? 'this row cuts straight in — click for a transition off the shelf'
              : `${transition.label} — ${transition.title}`
          }
        >
          {transitionLabel(row.arrive.transition)}
        </button>
        {/* `data-act` on the three verbs, the way the card already carries
            `data-index` and `data-drag`. They were reached positionally by
            `scripts/traycheck.mjs`, and adding the transition chip above
            silently moved all three — a harness that then deleted a row where
            it meant to rename one, and reported it as five unrelated failures.
            A name is what makes a chip added here cost nothing there. */}
        <button
          className={cx(ui.bare, styles.chip, styles.rename)}
          data-act="rename"
          onClick={() => setEditing(true)}
          title="name this row"
        >
          ✎
        </button>
        {/* The cheapest thing an editor gives you: a row you have dialled in is
            worth several with different holds, and building the second by hand
            means finding that board again. */}
        <button
          className={cx(ui.bare, styles.chip, styles.rename)}
          data-act="dup"
          onClick={() => api.duplicateRow(props.index)}
          title="the same row again, next to this one"
        >
          ⧉
        </button>
        <button
          className={cx(ui.bare, styles.drop)}
          data-act="drop"
          onClick={() => api.removeRow(props.index)}
          title="take this row out"
        >
          ✕
        </button>
      </div>
      <div className={styles.track}>{props.live ? <HoldBar /> : null}</div>
    </div>
  )
}
