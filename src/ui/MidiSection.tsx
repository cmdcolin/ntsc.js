import { useState } from 'react'

import { ALL_SLIDERS } from './controls'
import { cx } from './cx'
import {
  ACTIONS,
  AUTOMAP_TARGETS,
  DEVICE_PROFILES,
  MOTION,
  actionLabel,
  parseAction,
  presetTarget,
  targetLabel,
} from './midi'
import styles from './MidiSection.module.css'
import { PRESETS, presetLabel } from './presets'
import { Section } from './Section'
import ui from './ui.module.css'

import type {
  ActionTarget,
  BindingMap,
  BindTarget,
  DeviceProfile,
  LearnState,
  NoteMap,
} from './midi'

// Presets that can be dialed in partially. "clean" is the reset — an empty patch
// blendPresets can never mix in — so a knob on its weight would do nothing.
const MIXABLE = PRESETS.filter(p => Object.keys(p.patch).length > 0)

export function MidiSection(props: {
  armed: BindTarget | null
  armedNote: ActionTarget | null
  learn: LearnState | null
  midiBindings: BindingMap
  midiNotes: NoteMap
  bpm: number | null
  onAutoMap: (profile: DeviceProfile) => void
  onLearnSequence: () => void
  onStopLearn: () => void
  onArm: (target: BindTarget) => void
  onArmNote: (target: ActionTarget) => void
  onClearBinding: (target: BindTarget) => void
  onClearNote: (target: ActionTarget) => void
  onClearAll: () => void
}) {
  const [deviceName, setDeviceName] = useState(DEVICE_PROFILES[0].name)
  const device =
    DEVICE_PROFILES.find(d => d.name === deviceName) ?? DEVICE_PROFILES[0]
  // Which preset the ⚟ beside the picker will bind. A chip is too small to
  // carry the affordance itself, and putting it here keeps the drag gesture on
  // the chip unambiguous — a press there is always a mix, never a bind.
  const [presetName, setPresetName] = useState(MIXABLE[0].name)
  // Which verb the ⚟ beside the second picker will put on a pad. Same
  // arrangement as the preset picker above it, and for a stronger reason: the
  // buttons these stand in for are scattered across the bay and two stage heads,
  // and several of them are not on screen at all until something is patched.
  const [action, setAction] = useState<ActionTarget>(ACTIONS[0].target)
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
  const { learn, armed, armedNote } = props
  const presetArm = presetTarget(presetName)
  // Walked in the table's order, so pads sit in the order they were offered
  // rather than in the order they were bound.
  const boundActions = ACTIONS.filter(
    a => props.midiNotes[a.target] !== undefined,
  )

  const hint =
    learn !== null
      ? `turn a knob${learn.nextTarget === null ? '' : ` for: ${targetLabel(learn.nextTarget)}`} — ${learn.done}/${learn.total} bound (Esc to stop)`
      : armedNote !== null
        ? `learning ${actionLabel(armedNote)}… strike a pad or a key (Esc to cancel)`
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
                  {presetLabel(p)}
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

          {/* The other family: a pad, not a knob. Everything above is a value
              you hold, and each of these is an edge you cause — which is why
              they are bound here rather than by a ⚟ on the button that fires
              them, and why nothing about takeover applies. */}
          <div className={styles.midiRow}>
            <select
              className={ui.select}
              value={action}
              // Back through the parser rather than asserted: the same
              // narrowing a stored key gets, so the one place a loose string
              // becomes an ActionTarget is the one place that range-checks it.
              onChange={e =>
                setAction(parseAction(e.target.value) ?? ACTIONS[0].target)
              }
            >
              {ACTIONS.map(a => (
                <option key={a.target} value={a.target}>
                  {a.label}
                </option>
              ))}
            </select>
            <button
              className={cx(ui.btn, armedNote === action && ui.active)}
              title="put this gesture on a pad or a key"
              onClick={() => props.onArmNote(action)}
            >
              {armedNote === action ? 'learn…' : '⚟ pad'}
            </button>
          </div>
          <div className={cx(ui.dim, styles.midiNote)}>
            {boundActions.length === 0
              ? 'with no pad bound, any note fires the whole bay. Bind one and notes become deliberate — only what is listed below fires.'
              : 'notes fire only what is bound below; everything else is ignored.'}
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
      {boundActions.map(a => {
        const b = props.midiNotes[a.target]
        return b === undefined ? null : (
          <div key={a.target} className={styles.midiRow}>
            <span>
              {a.label} <span className={ui.blue}>· note {b.note}</span>
              {b.channel === 0 ? null : (
                <span className={ui.dim}> ch{b.channel + 1}</span>
              )}
            </span>
            <button
              className={styles.iconX}
              onClick={() => props.onClearNote(a.target)}
            >
              ×
            </button>
          </div>
        )
      })}
      {bound.length === 0 && boundActions.length === 0 ? null : (
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
