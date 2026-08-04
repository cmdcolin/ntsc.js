import styles from './AudioInput.module.css'
import { FileName } from './FileName'
import { Meter } from './Meter'
import { SelectRow } from './SelectRow'
import ui from './ui.module.css'
import { AUDIO_DESC, AUDIO_MODES } from './useAudio'

import type { AudioState } from '../signal/audiostate'
import type { AudioMode } from './useAudio'
import type { CSSProperties, ReactNode, RefObject } from 'react'

const OPTIONS = AUDIO_MODES.map(m => ({ value: m, label: AUDIO_DESC[m] }))

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// Transport for a loaded file: drag to seek. The position polls at 10 Hz with
// the meter, so the thumb follows playback without a re-render per frame.
function Scrub(props: {
  time: number
  duration: number
  meter: ReactNode
  onSeek: (time: number) => void
}) {
  const fill: CSSProperties & Record<'--p', string> = {
    '--p': `${((props.time / props.duration) * 100).toFixed(1)}%`,
  }
  return (
    <div className={styles.scrubRow}>
      <input
        type="range"
        className={styles.scrub}
        style={fill}
        min={0}
        max={props.duration}
        step={0.01}
        value={Math.min(props.time, props.duration)}
        onChange={e => props.onSeek(Number(e.target.value))}
      />
      {props.meter}
      <span className={styles.scrubTime}>
        {clock(props.time)} / {clock(props.duration)}
      </span>
    </div>
  )
}

// Audio in, as a third source alongside A and B: it feeds no picture, it drives
// the oscillators. Its knobs live in the Audio section further down, and its
// helper line is AudioHint, parked at the foot of the Input section so the three
// pickers stack unbroken.
export function AudioInput(props: {
  mode: AudioMode
  name: string
  audioState: AudioState | null
  time: number
  duration: number
  fileInputRef: RefObject<HTMLInputElement | null>
  onSelect: (mode: AudioMode) => void
  onFile: (file: File | undefined) => void
  onSeek: (time: number) => void
}) {
  const live = props.mode === 'off' ? null : props.audioState
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
      {props.duration === 0 ? (
        live === null ? null : (
          <Meter audio={live} orient="h" />
        )
      ) : (
        <Scrub
          time={props.time}
          duration={props.duration}
          meter={live === null ? null : <Meter audio={live} orient="v" />}
          onSeek={props.onSeek}
        />
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

// The reason to bother picking an input, and nothing else. It used to carry
// "— its knobs are in the Audio section below" too, which wrapped the line onto
// a second row to point at a section whose own title already says what it is
// for; the fact that sound reaches sync is the part nothing else on screen says.
export function AudioHint(props: { mode: AudioMode; error: string | null }) {
  return props.error !== null ? (
    <div className={ui.hint}>{props.error}</div>
  ) : props.mode === 'off' ? (
    <div className={ui.hint}>sound knocks sync out of lock.</div>
  ) : null
}
