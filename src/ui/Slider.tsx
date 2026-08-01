import { useId, useState } from 'react'

import { snapToStep } from './controls'
import { cx } from './cx'
import { formatValue } from './format'
import { zoomAtTravel, zoomTravel } from './lens'
import styles from './Slider.module.css'
import { SliderHelpDialog } from './SliderHelpDialog'
import { ToggleButtonGroup } from './ToggleButtonGroup'

import type { CSSProperties, ReactNode } from 'react'

// The readout's little accessory buttons (help, sync, MIDI, favorite, reset).
function IconButton(props: {
  title: string
  className: string
  onClick: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={props.title}
      className={props.className}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}

export function Slider(props: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  defaultValue: number
  onChange: (v: number) => void
  // A discrete control: one label per integer value. Renders a toggle-button
  // group in place of the range input, still reading/writing the same number.
  choices?: string[]
  curve?: 'magnifier'
  help?: string
  // Present only while the control's prerequisite is unmet: this knob is
  // physically inert until another control opens its path. Clicking the note
  // sets the prerequisite.
  needs?: { hint: string; title: string; onFix: () => void }
  midi?: { label: string | null; armed: boolean; onArm: () => void }
  sync?: { label: string | null; live: boolean; onCycle: () => void }
  favorite?: { on: boolean; onToggle: () => void }
}) {
  const inputId = useId()
  const [showHelp, setShowHelp] = useState(false)
  // Hovering the ? shows the text in place, so the help column can be skimmed
  // slider to slider; clicking still opens the dialog (range info, touch).
  const [hoverHelp, setHoverHelp] = useState(false)
  const midi = props.midi
  const sync = props.sync
  const needs = props.needs
  const help = props.help
  const favorite = props.favorite
  const choices = props.choices
  // Live clock first: it narrows away the undefined case, so the division check
  // isn't comparing `null` against a value that may not exist.
  const locked = sync?.live === true && sync.label !== null
  // A curved control puts the range input on a 0..1 travel and converts, so the
  // fine end of the scale gets the room. The value it reads and writes is
  // unchanged, still landing on the control's own step grid.
  const curved = props.curve === 'magnifier'
  const fromTravel = (t: number) => snapToStep(props, zoomAtTravel(t))
  // Track fill anchors at the default, not the left edge: bipolar controls
  // read like a pan pot from center, and distance-from-stock shows at a glance.
  const pct = (v: number) =>
    Math.max(
      0,
      Math.min(
        100,
        (curved ? zoomTravel(v) : (v - props.min) / (props.max - props.min)) *
          100,
      ),
    )
  const valuePct = pct(props.value)
  const defPct = pct(props.defaultValue)
  const fill: CSSProperties & Record<'--lo' | '--hi' | '--def', string> = {
    '--lo': `${Math.min(valuePct, defPct)}%`,
    '--hi': `${Math.max(valuePct, defPct)}%`,
    '--def': `${defPct}%`,
  }
  return (
    <div className={styles.slider}>
      {/* The label names the input beside it rather than wrapping it: with the
          accessory buttons inside a wrapping <label>, every one of their clicks
          forwarded to the range input and nudged the value, so each button (and
          each toggle option) had to preventDefault to stay harmless. */}
      <div>
        <span className={styles.sliderTop}>
          <span>
            {choices ? (
              props.label
            ) : (
              <label htmlFor={inputId}>{props.label}</label>
            )}
            {help === undefined ? null : (
              <IconButton
                title="what does this do?"
                className={styles.what}
                onClick={() => setShowHelp(true)}
                onMouseEnter={() => setHoverHelp(true)}
                onMouseLeave={() => setHoverHelp(false)}
              >
                ?
              </IconButton>
            )}
          </span>
          <span className={styles.value}>
            {choices
              ? (choices[props.value] ?? props.value)
              : `${formatValue(props.value, props.step)}${props.unit}`}
            {sync ? (
              <IconButton
                title={
                  sync.label === null
                    ? 'lock to MIDI clock'
                    : `clock-synced (${sync.label}) — click to change`
                }
                className={cx(
                  styles.icon,
                  sync.label !== null &&
                    (sync.live ? styles.iconOn : styles.iconSyncSet),
                )}
                onClick={sync.onCycle}
              >
                {sync.label === null ? '♩' : `♩${sync.label}`}
              </IconButton>
            ) : null}
            {midi ? (
              <IconButton
                title={
                  midi.label === null
                    ? 'assign a MIDI control'
                    : `MIDI CC${midi.label} — click to relearn`
                }
                className={cx(
                  styles.icon,
                  midi.armed
                    ? styles.iconOn
                    : midi.label !== null && styles.iconMidiSet,
                )}
                onClick={midi.onArm}
              >
                {midi.armed
                  ? 'learn…'
                  : midi.label === null
                    ? '⚟'
                    : `CC${midi.label}`}
              </IconButton>
            ) : null}
            {favorite ? (
              <IconButton
                title={
                  favorite.on ? 'remove from Favorites' : 'pin to Favorites'
                }
                className={cx(styles.icon, favorite.on && styles.iconOn)}
                onClick={favorite.onToggle}
              >
                {favorite.on ? '★' : '☆'}
              </IconButton>
            ) : null}
            <IconButton
              title="reset"
              className={cx(
                styles.reset,
                props.value === props.defaultValue && styles.resetDef,
              )}
              onClick={() => props.onChange(props.defaultValue)}
            >
              ↺
            </IconButton>
          </span>
        </span>
        {choices ? (
          <ToggleButtonGroup
            label={props.label}
            options={choices}
            value={props.value}
            disabled={locked}
            onChange={props.onChange}
          />
        ) : (
          <input
            id={inputId}
            type="range"
            className={cx(styles.range, needs && styles.rangeInert)}
            style={fill}
            min={curved ? 0 : props.min}
            max={curved ? 1 : props.max}
            step={curved ? 0.002 : props.step}
            value={curved ? zoomTravel(props.value) : props.value}
            disabled={locked}
            onChange={e =>
              props.onChange(
                curved
                  ? fromTravel(Number(e.target.value))
                  : Number(e.target.value),
              )
            }
          />
        )}
      </div>
      {needs ? (
        <button
          type="button"
          className={styles.needs}
          title={needs.title}
          onClick={needs.onFix}
        >
          inert — needs {needs.hint} · click to set
        </button>
      ) : null}
      {hoverHelp && !showHelp && help !== undefined ? (
        <div className={styles.helpPop}>{help}</div>
      ) : null}
      {showHelp && help !== undefined ? (
        <SliderHelpDialog
          label={props.label}
          help={help}
          min={props.min}
          max={props.max}
          step={props.step}
          defaultValue={props.defaultValue}
          unit={props.unit}
          onClose={() => setShowHelp(false)}
        />
      ) : null}
    </div>
  )
}
