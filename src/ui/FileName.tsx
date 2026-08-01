import styles from '../app.module.css'

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

export function FileName({
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
      title={`${name} — click to change`}
      onClick={() => onReopen()}
    >
      {name}
    </button>
  )
}
