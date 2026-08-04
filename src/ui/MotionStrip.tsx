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
export function MotionStrip() {
  const { slots, master, setMaster } = useModSlotsApi()
  const api = useControlsApi()
  // What to come back to when the freeze lets go. Local, not persisted: a
  // freeze is a gesture within a session, and reloading into a frozen board
  // with no memory of why would just look broken.
  const [held, setHeld] = useState(1)

  const driven = slots.flatMap(s =>
    s.target === '' || s.depth === 0 ? [] : [sliderFor(s.target).label],
  )
  if (driven.length === 0) return null

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
      <label className={styles.label} htmlFor="motion-amount">
        motion
      </label>
      <input
        id="motion-amount"
        className={styles.range}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={master}
        title={`scales every routing's depth at once — driving ${driven.join(', ')}`}
        onChange={e => setMaster(Number(e.target.value))}
      />
      <span className={styles.count} title={driven.join(', ')}>
        {driven.length}∿
      </span>
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
