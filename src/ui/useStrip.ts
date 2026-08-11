// The driver: the one part of the strip that needs a browser.
//
// It is two things in one file, and the split matters more than it looks.
// `makeStripRunner` is a plain object holding the rundown, where the walk is,
// and the subscriptions — no React at all, so the whole of the driver's own
// logic is testable. `useStrip` is the thin hook over it: a stable instance, two
// `useSyncExternalStore` reads, and the tick.
//
// **The runner is outside React because the React Compiler requires it to be.**
// The obvious spelling of this hook keeps `walk` in `useState` and mirrors it
// into a ref for the rAF closure to read — and writing a ref during render is
// one of exactly two patterns that make the compiler give up on a component
// silently (`scripts/compilercheck.mjs` is the gate that catches it, and it did
// catch this one). Reaching for `eslint-disable` to quiet the dependency
// warning is worse: it skips optimisation for the whole hook. State that moves
// on a clock React does not own belongs outside React, which is what
// `ControlStore` and `MorphStore` already do here.
//
// **This hook holds the only effect in the feature**, and it is the kind an
// effect is for: synchronising with something outside React — the engine's
// frame counter, and the runner itself. Three things nearby deliberately are
// *not* effects, because they are the failure mode this app has been careful
// about: the hold's progress is derived from the walk and the frame rather than
// kept in step with them, a row card's "am I live" is a comparison at render,
// and the strip is persisted in the verb that changed it (the way
// `useTempo.write` does) rather than by an effect watching state.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import { randomSeed } from '../rng'
import { EMPTY_HISTORY, record, stepBack, stepForward } from './history'
import { MUTATE_AMOUNTS, mutate } from './mutate'
import {
  STOPPED,
  addRow,
  advance,
  duplicateRow,
  fire,
  holdProgress,
  loadStrip,
  moveRow,
  removeRow,
  renameRow,
  saveStrip,
  start,
  stepArrive,
  stepHold,
  walking,
} from './strip'
import { runStep } from './stripRun'

import type { Controls } from '../controls'
import type { Rand } from '../rng'
import type { PoolOrigin } from '../sources/pools'
import type { SliderDef } from './controls'
import type { History } from './history'
import type { MutateAmount } from './mutate'
import type { Clock, Step, Strip, Walk } from './strip'
import type { StripSink } from './stripRun'
import type { SessionParams } from './urlParams'

// The simulation's own rate. `signal/modstate.ts` is `const DT = 1 / 60` and
// the artifacts clock off the frame counter, so this is not a preference — it
// is what a frame *is* here, and the number an offline render at another rate
// would have to reckon with rather than override.
const FPS = 60

// What the walk measures against when nothing has set a tempo. Only reachable
// if a caller skips `ensureTempo`; kept so a strip started on a machine with no
// gear attached holds for four bars rather than dividing by null.
const FALLBACK_BPM = 120

// Everything the runner needs from the rest of the app, re-supplied on every
// render because most of it changes identity that often.
export interface StripDeps {
  // The same apply a link gets, minus the boot-only half — see
  // `useEngine.showSession`. What makes "a row is a query string" true rather
  // than nearly true.
  showSession: (params: SessionParams, arrive: number) => void
  rollOn: (origin: PoolOrigin, rand: Rand) => void
  getControls: () => Controls
  writeControls: (controls: Controls) => void
  // Every slider a jitter may touch: the panel's own list, passed in rather
  // than rebuilt, so a row's jitter and the mutate button shake the same set —
  // including the rule that keeps the magnifier still.
  mutateSliders: readonly SliderDef[]
  bpm: number | null
  // Called when a walk starts rather than on mount, so merely showing the tray
  // does not give a session a tempo it never asked for.
  ensureTempo: () => void
  frameNo: () => number
}

export interface StripRunner {
  subscribeStrip: (fn: () => void) => () => void
  getStrip: () => Strip
  subscribeWalk: (fn: () => void) => () => void
  getWalk: () => Walk
  // The per-frame one, kept apart from the two above because it moves every
  // frame where they move at hand and row rate. Read by the single element that
  // draws it, so a progress bar cannot re-render the rundown.
  subscribeProgress: (fn: () => void) => () => void
  getProgress: () => number | null
  setDeps: (deps: StripDeps) => void
  // One rAF's worth of work: notify the progress readers, and advance the walk
  // if a boundary has been crossed. Returns nothing — everything it changes is
  // announced through the subscriptions.
  tick: () => void
  start: () => void
  stop: () => void
  fireRow: (index: number) => void
  setStrip: (next: Strip) => void
  // How deep the walk goes either way, as a *snapshot* rather than two
  // predicates — and that distinction is load-bearing rather than stylistic.
  //
  // This was `canUndo()` / `canRedo()`, called during render. Under the React
  // Compiler that is a cache: the calls depend only on `runner`, which never
  // changes identity, so the result was memoized on first render and the undo
  // button stayed disabled forever however many edits landed. Nothing warns —
  // `pnpm compiler` reports the hook as optimized, because it *is*; the
  // optimization is simply reading an impure method as if it were pure.
  //
  // So it goes through the door React already understands: a snapshot with a
  // stable identity, rebuilt only when the answer changes (a fresh object per
  // call would spin `useSyncExternalStore` forever), published on the same
  // notification the rundown uses.
  getDepth: () => { undo: boolean; redo: boolean }
  undo: () => void
  redo: () => void
}

// Subscribe/unsubscribe, and fan-out. At module scope because they capture
// nothing — three sets in the runner below want the same two lines each.
const subscriberFor = (set: Set<() => void>) => (fn: () => void) => {
  set.add(fn)
  return () => {
    set.delete(fn)
  }
}
const emit = (set: Set<() => void>) => {
  for (const fn of set) fn()
}

export function makeStripRunner(): StripRunner {
  // Read once, here rather than in a mount effect: this is called from
  // `useState`'s initialiser, which runs exactly once, so there is nothing an
  // effect would add except a render showing an empty rundown first.
  let strip = loadStrip()
  let walk = STOPPED
  let deps: StripDeps | null = null
  // The rundown's own undo walk, over `history.ts` — the same bounded,
  // retraceable structure the look walk uses, and generic already, so this is a
  // second instantiation rather than a second implementation.
  //
  // Its own history rather than a share of the look's, because the two undo
  // different kinds of thing: ctrl+z on the board means "put that knob back",
  // and on the rundown it means "put that row back". One stack would make each
  // gesture step through the other's edits, which is the version of undo people
  // stop trusting. That is also why this is a button in the tray and not on
  // ctrl+z — see StripTray.
  let past = EMPTY_HISTORY as History<Strip>
  let depth = { undo: false, redo: false }

  const stripFns = new Set<() => void>()
  const walkFns = new Set<() => void>()
  const frameFns = new Set<() => void>()

  const clock = (): Clock => ({
    frame: deps?.frameNo() ?? 0,
    bpm: deps?.bpm ?? FALLBACK_BPM,
    fps: FPS,
  })

  // The sink: three closures, and the whole of what a walk can ask a browser
  // for. Reads `deps` at call time rather than closing over it, since the
  // engine handed in is a different object after a device-loss rebuild.
  const sink: StripSink = {
    session: (params, seconds) => deps?.showSession(params, seconds),
    roll: (origin, rand) => deps?.rollOn(origin, rand),
    jitter: (amount, rand) => {
      if (deps === null) return
      deps.writeControls(
        mutate(
          deps.getControls(),
          deps.mutateSliders,
          MUTATE_AMOUNTS[amount],
          rand,
        ),
      )
    },
  }

  // Put a rundown in place: store it, persist it, tell the readers. Separate
  // from banking it (`setStrip` above does that) precisely so undo and redo can
  // install one without recording the move they are undoing.
  const install = (next: Strip) => {
    strip = next
    saveStrip(next)
    // Identity changes only when the answer does — see `getDepth`.
    const undo = past.past.length > 0
    const redo = past.future.length > 0
    if (undo !== depth.undo || redo !== depth.redo) depth = { undo, redo }
    emit(stripFns)
  }

  // Every path that moves the walk goes through here, so no caller can move it
  // without the subscribers hearing about it or without the step being run.
  const land = (step: Step) => {
    walk = step.walk
    emit(walkFns)
    runStep(step, sink)
  }

  return {
    subscribeStrip: subscriberFor(stripFns),
    getStrip: () => strip,
    subscribeWalk: subscriberFor(walkFns),
    getWalk: () => walk,
    subscribeProgress: subscriberFor(frameFns),
    getProgress: () => holdProgress(walk, clock()),
    setDeps: next => {
      deps = next
    },
    tick: () => {
      // The progress readers first, and unconditionally: they move every frame
      // whether or not a boundary was crossed, and they are the reason this is
      // a rAF loop rather than a timer set to the next boundary.
      emit(frameFns)
      const step = advance(strip, walk, clock())
      if (step !== null) land(step)
    },
    start: () => {
      deps?.ensureTempo()
      land(start(strip, clock()))
    },
    stop: () => {
      walk = STOPPED
      emit(walkFns)
    },
    // A hand on a row. Fires whether or not the walk is running, which is what
    // makes the rundown a bank of scenes as well as a sequence — the design's
    // "an ordered list of cued states, each of which can also fire on its own".
    fireRow: index => {
      deps?.ensureTempo()
      land(fire(strip, walk, index, clock()))
    },
    // Persisted here, in the verb that changed it, rather than by an effect
    // watching state — see the header.
    //
    // And banked here, for the same reason: this is the funnel every edit goes
    // through, so recording the *replaced* rundown once here is what makes undo
    // total rather than something each of the eight verbs has to remember.
    setStrip: next => {
      past = record(past, strip, (a, b) => a === b)
      install(next)
    },
    getDepth: () => depth,
    // Both directions, and neither records: `stepBack` moves the current
    // rundown onto the redo tail itself, so banking here as well would make one
    // press take two to come back from.
    undo: () => {
      const out = stepBack(past, strip)
      if (out !== null) {
        past = out.history
        install(out.value)
      }
    },
    redo: () => {
      const out = stepForward(past, strip)
      if (out !== null) {
        past = out.history
        install(out.value)
      }
    },
  }
}

// The verbs, and nothing that moves at frame rate except as a subscribe/get
// pair. Every member keeps its identity across a render — the rule
// `ControlsApi` states and the reason a running strip does not rebuild the tray.
export interface StripApi {
  strip: Strip
  // Which row is up, or -1. Derived from the walk snapshot at render rather
  // than stored beside it: two pieces of state for one fact is how they drift.
  row: number
  running: boolean
  progress: StripRunner['getProgress']
  subscribeProgress: StripRunner['subscribeProgress']
  start: () => void
  stop: () => void
  fireRow: (index: number) => void
  // Capture what is on the board now. The caller supplies both the session
  // string and the suggested name because building either needs the whole app's
  // state — `useUrlState`'s `profileQuery`, and whichever preset the controls
  // still match — which a strip has no business reaching into.
  addRow: (
    session: string,
    opts?: { jitter?: MutateAmount; name?: string },
  ) => void
  renameRow: (index: number, name: string) => void
  duplicateRow: (index: number) => void
  removeRow: (index: number) => void
  // The rundown's own walk back. Its own, not a share of the look's — the two
  // undo different kinds of thing, and one stack would make each gesture step
  // through the other's edits.
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  moveRow: (from: number, to: number) => void
  cycleHold: (index: number) => void
  cycleArrive: (index: number) => void
  setLoop: (on: boolean) => void
  // A new seed: the same rundown, different rolls and different drifts. The one
  // gesture that says "give me another take of this".
  reseed: () => void
}

export function useStrip(deps: StripDeps): StripApi {
  const [runner] = useState(makeStripRunner)

  // The runner lives outside React and has to be told what this render is
  // holding. An effect with no dependency list, which is the honest spelling:
  // every field of `deps` is read at call time, and there is no subset of them
  // this could correctly watch.
  useEffect(() => {
    runner.setDeps(deps)
  })

  const strip = useSyncExternalStore(runner.subscribeStrip, runner.getStrip)
  const walk = useSyncExternalStore(runner.subscribeWalk, runner.getWalk)
  // On the rundown's own notification, since the walk's depth only ever changes
  // when the rundown does. Through the store rather than by calling a predicate
  // during render — see `getDepth` for what that cost.
  const depth = useSyncExternalStore(runner.subscribeStrip, runner.getDepth)
  const running = walking(walk)

  // The tick, gated on a walk actually running: a strip nobody is playing costs
  // nothing at all. rAF rather than the 10 Hz the transport polls at — a row
  // boundary is a cut, and 100ms of slop on a cut meant to land on a beat is
  // audible. What it costs while running is one `frameNo()` read and one
  // comparison per frame; React is touched only when a boundary is crossed.
  useEffect(() => {
    if (!running) return undefined
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      runner.tick()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, runner])

  // Every edit is the same two steps — read the current rundown, hand back a
  // new one — so they are one helper rather than eight closures that each
  // remember to persist. `runner.getStrip()` rather than the `strip` above:
  // these are called from event handlers, where the render's snapshot may be a
  // beat behind a boundary that just landed.
  const edit = useCallback(
    (fn: (strip: Strip) => Strip) => {
      runner.setStrip(fn(runner.getStrip()))
    },
    [runner],
  )

  const verbs = useMemo(
    () => ({
      addRow: (
        session: string,
        opts?: { jitter?: MutateAmount; name?: string },
      ) => edit(s => addRow(s, session, opts)),
      renameRow: (index: number, name: string) =>
        edit(s => renameRow(s, index, name)),
      duplicateRow: (index: number) => edit(s => duplicateRow(s, index)),
      removeRow: (index: number) => edit(s => removeRow(s, index)),
      moveRow: (from: number, to: number) => edit(s => moveRow(s, from, to)),
      cycleHold: (index: number) => edit(s => stepHold(s, index)),
      cycleArrive: (index: number) => edit(s => stepArrive(s, index)),
      setLoop: (on: boolean) => edit(s => ({ ...s, loop: on })),
      reseed: () => edit(s => ({ ...s, seed: randomSeed() })),
    }),
    [edit],
  )

  return {
    strip,
    row: walk.row,
    running,
    progress: runner.getProgress,
    subscribeProgress: runner.subscribeProgress,
    start: runner.start,
    stop: runner.stop,
    fireRow: runner.fireRow,
    canUndo: depth.undo,
    canRedo: depth.redo,
    undo: runner.undo,
    redo: runner.redo,
    ...verbs,
  }
}
