import { useState } from 'react'

import { sliderFor } from './controls'
import { useControlsApi } from './ControlsContext'
import { cx } from './cx'
import { MOTION } from './midi'
import { useModSlotsApi } from './ModSlotsContext'
import styles from './MotionStrip.module.css'

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
  // Puts the motion query in the filter box, which is the only way to see the
  // driven rows together: they are scattered down six stages, and a routing
  // leaves the resting value alone, so nothing else in the panel marks them
  // from outside the row.
  onReveal: () => void
}) {
  const { slots, master, setMaster, stab } = useModSlotsApi()
  const api = useControlsApi()
  // What to come back to when the freeze lets go. Local, not persisted: a
  // freeze is a gesture within a session, and reloading into a frozen board
  // with no memory of why would just look broken.
  const [held, setHeld] = useState(1)

  // Everything the bay holds, split by whether it is running. The strip stands
  // as long as anything is *patched* — park every routing and the master fader
  // would otherwise vanish along with the count that is the one way to find the
  // parked rows again — but it counts only what is moving, because that is the
  // question `N∿` is answering.
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
  const gated = stab.hz > 0
  if (driven.length === 0 && stilled.length === 0 && !gated) return null

  const frozen = master === 0
  // The same ⚟ every control row carries, on the one fader that is not a
  // control. Deliberately last in the strip rather than beside the freeze: it is
  // set-up, not performance, and it only exists once a device is wired up.
  const bind = api.bindLabel(MOTION)
  const armed = api.armed === MOTION
  return (
    <div className={styles.strip}>
      <button
        className={cx(styles.freeze, frozen && styles.frozen)}
        title={
          frozen
            ? 'let the motion run again, from where it stopped'
            : 'hold everything still — the waves keep their place, so this picks up where it left off'
        }
        onClick={() => {
          if (frozen) {
            setMaster(held === 0 ? 1 : held)
          } else {
            setHeld(master)
            setMaster(0)
          }
        }}
      >
        {frozen ? '▶' : '❚❚'}
      </button>
      {/* Named after the section that creates it, not after what it does. "motion"
          was a word this panel uses nowhere else, on the loudest row above the
          fold, appearing unannounced the first time anything got patched — so it
          read as a setting that had arrived from somewhere with no way to find
          out where. "modulation" is the section three folds down that put it
          there, and the title says so in one line. */}
      <label
        className={styles.label}
        htmlFor="motion-amount"
        title="one fader over every routing in the Modulation section below — set up there, scaled from here"
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
        className={styles.count}
        title={[
          driven.length === 0 ? 'nothing is moving' : driven.join(', '),
          gated ? `the whole look, stabbed in ${stab.hz}× a second` : '',
          stilled.length === 0 ? '' : `held still: ${stilled.join(', ')}`,
          'click to filter the panel down to them',
        ]
          .filter(s => s !== '')
          .join(' — ')}
        onClick={props.onReveal}
      >
        {/* The gate's rate rather than a glyph for it. `N∿` reads as a count
            because ∿ is the mark every routed row wears, and there is no second
            glyph in this panel that would say "the whole board, cut in and out"
            to someone who had not already been told. "2/s" needs no key. */}
        {gated ? `${driven.length}∿ ${stab.hz}/s` : `${driven.length}∿`}
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
