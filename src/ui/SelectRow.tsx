import styles from './SelectRow.module.css'
import ui from './ui.module.css'

// Hoisted out of SelectRow so the banded and unbanded branches below render the
// same option, rather than each spelling out a three-line <option>.
const Option = (props: { value: string; label: string }) => (
  <option value={props.value}>{props.label}</option>
)

// A leading tag glyph plus a full-width dropdown — the panel's standard picker
// row. Generic over the option values so callers get their own key type back
// instead of a bare string to re-validate.
export function SelectRow<T extends string>(props: {
  tag: string
  title: string
  value: T
  // A `group` on an option puts it under that heading, and every option after it
  // carrying the same one joins it. So a banded list is expressed by ordering the
  // array — the same way the options' own order is already the display order —
  // and a caller with nothing to band passes no `group` and gets the flat list it
  // always got. Nothing but the source pickers bands anything today.
  options: readonly { value: T; label: string; group?: string | null }[]
  onChange: (value: T) => void
}) {
  // Consecutive runs of one heading. Built rather than grouped by key so an
  // option can never be lifted out of the order the caller chose.
  const bands: { group: string | null; options: typeof props.options }[] = []
  for (const o of props.options) {
    const group = o.group ?? null
    const last = bands.at(-1)
    if (last !== undefined && last.group === group)
      last.options = [...last.options, o]
    else bands.push({ group, options: [o] })
  }
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
        {bands.map(band =>
          band.group === null ? (
            band.options.map(o => <Option key={o.value} {...o} />)
          ) : (
            <optgroup key={band.group} label={band.group}>
              {band.options.map(o => (
                <Option key={o.value} {...o} />
              ))}
            </optgroup>
          ),
        )}
      </select>
    </div>
  )
}
