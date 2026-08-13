// The automation tape: what a hand did to the board, stamped by frame.
//
// The design is [`docs/EDITOR.md`](../../docs/EDITOR.md) › _Live input has no
// offline meaning_, and the sentence that names this is the whole of it — MIDI
// and a hand on a slider cannot be re-rendered, so the answer is not to stub
// them but to record what they *did* and replay it into the offline render.
// Perform at whatever rate the GPU gives you; render at quality afterwards.
//
// Pure, and for the same reason `strip.ts` is: the part that is easy to get
// subtly wrong here is the arithmetic — which events belong to frame N, whether
// one can land twice, what a repeat inside one frame means — and a browser is
// an expensive place to find that out. `useAutomation.ts` carries out; this
// decides.
//
// **Frames, not milliseconds**, and the trade is worth stating because it is
// visible. A take performed in a tab running at 40fps renders at two thirds of
// the wall time it was performed in: every gesture lands on the frame it was
// made on, and offline those frames go past at 60. That is not a compromise
// this file invented — the strip's holds are already measured in frames
// (`strip.ts`'s `Clock`), so a rundown performed at 40fps already renders
// short. Stamping this in milliseconds would put the automation and the walk on
// two different clocks, which is the one thing _One walk, two clocks_ is
// arranged to avoid. One take, one clock, and the clock counts frames.
//
// What is deliberately *not* on the tape is anything the offline walk already
// reproduces. A row's session, its roll, its jitter and its preroll all come
// back from `strip.ts` at the same frames, so recording them too would be a
// second copy of one decision — and the app's wiring makes that structural
// rather than a rule to remember: a row reaches the engine through
// `useEngine.showSession`, and the tap sits on the write path App owns.

import type { ControlKey, Controls } from '../controls'

// One thing a hand did. Three variants, matching the three ways a look reaches
// the engine from outside the strip.
//
// `at` is the take's own frame — 0 is the frame recording started on, which
// under a render is the frame `startTake` counts from, so the two numbers are
// the same number by construction rather than by conversion.
interface AutoSet {
  kind: 'set'
  at: number
  key: ControlKey
  value: number
}

// A whole board at once: a preset, a mutate, a T-bar throw, an undo. Stored as
// the resolved look rather than as what produced it, because what produced it
// is not always re-derivable — `blendPresets` over a weight map, a `mutate`
// that drew from a generator this tape does not own — and the look is.
interface AutoApply {
  kind: 'apply'
  at: number
  controls: Controls
}

// A morph, as the destination and the span rather than as the plan. The plan's
// other two fields are the two key sets `morphTo` supplies from constants
// (`ENUM_KEYS`, `VIEW_KEYS`), so a replay rebuilds a plan identical to the one
// recorded — and a tape stays a thing of numbers rather than of Sets.
//
// Recorded rather than sampled per frame, which is the point: a glide is
// frame-clocked in the engine and already right under a take's virtual clock,
// so one event at the frame it was asked for reproduces the whole travel. The
// alternative — writing the tween's values on every frame — would be sixty
// events a second saying what one event already says.
interface AutoGlide {
  kind: 'glide'
  at: number
  to: Controls
  seconds: number
}

export type AutoEvent = AutoSet | AutoApply | AutoGlide

// A recorded take. `frames` is its length, sealed when recording stops, so a
// tape whose last event is at frame 12 of a 900-frame performance still knows
// it is fifteen seconds long.
export interface Tape {
  events: readonly AutoEvent[]
  frames: number
}

export const EMPTY_TAPE: Tape = { events: [], frames: 0 }

// What replaying one costs the browser. Deliberately not "the engine": the same
// narrowing `StripSink` makes, for the same two reasons — a test satisfies it
// with three closures, and the driver satisfies it however the engine happens
// to be shaped this month.
export interface AutoSink {
  set: (key: ControlKey, value: number) => void
  apply: (controls: Controls) => void
  glide: (to: Controls, seconds: number) => void
}

// One event. A switch with no default, so a fourth variant — a hand-thrown
// fault, a bay strike — is a compile error here until it is handled.
export function runAuto(event: AutoEvent, sink: AutoSink): void {
  switch (event.kind) {
    case 'set':
      sink.set(event.key, event.value)
      break
    case 'apply':
      sink.apply(event.controls)
      break
    case 'glide':
      sink.glide(event.to, event.seconds)
      break
  }
}

// Whether `next` says everything `prev` said — same frame, same target.
//
// This is what bounds a tape. A pointer drag or a MIDI knob can write one key
// many times inside a single frame, and only the last of them is what the frame
// rendered: the engine holds one value per key and the picture is drawn once.
// So collapsing them loses nothing, and not collapsing them costs a Twister
// sending at 200 Hz four minutes of events nobody can see the difference of.
//
// Against the *last* event only, and never across a frame boundary. Reordering
// is the hazard here — `apply` a preset, then `set` one knob on top of it, is a
// different board from the two the other way round — and looking no further
// back than one event makes that unreachable by construction.
const supersedes = (prev: AutoEvent, next: AutoEvent): boolean => {
  if (prev.at !== next.at || prev.kind !== next.kind) return false
  return prev.kind === 'set' && next.kind === 'set'
    ? prev.key === next.key
    : true
}

// Append, collapsing a repeat of the same target on the same frame. Mutates,
// because it is called from inside a pointer drag and a fresh array per write
// is the churn this is trying to avoid in the first place.
export function push(events: AutoEvent[], next: AutoEvent): void {
  const last = events.at(-1)
  if (last !== undefined && supersedes(last, next))
    events[events.length - 1] = next
  else events.push(next)
}

// A tape as something a render can drive one frame at a time — the same shape
// `stripRun.offlineWalk` hands back, and for the same reason: the render owns
// the frames and asks what belongs to each one.
//
// **A cursor, not a lookup by frame.** Everything at or before `frame` that has
// not played yet plays now, which makes the walk total: a render that is asked
// for frame 0 then frame 2 still lands frame 1's events rather than dropping
// them, and a tape recorded in a tab that skipped frames replays every gesture
// it holds. Asking twice for the same frame is a no-op, which is the property
// that makes it safe to call from `onFrame` without knowing what else is.
//
// Fresh state per call, so two renders of one tape are two independent walks.
export function playTape(tape: Tape, sink: AutoSink): (frame: number) => void {
  let next = 0
  return frame => {
    while (next < tape.events.length && tape.events[next].at <= frame) {
      runAuto(tape.events[next], sink)
      next += 1
    }
  }
}

// How long a take is, in seconds at the rate it will be rendered at. The one
// conversion out of frames, and it happens at the edge — a button label and a
// render length — rather than anywhere the tape is reasoned about.
//
// A count rather than a `Tape`, because the two callers hold a count: the tray
// reads it off the recorder's published summary, which is deliberately not the
// events (see `useAutomation`).
export const takeSeconds = (frames: number, fps: number): number =>
  fps <= 0 ? 0 : frames / fps
