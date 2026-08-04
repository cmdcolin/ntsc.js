import { cx } from './cx'
import { Meter } from './Meter'
import { Section } from './Section'
import { Slider } from './Slider'
import ui from './ui.module.css'
import { REVERB_DEFAULT, SPEED_DEFAULT, VAPORWAVE_SPEED } from './urlParams'

import type { AudioState } from '../signal/audiostate'
import type { SlotKind } from './videoSlot'

const speed = (label: string, value: number, onChange: (v: number) => void) => (
  <Slider
    label={label}
    unit="×"
    min={0.25}
    max={1.5}
    step={0.01}
    value={value}
    defaultValue={SPEED_DEFAULT}
    onChange={onChange}
  />
)

export function VaporwaveSection(props: {
  videoA: SlotKind
  videoB: SlotKind
  speedA: number
  speedB: number
  reverb: number
  playAudio: boolean
  // The live analyser the meter reads the routed audio's onsets off.
  audioState: AudioState | null
  onSpeedA: (v: number) => void
  onSpeedB: (v: number) => void
  onReverb: (v: number) => void
  onTogglePlayAudio: () => void
  onApplyPreset: () => void
}) {
  return (
    <Section title="Vaporwave" dot={props.playAudio}>
      <div className={ui.hint}>
        slow the clip down and the pitch drops with it — the screwed sound.
        played out loud it also drives the reactive artifacts.
      </div>
      <button className={ui.btn} onClick={props.onApplyPreset}>
        {VAPORWAVE_SPEED}× vaporwave
      </button>
      {/* Per slot, because one may be a clip while the other is a live stream:
          an element backed by a MediaStream ignores playbackRate, so a speed
          slider over one would be a lie the moment it moved. */}
      {props.videoA === 'clip'
        ? speed('speed A', props.speedA, props.onSpeedA)
        : null}
      {props.videoB === 'clip'
        ? speed('speed B', props.speedB, props.onSpeedB)
        : null}
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
      <button
        className={cx(ui.btn, props.playAudio ? ui.danger : undefined)}
        onClick={props.onTogglePlayAudio}
      >
        {props.playAudio ? 'mute audio' : 'play audio out loud'}
      </button>
      {props.playAudio && props.audioState !== null ? (
        <Meter audio={props.audioState} orient="h" />
      ) : null}
    </Section>
  )
}
