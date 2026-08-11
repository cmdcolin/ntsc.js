import { useState, useSyncExternalStore } from 'react'

import { cx } from './cx'
import { MORPH_LABELS } from './morph'
import { PROFILE_NAME_MAX } from './savedProfiles'
import { derivedLabel, holdLabel, named, rowLabel } from './strip'
import { useStripApi } from './StripContext'
import styles from './StripRow.module.css'
import ui from './ui.module.css'

import type { Row } from './strip'

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
      {editing ? (
        // The whole face, swapped for the field. An input *inside* the fire
        // button would be interactive content inside a button — invalid, and
        // Firefox resolves it by dropping the input — so the two take turns
        // rather than nest. Losing the drag handle for the moment somebody is
        // typing a name is not a loss.
        <input
          className={styles.field}
          defaultValue={row.name}
          // What the card would say anyway, so the field shows what clearing it
          // gets you rather than an empty box.
          placeholder={derivedLabel(row)}
          maxLength={PROFILE_NAME_MAX}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') {
              // Escape is the panel's own "back out of whatever mode this is",
              // and it would otherwise close something behind the card as well.
              e.stopPropagation()
              setEditing(false)
            }
          }}
          // Commits rather than cancels: clicking away from a name you have
          // typed means the name, and a field that threw it away on the way out
          // would be the more surprising of the two.
          onBlur={e => commit(e.currentTarget.value)}
        />
      ) : (
        /* `data-drag` marks this as the reorder handle: the tray starts a drag
           from a press here and from nowhere else on the card, so the chips and
           the ✕ below stay pressable. */
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
      )}
      <div className={styles.feet}>
        {/* The field a hand touches most, so it is on the card rather than in
            the menu — the design's one placement rule for the row. */}
        <button
          className={cx(ui.bare, styles.chip)}
          onClick={() => api.cycleHold(props.index)}
          title="how long this row holds — click to step"
        >
          {holdLabel(row.hold)}
        </button>
        <button
          className={cx(ui.bare, styles.chip, styles.arrive)}
          onClick={() => api.cycleArrive(props.index)}
          title="how this row arrives — click to step"
        >
          {MORPH_LABELS[row.arrive.seconds]}
        </button>
        <button
          className={cx(ui.bare, styles.chip, styles.rename)}
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
          onClick={() => api.duplicateRow(props.index)}
          title="the same row again, next to this one"
        >
          ⧉
        </button>
        <button
          className={cx(ui.bare, styles.drop)}
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
