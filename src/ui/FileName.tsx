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

// What a rolled pick adds to its caption. Up to two glyphs, both of them things
// the picker cannot say: whether this roll has been kept, and where the credit
// is.
//
// The ★ is the whole answer to what a channel *is* — the caption beside it rolls
// the next file and this one is gone — so it sits where the picture is named
// rather than in the dialog that lists the kept ones, which is a place you go
// after the moment has passed. It is optional because only the Commons channels
// have a shelf to keep a roll on; an archive.org roll carries the credit link
// alone rather than a ☆ that would do nothing when pressed.
export function WikiCaption(props: {
  page: string
  // Where the link goes, named for the tooltip — "Wikimedia Commons",
  // "archive.org". The two bands roll from different places and the credit is
  // the one thing a caption must not be vague about.
  where: string
  star: { starred: boolean; onStar: () => void } | null
}) {
  const { star } = props
  return (
    <>
      {star === null ? null : (
        <button
          type="button"
          className={cx(styles.captionBtn, star.starred && styles.captionOn)}
          title={
            star.starred
              ? 'starred — click to drop it from your Commons favorites'
              : 'keep this one: star it and it is on your Commons favorites shelf, whatever the next roll brings'
          }
          aria-label={star.starred ? 'unstar this file' : 'star this file'}
          aria-pressed={star.starred}
          onClick={() => star.onStar()}
        >
          {star.starred ? '★' : '☆'}
        </button>
      )}
      {/* These files carry a licence and an author and this app carries neither,
          so every pick keeps one link to the page that does. A new tab: a set is
          never navigated away from. */}
      <a
        className={styles.captionBtn}
        href={props.page}
        target="_blank"
        rel="noreferrer"
        title={`open this file on ${props.where} — who made it, and under which licence`}
      >
        ↗
      </a>
    </>
  )
}
