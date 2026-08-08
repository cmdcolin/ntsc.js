import { FileName } from './FileName'
import { Meter } from './Meter'
import { Scrub } from './Scrub'
import { SelectRow } from './SelectRow'
import ui from './ui.module.css'
import { AUDIO_DESC, AUDIO_MODES } from './useAudio'

import type { AudioState } from '../signal/audiostate'
import type { AudioMode } from './useAudio'
import type { RefObject } from 'react'

const OPTIONS = AUDIO_MODES.map(m => ({ value: m, label: AUDIO_DESC[m] }))

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
  // Pulled out rather than read as `props.fileInputRef` at the <input>: a ref
  // read off the props object marks the whole object as ref-ish to the React
  // Compiler, which then refuses every other `props.x` read as a ref access
  // during render and drops this component's memoization entirely.
  const { fileInputRef } = props
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
        ref={fileInputRef}
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
