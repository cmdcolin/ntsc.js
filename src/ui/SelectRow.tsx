import styles from './SelectRow.module.css'
import ui from './ui.module.css'

// A leading tag glyph plus a full-width dropdown — the panel's picker row for a
// list of plain values. Generic over the option values so callers get their own
// key type back instead of a bare string to re-validate.
//
// **The source pickers are not this**, and the split is the point rather than an
// accident of history: a `<select>` cannot re-emit `change` for the option
// already chosen, and half of what a source picker offers is a door rather than
// a value — File…, Clips…, Browse…, the archives — where re-picking is the
// ordinary gesture. Those rows are MenuRow, which fires on every pick. What is
// left here is the settings lists (the signal tap, the MIDI ports, a look's
// slot), where every option is a value and picking the one already picked means
// nothing, so the native widget is the better one: the OS draws it, a phone
// gives it a wheel, and it costs this file nine lines.
export function SelectRow<T extends string>(props: {
  tag: string
  title: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className={styles.inputRow}>
      <span className={styles.tag} title={props.title}>
        {props.tag}
      </span>
      <select
        className={ui.select}
        value={props.value}
        onChange={e => {
          const picked = props.options.find(o => o.value === e.target.value)
          if (picked !== undefined) props.onChange(picked.value)
        }}
      >
        {props.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
