import { useState } from 'react'

import styles from '../app.module.css'
import { Section } from './Section'
import { ALL_SLIDERS, sliderFor } from './controls'
import { cx } from './cx'
import { DEVICE_PROFILES } from './midi'

import type { ControlKey } from '../controls'
import type { BindingMap, DeviceProfile, LearnState } from './midi'

export function MidiSection(props: {
  armedKey: ControlKey | null
  learn: LearnState | null
  midiBindings: BindingMap
  bpm: number | null
  onAutoMap: (profile: DeviceProfile) => void
  onLearnSequence: () => void
  onStopLearn: () => void
  onClearBinding: (key: ControlKey) => void
  onClearAll: () => void
}) {
  const [deviceName, setDeviceName] = useState(DEVICE_PROFILES[0].name)
  const device =
    DEVICE_PROFILES.find(d => d.name === deviceName) ?? DEVICE_PROFILES[0]
  // Walked in signal-path order rather than bind order, so a row doesn't move
  // under the pointer as bindings come and go.
  const bound = ALL_SLIDERS.filter(s => props.midiBindings[s.key] !== undefined)
  const { learn, armedKey } = props

  const hint =
    learn !== null
      ? `turn a knob${learn.nextKey === null ? '' : ` for: ${sliderFor(learn.nextKey).label}`} — ${learn.done}/${learn.total} bound (Esc to stop)`
      : armedKey === null
        ? 'click ⚟ on any slider, then move a knob to bind.'
        : `learning ${sliderFor(armedKey).label}… move a knob (Esc to cancel)`

  return (
    <Section title="MIDI">
      <div className={learn === null ? styles.hint : styles.amber}>{hint}</div>

      {learn === null ? (
        <>
          <div className={styles.midiRow}>
            <select
              className={styles.select}
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
            >
              {DEVICE_PROFILES.map(d => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              className={styles.btn}
              onClick={() => props.onAutoMap(device)}
            >
              auto-map
            </button>
            <button
              className={styles.btn}
              onClick={() => props.onLearnSequence()}
            >
              learn in order
            </button>
          </div>
          <div className={cx(styles.dim, styles.midiNote)}>
            auto-map takes the first{' '}
            {Math.min(device.ccs.length, ALL_SLIDERS.length)} controls by CC;
            learn in order works on any controller — sweep each knob once, left
            to right.
            {bound.length < ALL_SLIDERS.length && bound.length > 0
              ? ` ${ALL_SLIDERS.length - bound.length} controls have no knob.`
              : ''}
          </div>
        </>
      ) : (
        <button
          className={cx(styles.btn, styles.midiNote)}
          onClick={() => props.onStopLearn()}
        >
          stop learning
        </button>
      )}

      {bound.map(s => {
        const b = props.midiBindings[s.key]
        return b === undefined ? null : (
          <div key={s.key} className={styles.midiRow}>
            <span>
              {s.label} <span className={styles.blue}>· CC{b.controller}</span>
              {b.channel === 0 ? null : (
                <span className={styles.dim}> ch{b.channel + 1}</span>
              )}
            </span>
            <button
              className={styles.iconX}
              onClick={() => props.onClearBinding(s.key)}
            >
              ×
            </button>
          </div>
        )
      })}
      {bound.length === 0 ? null : (
        <button
          className={cx(styles.btn, styles.danger)}
          onClick={() => props.onClearAll()}
        >
          clear all bindings
        </button>
      )}
      <div
        className={cx(
          props.bpm === null ? styles.dim : styles.amber,
          styles.midiClock,
        )}
      >
        {props.bpm === null
          ? 'clock ♩ — no signal'
          : `clock ♩ = ${props.bpm.toFixed(1)} BPM`}
      </div>
      <div className={styles.dim}>
        click ♩ on a rate slider to lock it to the beat.
      </div>
    </Section>
  )
}
