import { useState } from 'react'

import { cx } from './cx'
import styles from './SelectRow.module.css'
import ui from './ui.module.css'

// The card's own text, editable in place for as long as teletype is the
// source. The dialog is where you arrive and where the block palette lives,
// but once a card is up the words have to be somewhere obvious: a grey caption
// you have to know is a button is not that, and this source has no filename to
// put there anyway.
//
// Printing is deliberate — click away or ⌘/ctrl+enter — because committing per
// keystroke would restart the reveal on every letter typed.
export function TeletypeRow(props: {
  text: string
  onSubmit: (text: string) => void
  onOpenDialog: () => void
}) {
  const [draft, setDraft] = useState(props.text)
  const [printed, setPrinted] = useState(props.text)
  // The card also changes from outside this row — the dialog, a shared link —
  // and the draft follows when it does. Adjusted during render rather than in
  // an effect, which is React's own advice for state derived from a prop.
  if (props.text !== printed) {
    setPrinted(props.text)
    setDraft(props.text)
  }
  const commit = () => {
    if (draft !== props.text) props.onSubmit(draft)
  }
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
        title="the card's text — ⌘/ctrl+enter, or click away, to print it"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
      />
      <button
        className={cx(ui.btn, ui.btnFlush)}
        type="button"
        title="open the full editor — block graphics, starters"
        onClick={() => props.onOpenDialog()}
      >
        ▚
      </button>
    </div>
  )
}
