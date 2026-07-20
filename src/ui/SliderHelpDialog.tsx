import styles from '../app.module.css'
import { cx } from './cx'

// The "what does this knob actually do" card behind every slider's ? icon.
// Rendered from inside the slider, so it lands in whichever document the panel
// lives in (main window or popout).
export function SliderHelpDialog(props: {
  label: string
  help: string
  min: number
  max: number
  step: number
  defaultValue: number
  unit: string
  onClose: () => void
}) {
  const fmt = (v: number) =>
    `${v.toFixed(props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0)}${props.unit === '' ? '' : ` ${props.unit}`}`
  // Esc closes, like the other dialogs: the close button takes focus on open,
  // so the keypress lands here rather than needing a window-level listener.
  return (
    <div
      className={styles.backdrop}
      onClick={props.onClose}
      onKeyDown={e => {
        if (e.key === 'Escape') props.onClose()
      }}
    >
      <div
        className={cx(styles.card, styles.cardWide)}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.cardRow}>
          <h2 className={styles.h2}>{props.label}</h2>
          <button
            className={styles.btn}
            style={{ margin: 0 }}
            autoFocus
            onClick={props.onClose}
          >
            close
          </button>
        </div>
        <p className={styles.helpText}>{props.help}</p>
        <div className={styles.muted}>
          range {fmt(props.min)} … {fmt(props.max)} · default{' '}
          {fmt(props.defaultValue)}
        </div>
      </div>
    </div>
  )
}
