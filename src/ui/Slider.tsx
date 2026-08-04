import { useId, useState } from 'react'

import { snapToStep } from './controls'
import { cx } from './cx'
import { formatValue } from './format'
import { zoomAtTravel, zoomTravel } from './lens'
import { MenuItem, Popover } from './Popover'
import popoverStyles from './Popover.module.css'
import styles from './Slider.module.css'
import { SliderHelpDialog } from './SliderHelpDialog'
import { ToggleButtonGroup } from './ToggleButtonGroup'

import type { CSSProperties, ReactNode } from 'react'

// The readout's little accessory buttons (help, and the ∿ on a routed row).
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

// The set-up a row can carry, behind one ⋮.
//
// These used to sit in the open at the end of every row — ∿ ☆ ↺, plus ⚟ and ♩
// once MIDI was on. Five affordances the median session presses zero times,
// rendered 121 times over, and they were not free: the readout column reserved
// 5.2rem to hold them, which is a quarter of the panel's width taken from the
// column that actually needed it, so labels with a parenthetical wrapped to two
// lines to pay for buttons nobody was reaching for.
//
// Reset is deliberately *not* here. It is the one row action a session actually
// reaches for — you push a knob to hear what it does and then want it back —
// and it needs no width of its own, because the reading is already rendered,
// already in its own column, and already the thing that says the row has moved.
// So the number is the reset (see `readout` below) and the menu keeps only the
// wiring: what a row is set to stays in the open beside the reading as a badge,
// and changing that is what can wait for a click.
function RowMenu(props: {
  label: string
  favorite?: { on: boolean; onToggle: () => void }
  mod?: { routed: boolean; open: boolean; onToggle: () => void }
  midi?: { label: string | null; armed: boolean; onArm: () => void }
  sync?: { label: string | null; live: boolean; onCycle: () => void }
}) {
  const { favorite, mod, midi, sync } = props
  // The rows are built on first open and not before. A menu is five MenuItems
  // whether or not anyone looks at it, and on the bench every stage is mounted
  // at once — 72 rows measured, so eagerly building all of them put ~700 extra
  // elements through every render a slider drag causes, for markup nobody was
  // looking at. The trigger is ours, so the flag rides its own click: React
  // flushes a discrete event before paint, so the browser's own popover-open
  // still finds the rows there.
  const [opened, setOpened] = useState(false)
  return (
    <Popover
      trigger={attrs => (
        <button
          type="button"
          className={styles.rowMenu}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          title={`more for “${props.label}”`}
          aria-label={`more for ${props.label}`}
          onClick={() => setOpened(true)}
        >
          ⋮
        </button>
      )}
    >
      {id => (
        <>
          {!opened ? null : (
            <>
              {favorite === undefined ? null : (
                <MenuItem
                  icon={favorite.on ? '★' : '☆'}
                  label={
                    favorite.on ? 'remove from Favorites' : 'pin to Favorites'
                  }
                  hint=""
                  closes={id}
                  onClick={favorite.onToggle}
                />
              )}
              {/* Only between two populated halves: with reset gone from the
                  menu the first half is the pin alone, and a row that offers no
                  pin (there is none) or no wiring would otherwise open on a
                  rule with nothing above or below it. */}
              {favorite === undefined ||
              (mod === undefined &&
                midi === undefined &&
                sync === undefined) ? null : (
                <div className={popoverStyles.menuSep} />
              )}
              {mod === undefined ? null : (
                <MenuItem
                  icon="∿"
                  label={
                    mod.routed
                      ? 'change what is driving it'
                      : 'wobble it with an LFO'
                  }
                  hint={mod.routed ? 'on' : ''}
                  closes={id}
                  onClick={mod.onToggle}
                />
              )}
              {midi === undefined ? null : (
                <MenuItem
                  icon="⚟"
                  label={
                    midi.armed
                      ? 'listening — click to cancel'
                      : midi.label === null
                        ? 'assign a MIDI control'
                        : 'relearn this MIDI control'
                  }
                  hint={midi.label === null ? '' : `CC${midi.label}`}
                  closes={id}
                  onClick={midi.onArm}
                />
              )}
              {sync === undefined ? null : (
                <MenuItem
                  icon="♩"
                  label={
                    sync.label === null
                      ? 'lock to MIDI clock'
                      : 'change the clock division'
                  }
                  hint={sync.label ?? ''}
                  closes={id}
                  onClick={sync.onCycle}
                />
              )}
            </>
          )}
        </>
      )}
    </Popover>
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
  midi?: {
    label: string | null
    armed: boolean
    // Set while a bound knob hasn't caught this value: where the knob is
    // sitting, in control units.
    pickup?: number
    onArm: () => void
  }
  sync?: { label: string | null; live: boolean; onCycle: () => void }
  favorite?: { on: boolean; onToggle: () => void }
  // Whether something is driving this control, and the way in to change it.
  // The lever is marked, never the value: the readout keeps showing where the
  // slider rests, because that is what presets, links and scenes store, and
  // because a number that moves every frame is unreadable anyway.
  mod?: { routed: boolean; open: boolean; onToggle: () => void }
  // The editor itself, rendered by the caller under the row.
  modEditor?: ReactNode
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
  // The row's three parts, built once and then arranged two ways below. The
  // label names the input beside it rather than wrapping it: with the accessory
  // buttons inside a wrapping <label>, every one of their clicks forwarded to
  // the range input and nudged the value, so each button (and each toggle
  // option) had to preventDefault to stay harmless.
  // A button is an atomic inline, so the line may break between the label and
  // its ? — and on a wrapping label it reliably did, leaving the ? alone on a
  // line under "phosphor persistence". The last word rides in a nowrap span
  // with the button, so the break lands one word earlier instead. Two <label>s
  // for one input is deliberate: the accessible name is their concatenation, so
  // the split is invisible to a screen reader, and keeping the ? outside both
  // is what stops its clicks reaching the range input.
  const cut = props.label.lastIndexOf(' ')
  const head = cut < 0 ? '' : props.label.slice(0, cut + 1)
  const tail = cut < 0 ? props.label : props.label.slice(cut + 1)
  const naming = (
    <span className={styles.naming}>
      {choices ? head : <label htmlFor={inputId}>{head}</label>}
      <span className={styles.tail}>
        {choices ? tail : <label htmlFor={inputId}>{tail}</label>}
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
    </span>
  )
  const reading = (v: number) =>
    choices
      ? (choices[v] ?? String(v))
      : `${formatValue(v, props.step)}${props.unit}`
  // What is wired to this row, marked beside the reading. Only ever what is
  // *set*: an unset affordance has nothing to say and its slot is the width the
  // label wanted. All of them are marks rather than buttons — the menu is the
  // one way to change any of this — except the two that are live states you
  // have to be able to get out of from the row you are looking at: a routed ∿
  // opens and closes its editor, and an armed ⚟ cancels the learn.
  const badges = (
    <>
      {sync?.label == null ? null : (
        <span
          className={cx(
            styles.badge,
            sync.live ? styles.iconOn : styles.iconSyncSet,
          )}
          title={`clock-synced (${sync.label})${sync.live ? '' : ' — no clock running'}`}
        >
          ♩{sync.label}
        </span>
      )}
      {midi === undefined ? null : midi.armed ? (
        <IconButton
          title="listening for a knob — click to cancel"
          className={cx(styles.badge, styles.iconOn)}
          onClick={midi.onArm}
        >
          learn…
        </IconButton>
      ) : midi.label === null ? null : (
        <span
          className={cx(styles.badge, styles.iconMidiSet)}
          title={`MIDI CC${midi.label}`}
        >
          CC{midi.label}
        </span>
      )}
      {props.mod?.routed !== true ? null : (
        <IconButton
          title={
            props.mod.open
              ? 'close what is driving it'
              : 'modulated — click to see what is driving it'
          }
          className={cx(
            styles.badge,
            props.mod.open ? styles.iconOn : styles.iconModSet,
          )}
          onClick={props.mod.onToggle}
        >
          ∿
        </IconButton>
      )}
      {favorite?.on !== true ? null : (
        <span
          className={cx(styles.badge, styles.iconOn)}
          title="pinned to Favorites"
        >
          ★
        </span>
      )}
    </>
  )
  // The reading, and — the moment the row is off stock — the way back.
  //
  // Reset costs nothing to put in the open here because nothing new is drawn:
  // the number is already rendered, already in a column of its own, and it is
  // already the part of the row that knows it has been moved. Off stock it
  // turns amber (the panel's one colour for that, the same one the section dot
  // and a stage's `• N` wear, so a row now reports its own state instead of
  // being read against the track's tick) and takes the ↺ beside it. At stock it
  // is a plain span again — there is nothing to put back, and 121 permanent ↺s
  // are exactly the reserve the last pass took out of this column.
  const atStock = props.value === props.defaultValue
  const readout = (
    <span className={styles.value}>
      {atStock ? (
        reading(props.value)
      ) : (
        <button
          type="button"
          className={styles.revert}
          title={`off stock — click to put it back to ${reading(props.defaultValue)} (or double-click the track)`}
          aria-label={`reset ${props.label} to ${reading(props.defaultValue)}`}
          onClick={() => props.onChange(props.defaultValue)}
        >
          {reading(props.value)}
          <span className={styles.revertMark}>↺</span>
        </button>
      )}
      {badges}
      <RowMenu
        label={props.label}
        favorite={favorite}
        mod={props.mod}
        midi={midi}
        sync={sync}
      />
    </span>
  )
  const track = choices ? (
    <ToggleButtonGroup
      label={props.label}
      options={choices}
      value={props.value}
      disabled={locked}
      onChange={props.onChange}
    />
  ) : (
    <span className={styles.rangeWrap}>
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
        // The plugin idiom, for free: the track is the biggest target on the
        // row and a double-click on it means "put this back" everywhere else a
        // fader lives. It carries no tooltip of its own — one on the track
        // would follow the pointer across every drag — so the reading's own
        // tooltip is where it is written down.
        onDoubleClick={() => props.onChange(props.defaultValue)}
        onChange={e =>
          props.onChange(
            curved
              ? fromTravel(Number(e.target.value))
              : Number(e.target.value),
          )
        }
      />
      {/* Soft takeover: the knob is here, the value is at the thumb, and
          nothing moves until one sweeps past the other. Without the mark
          the control just looks dead. */}
      {midi?.pickup === undefined ? null : (
        <span
          className={styles.pickup}
          style={{ left: `${pct(midi.pickup)}%` }}
          title="the knob is here — sweep it across the value to take over"
        />
      )}
    </span>
  )

  return (
    <div className={styles.slider}>
      {/* One line for a plain slider — name, track, readout — and two for a
          mode switch, whose options are words ("alternate", "ssavi") and cannot
          be squeezed into a third of a sidebar.

          The readout gets a column of its own rather than riding the label's
          line, which is what a first attempt did: at a third of the panel each
          the two of them together overflowed on any label carrying a
          parenthetical, and a fifth of the controls carry one — the label broke
          mid-phrase and the ? and ↺ scattered onto a line of their own. Split
          out, only the label wraps, and it wraps where a label should. */}
      {choices ? (
        <div className={styles.rowStack}>
          <span className={styles.sliderTop}>
            {naming}
            {readout}
          </span>
          {track}
        </div>
      ) : (
        <div className={styles.row}>
          {naming}
          {track}
          {readout}
        </div>
      )}
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
      {props.modEditor}
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
