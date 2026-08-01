import { useId } from 'react'

import styles from '../app.module.css'
import { cx } from './cx'
import { useModalDialog } from './useModalDialog'

import type { ReactNode } from 'react'

// Three card widths, named for what goes in them rather than by measurement:
// 'form' is a couple of rows of controls, 'prose' is text to read, 'diagram' is
// the chain map, which scales to whatever width it is given.
const CARD_SIZE = {
  form: '',
  prose: styles.cardWide,
  diagram: styles.cardDiagram,
}

// Shared modal shell built on the native <dialog> element (see useModalDialog).
// The card is an inner box so a click lands on the backdrop (the dialog element
// itself) only when it misses the card.
export function Dialog(props: {
  title: ReactNode
  onClose: () => void
  size: keyof typeof CARD_SIZE
  children: ReactNode
}) {
  const ref = useModalDialog()
  const titleId = useId()
  const { onClose } = props

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className={cx(styles.card, CARD_SIZE[props.size])}>
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
    </dialog>
  )
}
