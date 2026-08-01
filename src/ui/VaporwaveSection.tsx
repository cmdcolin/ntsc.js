import styles from '../app.module.css'
import { Meter } from './Meter'
import { Section } from './Section'
import { Slider } from './Slider'
import { cx } from './cx'
import { REVERB_DEFAULT, SPEED_DEFAULT, VAPORWAVE_SPEED } from './urlParams'

import type { AudioState } from '../signal/audiostate'

export function VaporwaveSection(props: {
  videoA: boolean
  videoB: boolean
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
  const speed = (
    label: string,
    value: number,
    onChange: (v: number) => void,
  ) => (
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
  return (
    <Section title="Vaporwave" dot={props.playAudio}>
      <div className={styles.hint}>
        slow the clip down and the pitch drops with it — the screwed sound.
        played out loud it also drives the reactive artifacts.
      </div>
      <button className={styles.btn} onClick={props.onApplyPreset}>
        {VAPORWAVE_SPEED}× vaporwave
      </button>
      {props.videoA ? speed('speed A', props.speedA, props.onSpeedA) : null}
      {props.videoB ? speed('speed B', props.speedB, props.onSpeedB) : null}
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
        className={cx(styles.btn, props.playAudio ? styles.danger : undefined)}
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
