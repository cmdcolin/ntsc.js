import styles from '../app.module.css'
import { FileName } from './FileName'
import { Meter } from './Meter'
import { SelectRow } from './SelectRow'
import { AUDIO_DESC, AUDIO_MODES } from './useAudio'

import type { AudioMode } from './useAudio'
import type { RefObject } from 'react'

const OPTIONS = AUDIO_MODES.map(m => ({ value: m, label: AUDIO_DESC[m] }))

// Audio in, as a third source alongside A and B: it feeds no picture, it drives
// the oscillators. Its knobs live in the Audio section further down.
export function AudioInput(props: {
  mode: AudioMode
  name: string
  hit: number
  error: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onSelect: (mode: AudioMode) => void
  onFile: (file: File | undefined) => void
}) {
  return (
    <>
      <SelectRow
        tag="♪"
        title="audio in, driving sync and deflection"
        value={props.mode}
        options={OPTIONS}
        onChange={props.onSelect}
      />
      <FileName name={props.name} onReopen={() => props.onSelect('file')} />
      {props.error === null ? null : (
        <div className={styles.hint}>{props.error}</div>
      )}
      {props.mode === 'off' ? (
        <div className={styles.hint}>
          sound knocks sync out of lock — its knobs are in the Audio section
          below.
        </div>
      ) : (
        <Meter level={props.hit} />
      )}
      <input
        ref={props.fileInputRef}
        type="file"
        accept="audio/*,video/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFile(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
    </>
  )
}
