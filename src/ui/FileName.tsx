import { cx } from './cx'
import styles from './SelectRow.module.css'

import type { ReactNode } from 'react'

// Caption under a loaded file/URL source. Clicking it re-fires the source
// handler, reopening the file picker (or URL dialog) — the native <select>
// can't re-emit onChange for the already-selected option, so re-picking the
// same source lives here.
// The same caption, for a file last session held that the reload could not
// reopen on its own: the browser remembers it as a handle on the user's disk,
// and re-granting read access has to come from a gesture.
export function ReopenFile({
  name,
  onReopen,
}: {
  name: string
  onReopen: () => void
}) {
  return name === '' ? null : (
    <button
      type="button"
      className={styles.fileName}
      title={`${name} — click to reopen it, the browser asks first`}
      onClick={() => onReopen()}
    >
      ↺ {name}
    </button>
  )
}

// `action` names what the click does, because it is not always "change": a
// Commons channel rolls another file out of the same pool and the clip shelf
// reopens, in both cases with the option left exactly where it is. The <select>
// can't re-emit onChange for an option that is already selected, so this caption
// is the only way back to any of them.
//
// The default is read off `props` rather than written into the destructure. A
// default inside a destructured parameter is an AssignmentPattern, which the
// React Compiler cannot lower — it bails out and silently drops this
// component's memoization, and only `pnpm compiler` says so.
export function FileName(props: {
  name: string
  onReopen: () => void
  action?: string
  // Anything that belongs to the file this caption names rather than to the
  // choice of source above it — the ★ that keeps a Commons roll, and the way
  // through to its page. In the caption row because that is the one line of the
  // panel that is about *this* picture and not about where pictures come from.
  extra?: ReactNode
}) {
  const { name, onReopen } = props
  const action = props.action ?? 'change'
  return name === '' ? null : (
    <div className={styles.fileRow}>
      <button
        type="button"
        className={styles.fileCaption}
        title={`${name} — click to ${action}`}
        onClick={() => onReopen()}
      >
        {name}
      </button>
      {props.extra}
    </div>
  )
}

// What a Commons pick adds to its caption. Two glyphs, both of them things the
// picker cannot say: whether this roll has been kept, and where the credit is.
//
// The ★ is the whole answer to what a channel *is* — the caption beside it rolls
// the next file and this one is gone — so it sits where the picture is named
// rather than in the dialog that lists the kept ones, which is a place you go
// after the moment has passed.
export function WikiCaption(props: {
  page: string
  starred: boolean
  onStar: () => void
}) {
  return (
    <>
      <button
        type="button"
        className={cx(styles.captionBtn, props.starred && styles.captionOn)}
        title={
          props.starred
            ? 'starred — click to drop it from your Commons favorites'
            : 'keep this one: star it and it is on your Commons favorites shelf, whatever the next roll brings'
        }
        aria-label={props.starred ? 'unstar this file' : 'star this file'}
        aria-pressed={props.starred}
        onClick={() => props.onStar()}
      >
        {props.starred ? '★' : '☆'}
      </button>
      {/* Commons files carry a licence and a photographer and this app carries
          neither, so every pick keeps one link to the page that does. A new tab:
          a set is never navigated away from. */}
      <a
        className={styles.captionBtn}
        href={props.page}
        target="_blank"
        rel="noreferrer"
        title="open this file on Wikimedia Commons — who shot it, and under which licence"
      >
        ↗
      </a>
    </>
  )
}
