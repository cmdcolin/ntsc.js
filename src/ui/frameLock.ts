// The frame-rate lock, as the surfaces outside the control panel show it.
//
// The control itself is an ordinary one (Screen · Display in controls.ts), so
// its labels, range and help text come from there and cannot drift. What it was
// not was findable: it is the panel's one performance knob and it sat at the
// bottom of the last group of the last stage, past a hundred and ninety signal
// controls, which is a fine place for a control you already know exists and the
// worst place for the one you go looking for when the picture is stuttering.
//
// So it now also appears where performance is actually looked at — the stage
// menu, on the row under the magnifier, and the Advanced dialog, beside render
// scale, which is the other knob that trades picture for frames. That is the
// same treatment the signal tap gets, and for the same reason: a setting nobody
// can find is a setting that does not exist. It belongs in that family rather
// than with the signal controls anyway — VIEW_KEYS already files it with the
// magnifier, as something that shapes how the picture is watched rather than
// what the signal does.
//
// The menu lays its settings out rather than stepping through them, which is
// where it parts company with the tap. Stepping suits the tap: five views of
// the same signal, cycled while watching what each one shows. It does not suit
// this — you reach for the lock *because* the picture is stuttering, with a
// rate in mind, and pressing a row three times to reach quarter rate is three
// chances to overshoot the one you wanted.

import { sliderFor } from './controls'

const DEF = sliderFor('frameLock')

// One label per value, index == value — the same list the panel's own toggle
// group renders. Narrowed once here because `choices` is optional on a
// SliderDef and three surfaces now read it; frameLock having lost its modes is
// a thing controls.test.ts holds against, so the fallback is for the type, not
// for a case that can arise.
export const FRAME_LOCK_LABELS: readonly string[] = DEF.choices ?? []

// What the control calls itself, so the menu row and the dialog's subhead agree
// with the row in Screen · Display without retyping it.
export const FRAME_LOCK_LABEL = DEF.label
export const FRAME_LOCK_HELP = DEF.help

export const frameLockLabel = (v: number): string =>
  FRAME_LOCK_LABELS[v] ?? 'off'

// The same settings at menu width. "1/2 rate" three times over spends most of a
// popover on the word "rate", which the row's own ⏱ already implies. Derived
// rather than written out a second time, so a mode added to the control appears
// here without anyone remembering to add it.
//
// Not the same mapping as the fps readout's ½ ⅓ ¼, which is keyed by the
// divisor the loop actually ran at — under `auto` that is 1 or 2 whatever this
// row says. These are the settings; that is the outcome.
export const FRAME_LOCK_SHORT: readonly string[] = FRAME_LOCK_LABELS.map(s =>
  s.replace(' rate', ''),
)
