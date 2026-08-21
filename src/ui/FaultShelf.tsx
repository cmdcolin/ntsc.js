import { use } from 'react'

import { ControlStoreContext, useControlsApi } from './ControlsContext'
import styles from './Deck.module.css'
import { barCut } from './deckModel'
import { TRANSITIONS, faultPlan } from './transitions'

// The shelf of named transitions, under the lever they replace.
//
// **What these are, and why they are not next to the wipe patterns.** The row
// above arms what the *lever* does — dissolve or wipe, both of them a mix of two
// pictures the receiver is perfectly happy about. These are the other kind, the
// one only this project can offer: a fault that happens to resolve. You do not
// draw a wipe over the cut, you break something, cut while it is broken, and let
// it heal onto the new source (docs/EDITOR.md › _Transitions_). So the two rows
// are two different verbs and they read as two rows.
//
// A press is one gesture and the whole transition: the engine runs the fault on
// its own clock and calls back on the frame the picture is least legible, and
// the callback is the cut. Nothing here polls, animates, or holds a timer —
// which is the point of `startFault` living on the engine, since the panel
// cannot be trusted with anything that has to land on a particular frame.

export function FaultShelf() {
  const { startFault, writeControls } = useControlsApi()
  // The store rather than this render's snapshot, for the same reason the
  // auto-take beside it reads the store: the cut lands a second or two after
  // the press, and where the bar is *then* is what decides which way it goes.
  // A position read at press time would send it back the way it came whenever
  // anything moved the fader in between — a preset, a MIDI knob, a patched LFO.
  const store = use(ControlStoreContext)
  return (
    // `data-shelf` is a harness hook, the way the tray's cards carry
    // `data-index`: the labels here are ordinary words ("track", "roll") that
    // collide with buttons elsewhere in a thousand-button panel, so
    // `scripts/faultcheck.mjs` needs a container to look inside rather than a
    // text match to hope about.
    <div className={styles.shelf} data-shelf="">
      {TRANSITIONS.map(t => (
        <button
          key={t.name}
          className={styles.faultBtn}
          title={`${t.title} — over ${t.seconds}s`}
          onClick={() =>
            startFault(
              faultPlan(t, () => {
                writeControls(barCut(store.get()))
              }),
            )
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
