import { cx } from './cx'
import styles from './ToggleButtonGroup.module.css'

// A discrete control: one button per option, index == value. Writes the same
// number a slider would, so MIDI, mod and presets treat it identically.
export function ToggleButtonGroup(props: {
  label: string
  options: string[]
  value: number
  disabled?: boolean
  // Sitting in a control row's track column rather than on a line of its own,
  // where the group's own vertical margin would make the row taller than the
  // sliders it lines up with.
  dense?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div
      className={cx(styles.group, props.dense === true && styles.dense)}
      role="radiogroup"
      aria-label={props.label}
    >
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
