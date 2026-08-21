import { cx } from './cx'
import { CreditLink } from './MediaRow'
import styles from './SelectRow.module.css'

import type { PoolOrigin } from '../sources/pools'
import type { ReactNode } from 'react'

// Caption under a loaded file/URL source. Clicking it re-fires the source
// handler, reopening the file picker (or URL dialog) — the shortest way back to
// the door this slot came through, without going up to the picker and finding
// the option again.
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
// reopens, in both cases with the option left exactly where it is. The picker
// above reaches all three as well (MenuRow.tsx fires on every pick, the option
// already lit included); this is the same door one click nearer, under the name
// of the thing it would replace.
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

// What a pick off one of the public archives adds to its caption: two glyphs,
// both of them things the picker cannot say — whether this one has been kept,
// and where the credit is.
//
// The ★ is the whole answer to what a random source *is*: the caption beside it
// rolls the next file and this one is gone. So it sits where the picture is
// named rather than in the dialog that lists the kept ones, which is a place you
// go after the moment has passed.
//
// It is no longer optional. Both sources used to be here but only Commons had a
// shelf, so an archive.org roll drew the credit link alone — a clip you liked
// could only be kept by being lucky enough to have rolled it off the other one.
// The shelf takes either now (ui/clipLibrary.ts), so both get the ★.
export function PickCaption(props: {
  page: string
  // Which archive the link goes to. Named on the tooltip, because the two roll
  // from different places and the credit is the one thing a caption must not be
  // vague about.
  origin: PoolOrigin
  kept: boolean
  onKeep: () => void
}) {
  return (
    <>
      <button
        type="button"
        className={cx(styles.captionBtn, props.kept && styles.captionOn)}
        title={
          props.kept
            ? 'kept — click to take it off your clip shelf'
            : 'keep this one: it goes on your clip shelf, whatever the next roll brings'
        }
        aria-label={props.kept ? 'unkeep this file' : 'keep this file'}
        aria-pressed={props.kept}
        onClick={() => props.onKeep()}
      >
        {props.kept ? '★' : '☆'}
      </button>
      {/* These files carry a licence and an author and this app carries neither,
          so every pick keeps one link to the page that does. */}
      <CreditLink
        origin={props.origin}
        href={props.page}
        label="this file"
        className={styles.captionBtn}
      />
    </>
  )
}
