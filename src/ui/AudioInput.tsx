import { FileName } from './FileName'
import { MenuRow } from './MenuRow'
import { Meter } from './Meter'
import { Scrub } from './Scrub'
import { Slider } from './Slider'
import ui from './ui.module.css'
import { DRY_DEFAULT, REVERB_DEFAULT } from './urlParams'
import { AUDIO_DESC, AUDIO_MODES } from './useAudio'

import type { AudioState } from '../core/signal/audiostate'
import type { AudioMode } from './useAudio'

const OPTIONS = AUDIO_MODES.map(m => ({ value: m, label: AUDIO_DESC[m] }))

// Audio in, as a third source alongside A and B: it feeds no picture, it drives
// the oscillators. It heads the Sound branch on the chain map, above the knobs
// it is patched into — the same arrangement A and B's pickers have at the head
// of their own stages — and its helper line is AudioHint, under it.
//
// Its hidden <input type=file> is *not* here. `useAudio` fires that ref with
// `.click()` the moment 'file' is picked, and this component unmounts whenever
// the Sound stage is folded, which would leave the ref null and the pick doing
// nothing. The app mounts it outside the panel (SourceSlot.tsx's
// HiddenFilePicker), where A's and B's already were.
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
  // How much tail is added to the clips, shown only while they are the input.
  // A send: the dry stays where it was and this only ever adds, so winding it up
  // does not trade the track away for the room. Not a general audio control:
  // routeMedia is the only path that reaches the convolver, so a mic or a picked
  // file has no send to trim, and a reverb slider over either would be a knob
  // that does nothing. It lived in Vaporwave, where it was filed under the sound
  // it makes rather than under the thing it processes.
  reverb: number
  onReverb: (v: number) => void
  // How much of the clip itself is heard in front of that tail. The pair is a
  // send and a fader, not one crossfade: reverb alone adds a room to a clip that
  // stays where it is, and this is the separate decision to stand further back
  // from it. Only the speakers are downstream — the analyser that drives sync
  // and deflection is tapped ahead of the fader.
  dry: number
  onDry: (v: number) => void
  onSelect: (mode: AudioMode) => void
  onSeek: (time: number) => void
}) {
  const live = props.mode === 'off' ? null : props.audioState
  return (
    <>
      <MenuRow
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
        <>
          <Slider
            label="dry"
            unit=""
            min={0}
            max={1}
            step={0.01}
            value={props.dry}
            defaultValue={DRY_DEFAULT}
            onChange={props.onDry}
          />
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
        </>
      ) : null}
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
