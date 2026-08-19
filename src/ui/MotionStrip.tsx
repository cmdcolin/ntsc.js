import { sliderFor } from './controls'
import { useControlsApi } from './ControlsContext'
import { cx } from './cx'
import { MOTION } from './midi'
import { gateFlips } from './modSlots'
import { useModSlotsApi } from './ModSlotsContext'
import styles from './MotionStrip.module.css'
import { useHold } from './useHold'

// One scale over everything that is moving, plus a freeze.
//
// This is the slot a bank of assignable macros was going to fill, and it earns
// it better: a macro is only worth a knob once it drives several controls at
// once, which is exactly when it costs the most slots to set up — four clicks
// and a slot per control, out of eight. The motion amount needs no assignment
// at all. It is meaningful the moment anything is patched, it is the one
// gesture that scales a whole patch, and freeze holds every wave's phase rather
// than resetting it, so letting go picks the drift back up mid-stride instead
// of snapping everything to the top of its cycle.
//
// Shown only once something is routed: with an empty bay there is nothing for
// it to scale, and a permanent dead slider above the filter box would be the
// panel's most prominent control doing nothing.
export function MotionStrip(props: {
  // The panel's motion mode, which this button is the switch for. Seeing the
  // driven rows together is the only way to see them at all: they are scattered
  // down six stages, and a routing leaves the resting value alone, so nothing
  // else in the panel marks them from outside the row.
  //
  // A pressed state rather than a fire-and-forget, because the mode outlives the
  // press — it used to leave a glyph in the search box as its only trace, which
  // said what had happened but not that this button was what said it.
  moving: boolean
  onToggleMoving: () => void
}) {
  const { slots, master, setMaster, stab, stabHz } = useModSlotsApi()
  const api = useControlsApi()
  // The park, and the memory of where the fader was — see useHold, which the
  // deck's own ❚❚ shares. What each holds is deliberately different: this one
  // keeps every wave's phase, so letting go picks the drift back up mid-stride
  // instead of snapping everything to the top of its cycle.
  const hold = useHold(master, setMaster)

  // Everything the bay holds, split by whether it is running. The strip stands
  // as long as anything is *patched* — park every routing and the master fader
  // would otherwise vanish along with the count that is the one way to find the
  // parked rows again.
  //
  // Both numbers are drawn, and that is the fix for a button that used to lie
  // about its own result set: `N∿` counts what is moving, because that is the
  // question it is answering, but pressing it narrows the panel to everything
  // *patched* (`isRouted` in App, which matches a slot's target and asks nothing
  // about whether it is running) — so a strip reading `2∿` opened a list of
  // four. The parked ones ride along as a dim `+M` rather than being folded into
  // the count, since "two things are moving" and "four rows are about to appear"
  // are both true and neither is the other.
  const driven: string[] = []
  const stilled: string[] = []
  for (const s of slots) {
    if (s.target === '' || s.depth === 0) continue
    const label = sliderFor(s.target).label
    if (s.on) driven.push(label)
    else stilled.push(label)
  }
  // The gate stands the strip up on its own. It is scaled by nothing — the
  // freeze switches it off outright — but ❚❚ is the only thing that stops it,
  // and a strip that appeared only once a *slot* was patched would leave the
  // whole board cutting in and out with no way to hold it still.
  //
  // Dialed rather than resolved, and that is the whole reason the two are read
  // separately here: the strip has to stand while the freeze is holding the gate
  // at 0, or ❚❚ would take away the ▶ that undoes it. What it *says* is the
  // resolved rate below, because that is the number that is running.
  const gated = stab.hz > 0
  if (driven.length === 0 && stilled.length === 0 && !gated) return null
  // One decimal, and no trailing zero: a beat lock puts a tempo division in here
  // (174bpm at 1/4 is 11.6/s), where the slider alone only ever left tenths.
  const rate = stabHz.toFixed(1).replace(/\.0$/, '')

  // The same ⚟ every control row carries, on the one fader that is not a
  // control. Deliberately last in the strip rather than beside the freeze: it is
  // set-up, not performance, and it only exists once a device is wired up.
  const bind = api.bindLabel(MOTION)
  const armed = api.armed === MOTION
  return (
    <div className={styles.strip}>
      <button
        className={cx(styles.freeze, hold.frozen && styles.frozen)}
        title={
          hold.frozen
            ? 'let the motion run again, from where it stopped'
            : 'hold everything still — the waves keep their place, so this picks up where it left off'
        }
        onClick={hold.toggle}
      >
        {hold.frozen ? '▶' : '❚❚'}
      </button>
      {/* Named after the stage that creates it, not after what it does. "motion"
          was a word this panel uses nowhere else, on the loudest row above the
          fold, appearing unannounced the first time anything got patched — so it
          read as a setting that had arrived from somewhere with no way to find
          out where. "modulation" is the box on the map below that put it there,
          and the title says so in one line. */}
      <label
        className={styles.label}
        htmlFor="motion-amount"
        title="one fader over every routing in the bay — set up in the MODULATION box on the map below, scaled from here"
      >
        modulation
      </label>
      <input
        id="motion-amount"
        className={styles.range}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={master}
        title={
          driven.length === 0
            ? 'scales every routing’s depth at once — every one of them is held still'
            : `scales every routing's depth at once — driving ${driven.join(', ')}`
        }
        onChange={e => setMaster(Number(e.target.value))}
      />
      <button
        className={cx(styles.count, props.moving && styles.countOn)}
        aria-pressed={props.moving}
        title={[
          driven.length === 0 ? 'nothing is moving' : driven.join(', '),
          !gated
            ? ''
            : stabHz === 0
              ? 'the gate is dialed on and held still'
              : gateFlips(stab)
                ? `the whole board, flipping against a held look ${rate}× a second`
                : `the whole look, stabbed in ${rate}× a second`,
          stilled.length === 0 ? '' : `held still: ${stilled.join(', ')}`,
          props.moving
            ? 'showing every patched row, held ones included — click to show the whole panel again'
            : 'click to narrow the panel down to every patched row, held ones included',
        ]
          .filter(s => s !== '')
          .join(' — ')}
        onClick={props.onToggleMoving}
      >
        {/* The gate's rate rather than a glyph for it. `N∿` reads as a count
            because ∿ is the mark every routed row wears, and there is no second
            glyph in this panel that would say "the whole board, cut in and out"
            to someone who had not already been told. "2/s" needs no key. */}
        {`${driven.length}∿`}
        {stilled.length === 0 ? null : (
          <span className={styles.parked}>{`+${stilled.length}`}</span>
        )}
        {gated && stabHz > 0 ? ` ${rate}/s` : null}
      </button>
      {api.midiReady ? (
        <button
          className={cx(
            styles.bind,
            armed ? styles.bindArmed : bind !== null && styles.bindSet,
          )}
          title={
            bind === null
              ? 'assign a MIDI control'
              : `MIDI CC${bind} — click to relearn`
          }
          onClick={() => api.toggleArm(MOTION)}
        >
          {armed ? 'learn…' : bind === null ? '⚟' : `CC${bind}`}
        </button>
      ) : null}
    </div>
  )
}
