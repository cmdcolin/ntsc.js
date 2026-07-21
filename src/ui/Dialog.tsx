import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from '../app.module.css'
import { cx } from './cx'

// Shared modal shell: a dimmed backdrop that closes on outside click or Escape,
// a centered card, and a title row with a close button. Escape and focus are
// bound to the dialog's own document, so it also works when the panel lives in
// the popout window — a listener on the main window would never see the key.
export function Dialog(props: {
  title: ReactNode
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { onClose } = props

  useEffect(() => {
    const doc = cardRef.current?.ownerDocument
    if (doc === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [onClose])

  // Pull focus into the dialog on open — unless it already holds an autofocused
  // field (e.g. the YouTube URL box) — and hand it back to whatever the trigger
  // was on close, so keyboard users aren't dropped at the top of the document.
  useEffect(() => {
    const card = cardRef.current
    if (card === null) return
    const doc = card.ownerDocument
    const restore = doc.activeElement
    if (!card.contains(doc.activeElement)) card.focus()
    return () => {
      if (restore instanceof HTMLElement) restore.focus()
    }
  }, [])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={cardRef}
        className={cx(styles.card, props.wide === true && styles.cardWide)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.cardRow}>
          <h2 id={titleId} className={styles.h2}>
            {props.title}
          </h2>
          <button className={cx(styles.btn, styles.btnFlush)} onClick={onClose}>
            close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
