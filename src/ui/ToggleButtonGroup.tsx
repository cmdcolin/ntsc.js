import styles from './ToggleButtonGroup.module.css'
import { cx } from './cx'

// A discrete control: one button per option, index == value. Writes the same
// number a slider would, so MIDI, mod and presets treat it identically.
export function ToggleButtonGroup(props: {
  label: string
  options: string[]
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={props.label}>
      {props.options.map((opt, i) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={props.value === i}
          className={cx(styles.button, props.value === i && styles.on)}
          disabled={props.disabled}
          onClick={() => props.onChange(i)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
