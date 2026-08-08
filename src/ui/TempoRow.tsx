import { useState } from 'react'

import styles from './TempoRow.module.css'

import type { Tempo } from './useTempo'

// The beat the panel's ♩ locks read, and the two ways to give it one by hand.
//
// It only appears as an input at all when nothing is sending MIDI clock: a
// clock is the better tempo whenever there is one — it stays in step with what
// is making the sound, and a field you could edit under it would be a control
// with no effect. So the clock's own reading takes the row while it is running,
// and the hand-set number waits underneath for it to stop.
export function TempoRow(props: { tempo: Tempo }) {
  const { bpm, clockBpm, manual, setManual, tap } = props.tempo
  // What is in the box while it is being typed in, which is not the tempo: a
  // field that clamped every keystroke into the live tempo could never be typed
  // "128" into, because "1" is 20 BPM and "12" is 20 BPM again and the box would
  // have rewritten itself twice before the 8 arrived. Null means "not being
  // edited", and then the box shows the tempo.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft.trim() !== '') setManual(Number(draft))
    setDraft(null)
  }

  if (clockBpm !== null) {
    return (
      <div className={styles.row}>
        <span className={styles.tag} title="the beat everything ♩ reads">
          ♩
        </span>
        <span className={styles.fromClock}>{clockBpm.toFixed(1)} BPM</span>
        <span className={styles.note}>from MIDI clock</span>
      </div>
    )
  }

  return (
    <div className={styles.row}>
      <span className={styles.tag} title="the beat everything ♩ reads">
        ♩
      </span>
      <input
        className={styles.bpm}
        type="text"
        inputMode="decimal"
        value={draft ?? (manual === null ? '' : String(manual))}
        placeholder="120"
        aria-label="tempo in BPM"
        title="the beat a ♩-locked rate runs against — MIDI clock takes over this number whenever one is running"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          // Leaves the box as it was found rather than committing a half-typed
          // number, which is what Escape means everywhere else in the panel.
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      <span className={styles.unit}>BPM</span>
      <button
        className={styles.tap}
        title="tap it in — four taps on the beat is enough"
        onClick={() => {
          // Whatever was half-typed loses to the taps; the box is about to
          // show what they said.
          setDraft(null)
          tap()
        }}
      >
        tap
      </button>
      {bpm === null ? (
        <span className={styles.note}>type or tap a tempo</span>
      ) : null}
    </div>
  )
}
