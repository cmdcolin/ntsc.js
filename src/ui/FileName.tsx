import styles from '../app.module.css'

// Caption under a loaded file/URL source. Clicking it re-fires the source
// handler, reopening the file picker (or URL dialog) — the native <select>
// can't re-emit onChange for the already-selected option, so re-picking the
// same source lives here.
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
