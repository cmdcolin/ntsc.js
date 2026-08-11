// How long a look takes to arrive, and the rules that turn a destination into a
// morph. The travelling itself is the engine's (signal/glide.ts) — this is the
// UI's half: the durations offered, and the two sets of keys that need slider
// metadata to work out.

import { VIEW_KEYS } from './controls'
import { ENUM_KEYS } from './presets'

import type { Controls } from '../controls'
import type { GlidePlan } from '../signal/glide'

// Off first, because a cut is a legitimate choice and the one every gesture used
// to make: a preset chip that took four seconds to land would be the wrong
// answer to "show me what this preset is".
//
// The spread is roughly geometric rather than even. What separates these is not
// a duration, it is a different gesture: 1s is a soft cut, 4s is a transition
// you can watch, 8s is long enough to hit surprise again in the middle of, and
// 30s is a slow sweep to leave running — the one where the point is not arriving
// at the destination at all but seeing what the path goes through on the way.
// A morph in flight, as useSyncExternalStore's pair: how far along, 0..1, or
// null when none is running. The same shape as `ControlStore` and for the same
// reason — the value moves at the frame rate, so it is subscribed to by the one
// widget that draws it rather than passed down from a component that would have
// to re-render to carry it.
export interface MorphStore {
  subscribe: (fn: () => void) => () => void
  get: () => number | null
}

export const MORPH_SECONDS = [0, 1, 4, 8, 30] as const
export type MorphSeconds = (typeof MORPH_SECONDS)[number]

export const MORPH_LABELS: Record<MorphSeconds, string> = {
  0: 'cut',
  1: '1s',
  4: '4s',
  8: '8s',
  30: '30s',
}

// The widest of those, in characters — what a strip row's arrival chip reserves
// so that stepping the ring cannot re-solve the card it is on. Same rule and
// same reason as `strip.ts`'s `HOLD_LABEL_CHARS`, which has the measurement;
// derived here too, so a duration added above widens the chip rather than
// starting a shift.
export const MORPH_LABEL_CHARS = Math.max(
  ...Object.values(MORPH_LABELS).map(label => label.length),
)

// A stored duration back onto the ring. Anything unrecognised — including a
// first run, which has never stored anything — lands on 1s rather than a cut:
// the list is allowed to be retuned, and a localStorage entry written by an
// older build outlives it, but an explicit cut is a choice someone made, not
// the value nobody has picked yet.
export const parseMorph = (raw: string | null): MorphSeconds =>
  MORPH_SECONDS.find(s => String(s) === raw) ?? 1

// A destination plus the two rules that need the slider schema: modes cut at the
// midpoint because there is no half-phosphor, and the view never moves because
// where you are looking is not part of the look. Both sets are the ones the mix
// and mutate already use, deliberately — a morph to a look should touch exactly
// what landing on that look would have touched.
export const morphTo = (to: Controls, seconds: number): GlidePlan => ({
  to,
  seconds,
  switchKeys: ENUM_KEYS,
  holdKeys: VIEW_KEYS,
})
