import { clampCardText } from '../sources/teletype'
import { cx } from './cx'
import styles from './SelectRow.module.css'
import ui from './ui.module.css'

// The card's own text, editable in place for as long as teletype is the
// source. The dialog is where you arrive and where the palette lives, but once
// a card is up the words have to be somewhere obvious: a grey caption you have
// to know is a button is not that, and this source has no filename to put
// there anyway.
//
// It commits on every keystroke and holds no draft of its own. Printing used to
// wait for a blur — the reveal restarts from nothing each time a card is sent,
// and replaying it per letter would have meant never seeing more than the first
// one — but an edit to a card that is already up doesn't go back to the printer
// (see printCard's `reveal`), so there is nothing left to defer. Watching the
// letters land as you type is the entire fantasy of the source.
export function TeletypeRow(props: {
  text: string
  onChange: (text: string) => void
  onOpenDialog: () => void
}) {
  return (
    <div className={styles.inputRow}>
      <span className={styles.tag} title="what the card says">
        ✎
      </span>
      <textarea
        className={styles.cardInput}
        rows={2}
        // Art is made of columns, so a long line scrolls rather than folding
        // somewhere the card would not fold it.
        wrap="off"
        title="the card's text — it prints as you type"
        value={props.text}
        onChange={e => props.onChange(clampCardText(e.target.value))}
      />
      <button
        className={cx(ui.btn, ui.btnFlush)}
        type="button"
        title="open the full editor — draw on it, block graphics, starters"
        onClick={() => props.onOpenDialog()}
      >
        ▚
      </button>
    </div>
  )
}
