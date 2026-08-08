import { useState } from 'react'

import { ALL_SLIDERS } from './controls'
import { cx } from './cx'
import {
  AUTOMAP_TARGETS,
  DEVICE_PROFILES,
  MOTION,
  presetTarget,
  targetLabel,
} from './midi'
import styles from './MidiSection.module.css'
import { PRESETS } from './presets'
import { Section } from './Section'
import ui from './ui.module.css'

import type { BindingMap, BindTarget, DeviceProfile, LearnState } from './midi'

// Presets that can be dialed in partially. "clean" is the reset — an empty patch
// blendPresets can never mix in — so a knob on its weight would do nothing.
const MIXABLE = PRESETS.filter(p => Object.keys(p.patch).length > 0)

export function MidiSection(props: {
  armed: BindTarget | null
  learn: LearnState | null
  midiBindings: BindingMap
  bpm: number | null
  onAutoMap: (profile: DeviceProfile) => void
  onLearnSequence: () => void
  onStopLearn: () => void
  onArm: (target: BindTarget) => void
  onClearBinding: (target: BindTarget) => void
  onClearAll: () => void
}) {
  const [deviceName, setDeviceName] = useState(DEVICE_PROFILES[0].name)
  const device =
    DEVICE_PROFILES.find(d => d.name === deviceName) ?? DEVICE_PROFILES[0]
  // Which preset the ⚟ beside the picker will bind. A chip is too small to
  // carry the affordance itself, and putting it here keeps the drag gesture on
  // the chip unambiguous — a press there is always a mix, never a bind.
  const [presetName, setPresetName] = useState(MIXABLE[0].name)
  // Walked in a fixed order rather than bind order, so a row doesn't move under
  // the pointer as bindings come and go: the levers a set is played on first —
  // motion, then preset weights in table order — and the controls down the
  // signal path after them.
  const bound: BindTarget[] = [
    MOTION,
    ...MIXABLE.map(p => presetTarget(p.name)),
    ...ALL_SLIDERS.map(s => s.key),
  ].filter(t => props.midiBindings[t] !== undefined)
  const boundControls = ALL_SLIDERS.filter(
    s => props.midiBindings[s.key] !== undefined,
  ).length
  const { learn, armed } = props
  const presetArm = presetTarget(presetName)

  const hint =
    learn !== null
      ? `turn a knob${learn.nextTarget === null ? '' : ` for: ${targetLabel(learn.nextTarget)}`} — ${learn.done}/${learn.total} bound (Esc to stop)`
      : armed === null
        ? 'click ⚟ on any slider, then move a knob to bind.'
        : `learning ${targetLabel(armed)}… move a knob (Esc to cancel)`

  return (
    <Section title="MIDI">
      <div className={learn === null ? ui.hint : ui.amber}>{hint}</div>

      {learn === null ? (
        <>
          <div className={styles.midiRow}>
            <select
              className={ui.select}
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
            >
              {DEVICE_PROFILES.map(d => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
            <button className={ui.btn} onClick={() => props.onAutoMap(device)}>
              auto-map
            </button>
            <button className={ui.btn} onClick={() => props.onLearnSequence()}>
              learn in order
            </button>
          </div>
          <div className={cx(ui.dim, styles.midiNote)}>
            auto-map takes the first{' '}
            {Math.min(device.ccs.length, AUTOMAP_TARGETS.length)} by CC — the
            motion amount, then controls in signal-path order; learn in order
            works on any controller — sweep each knob once, left to right.
            {boundControls < ALL_SLIDERS.length && boundControls > 0
              ? ` ${ALL_SLIDERS.length - boundControls} controls have no knob.`
              : ''}
          </div>

          {/* A preset weight is the widest thing a single knob can drive: one
              chip already moves everything that preset touches, which is what a
              bank of assignable macros was going to be for. */}
          <div className={styles.midiRow}>
            <select
              className={ui.select}
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
            >
              {MIXABLE.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className={cx(ui.btn, armed === presetArm && ui.active)}
              title="put this preset's mix amount on a knob"
              onClick={() => props.onArm(presetArm)}
            >
              {armed === presetArm ? 'learn…' : '⚟ preset mix'}
            </button>
          </div>
        </>
      ) : (
        <button
          className={cx(ui.btn, styles.midiNote)}
          onClick={() => props.onStopLearn()}
        >
          stop learning
        </button>
      )}

      {bound.map(t => {
        const b = props.midiBindings[t]
        return b === undefined ? null : (
          <div key={t} className={styles.midiRow}>
            <span>
              {targetLabel(t)}{' '}
              <span className={ui.blue}>· CC{b.controller}</span>
              {b.channel === 0 ? null : (
                <span className={ui.dim}> ch{b.channel + 1}</span>
              )}
            </span>
            <button
              className={styles.iconX}
              onClick={() => props.onClearBinding(t)}
            >
              ×
            </button>
          </div>
        )
      })}
      {bound.length === 0 ? null : (
        <button
          className={cx(ui.btn, ui.danger)}
          onClick={() => props.onClearAll()}
        >
          clear all bindings
        </button>
      )}
      <div
        className={cx(props.bpm === null ? ui.dim : ui.amber, styles.midiClock)}
      >
        {props.bpm === null
          ? 'clock ♩ — no signal'
          : `clock ♩ = ${props.bpm.toFixed(1)} BPM`}
      </div>
      <div className={ui.dim}>
        ♩ in a rate slider’s ⋮ locks it to the beat — a wipe or a hum bar, and
        any modulation slot’s rate. With no clock on the wire they read the
        tempo at the top of Modulation instead.
      </div>
    </Section>
  )
}
