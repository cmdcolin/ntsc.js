import { cx } from './cx'
import styles from './LookBar.module.css'
import { mutateAmountFor } from './mutate'

import type { MutateAmount } from './mutate'

// The verbs that act on the whole look, in one row under the masthead.
//
// They used to sit at the foot of Presets, where they were the last 58px of the
// section that already took a quarter of the sidebar — and none of them is a
// preset. Compare previews the stock signal, mutate and surprise roll the board
// wherever it happens to be, undo walks the history: all of them apply just as
// much to a look built slider by slider as to one picked off a chip.
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
      <button
        className={styles.btn}
        onClick={props.onSurprise}
        title="stack a few random presets from different groups — a fresh look each roll, with the recipe shown in the preset chips"
      >
        surprise
      </button>
      <button
        className={styles.btn}
        onClick={e => props.onMutate(mutateAmountFor(e))}
        title="jitter every control around the current look, for a related variation (also happy accidents) — shift for a wilder roll, alt for a gentle one, ctrl (or cmd) for turbo, which throws most controls past anything a real set would do"
      >
        mutate
      </button>
      <button
        className={cx(styles.btn, !props.canUndo && styles.btnOff)}
        onClick={props.onUndo}
        disabled={!props.canUndo}
        title="step back through the looks you have been through (ctrl+z)"
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
