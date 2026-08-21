import { useId } from 'react'

import { cx } from './cx'
import dlg from './dialog.module.css'
import ui from './ui.module.css'
import { useModalDialog } from './useModalDialog'

import type { ReactNode } from 'react'

// Four card widths, named for what goes in them rather than by measurement:
// 'form' is a couple of rows of controls, 'prose' is text to read, and 'paint'
// and 'diagram' are drawings — the two cases where the content has a fixed
// number of cells across and wants every pixel it can have for them, which is
// why they share a width without sharing a name.
const CARD_SIZE = {
  form: '',
  prose: dlg.cardWide,
  paint: dlg.cardPaint,
  diagram: dlg.cardPaint,
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
      className={dlg.modal}
      aria-labelledby={titleId}
      onCancel={() => onClose()}
      onClick={e => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className={cx(dlg.card, CARD_SIZE[props.size])}>
        <div className={dlg.cardRow}>
          <h2 id={titleId} className={dlg.h2}>
            {props.title}
          </h2>
          <button className={cx(ui.btn, ui.btnFlush)} onClick={onClose}>
            close
          </button>
        </div>
        {props.children}
      </div>
    </dialog>
  )
}
