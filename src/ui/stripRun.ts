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
// reimplement it (docs/EDITOR.md › _One walk, two clocks_), and `offlineWalk`
// at the foot of this file is that reuse: the same `advance`, the same
// `runStep`, a `Clock` counting rendered frames. Nothing here knows which of
// the two it is running under, and that is the point — the day it needs to
// know, the walk has stopped being one walk.
//
// **The sink is synchronous in both**, which an earlier draft of this header
// promised it would not be: it said an offline take would run "against a sink
// that awaits its loads instead of firing them off". It does not, and the
// reason is worth keeping rather than the promise. A load that has not landed
// yet is a picture arriving a frame late, and offline a render *could* wait —
// but what it would be waiting for is a `<video>` that plays at wall rate, so
// waiting patiently for a source that is not frame-exact buys a take that is
// still not reproducible. The awaiting sink is worth building the day the thing
// on the other side of it is (EDITOR.md's frame-exact video pull), and not one
// commit before.

import { rngFor } from '../rng'
import { STOPPED, advance, start } from './strip'
import { parseSessionParams } from './urlParams'

import type { Rand } from '../rng'
import type { PoolOrigin } from '../sources/pools'
import type { MutateAmount } from './mutate'
import type { Effect, Step, Strip } from './strip'
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

// --- the offline walk -------------------------------------------------------

// The same rundown, on a clock the caller drives one frame at a time.
//
// This is the second half of _One walk, two clocks_, and the reason it is nine
// lines is everything above it: `advance` already takes a `Clock` and does not
// care where the frame came from, `runStep` already turns a step into calls,
// and the difference between a performance and a render is entirely *what
// advances the frame*. Live it is rAF reading the engine's counter; here it is
// the render's own loop, which is why a take renders as fast as the GPU will go
// and still cuts on the frame the rundown says.
//
// **Its own `walk`, and deliberately not the live one.** A render is not a
// performance — it starts from the top whatever the tray was doing — so a take
// begun while a set is running does not inherit its place, and finishing one
// does not move it. What it does share is the sink, so a rendered take asks the
// browser for exactly what a performed one does.
//
// **`frame` is the take's, not the engine's**, which under a take are the same
// number (`startTake` counts from zero) and would not be if this were handed
// `frameNo()` while the live loop was running. Taking it as an argument rather
// than reading it is what keeps that a caller's problem rather than a bug here.
export function offlineWalk(
  strip: Strip,
  sink: StripSink,
  tempo: { bpm: number; fps: number },
): (frame: number) => void {
  let walk = STOPPED
  return frame => {
    const clock = { frame, bpm: tempo.bpm, fps: tempo.fps }
    // Frame zero starts the walk; every frame after it asks whether a boundary
    // has been crossed, which on nearly all of them it has not.
    const step = frame === 0 ? start(strip, clock) : advance(strip, walk, clock)
    if (step === null) return
    walk = step.walk
    runStep(step, sink)
  }
}
