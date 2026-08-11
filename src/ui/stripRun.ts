// Carrying out what the walk decided — the second half of `strip.ts`, and still
// no React.
//
// `advance` returns effects and never performs them; this turns one into calls
// on a `StripSink`. The split is what makes the whole feature testable without
// a browser: a fake sink records what a rundown asked for, so "row 2 rolled the
// wrong pool" is a failing assertion rather than something to notice on screen
// three minutes into a set.
//
// It is also what lets the offline render reuse the walk rather than
// reimplement it (docs/EDITOR.md › _One walk, two clocks_). An offline take is
// this same function, against a sink that awaits its loads instead of firing
// them off, driven by a `Clock` counting rendered frames. Nothing here knows
// which of the two it is running under, and that is the point — the day it
// needs to know, the walk has stopped being one walk.

import { rngFor } from '../rng'
import { parseSessionParams } from './urlParams'

import type { Rand } from '../rng'
import type { PoolOrigin } from '../sources/pools'
import type { MutateAmount } from './mutate'
import type { Effect, Step } from './strip'
import type { SessionParams } from './urlParams'

// What a row needs the browser to do. Three verbs, matching the three effects.
//
// Deliberately not "the engine": the sink is the narrowest statement of what a
// walk requires, so the driver can satisfy it however the engine happens to be
// shaped this month, and a test can satisfy it with three closures that push
// onto an array.
export interface StripSink {
  // Put a whole session up — source, cue, look and motion — with the look
  // arriving over `seconds` (0 cuts). Already parsed, because the parse is pure
  // and belongs on this side of the boundary: a sink should not have to know
  // that a row is a query string.
  session: (params: SessionParams, seconds: number) => void
  // Roll a pool onto the deck, drawing from this generator rather than from
  // `Math.random` — the whole of `rng.ts`'s reason for existing.
  roll: (origin: PoolOrigin, rand: Rand) => void
  // Shake the live look by this much. Not a look to land on: a jitter row is a
  // departure from whatever is on the board when it fires.
  jitter: (amount: MutateAmount, rand: Rand) => void
}

// One effect. A switch with no default: the union is closed, so adding a
// variant to it (preroll, a fault) is a compile error here until it is handled,
// which is the reminder worth having.
export function runEffect(effect: Effect, sink: StripSink): void {
  switch (effect.kind) {
    case 'session':
      // `?` prefixed because that is what `parseSessionParams` reads — it takes
      // a `location.search`, and a row's session is stored without the marker
      // for the same reason `writeProfileParams` hands back a bare
      // URLSearchParams.
      sink.session(parseSessionParams(`?${effect.session}`), effect.seconds)
      break
    case 'roll':
      sink.roll(effect.origin, rngFor(effect.seed))
      break
    case 'jitter':
      sink.jitter(effect.amount, rngFor(effect.seed))
      break
  }
}

// A whole step, in order. The order is load-bearing — both of the other
// fillings are departures from what the session named, so the session lands
// first — and it is `fireEffects` that decides it, not this.
export function runStep(step: Step, sink: StripSink): void {
  for (const effect of step.effects) runEffect(effect, sink)
}
