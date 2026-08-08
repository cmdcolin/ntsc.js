import { FileName } from './FileName'
import { Meter } from './Meter'
import { Scrub } from './Scrub'
import { SelectRow } from './SelectRow'
import { Slider } from './Slider'
import ui from './ui.module.css'
import { REVERB_DEFAULT } from './urlParams'
import { AUDIO_DESC, AUDIO_MODES } from './useAudio'

import type { AudioState } from '../signal/audiostate'
import type { AudioMode } from './useAudio'
import type { RefObject } from 'react'

const OPTIONS = AUDIO_MODES.map(m => ({ value: m, label: AUDIO_DESC[m] }))

// Audio in, as a third source alongside A and B: it feeds no picture, it drives
// the oscillators. Its knobs are the Sound branch on the chain map, under the
// receiver they are patched into, and its helper line is AudioHint, parked at
// the foot of the Input section so the three pickers stack unbroken.
//
// The clip on screen is one of the things it picks: a video's own sound track
// runs through the same analyser a mic or a music file does, so a tape can drive
// the set it is playing on. That used to be a "play audio out loud" button in
// Vaporwave — the routing was the same, but nothing could answer "is sound
// driving the picture" from one place.
export function AudioInput(props: {
  mode: AudioMode
  name: string
  audioState: AudioState | null
  time: number
  duration: number
  // The wet mix on the tail the clips are heard through, shown only while they
  // are the input. Not a general audio control: routeMedia is the only path that
  // reaches the convolver, so a mic or a picked file has no send to trim, and a
  // reverb slider over either would be a knob that does nothing. It lived in
  // Vaporwave, where it was filed under the sound it makes rather than under the
  // thing it processes.
  reverb: number
  onReverb: (v: number) => void
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
      {props.mode === 'video' ? (
        <Slider
          label="reverb"
          unit=""
          min={0}
          max={1}
          step={0.01}
          value={props.reverb}
          defaultValue={REVERB_DEFAULT}
          onChange={props.onReverb}
        />
      ) : null}
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

// The reason to bother picking an input, and nothing else. It used to point at
// where the knobs were as well, which wrapped the line onto a second row to say
// what the map's own Sound box now says by sitting under the receiver; the fact
// that sound reaches sync is the part nothing else on screen says.
//
// The one exception is the picked-but-silent case: 'video' with no clip in
// either slot is an input that will never carry anything, and the picker alone
// cannot say so — it is a live stream or a still that has no sound track, not a
// setting that is wrong.
export function AudioHint(props: {
  mode: AudioMode
  hasClip: boolean
  error: string | null
}) {
  return props.error !== null ? (
    <div className={ui.hint}>{props.error}</div>
  ) : props.mode === 'off' ? (
    <div className={ui.hint}>sound knocks sync out of lock.</div>
  ) : props.mode === 'video' && !props.hasClip ? (
    <div className={ui.hint}>
      no clip on screen — open a video as source A or B and its sound drives the
      picture.
    </div>
  ) : null
}
