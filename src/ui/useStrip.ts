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

import { Listeners } from '../listeners'
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
  learnClipSeconds,
  loadStrip,
  moveRow,
  removeRow,
  renameRow,
  saveStrip,
  start,
  stepArrive,
  stripSeconds,
  stepTransition,
  stepHold,
  walking,
} from './strip'
import { offlineWalk, runStep } from './stripRun'

import type { Controls } from '../controls'
import type { Rand } from '../rng'
import type { PoolOrigin } from '../sources/pools'
import type { SliderDef } from './controls'
import type { History } from './history'
import type { MutateAmount } from './mutate'
import type { Clock, RowClip, Step, Strip, Walk } from './strip'
import type { StripSink } from './stripRun'
import type { TransitionName } from './transitions'
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
interface StripDeps {
  // The same apply a link gets, minus the boot-only half — see
  // `useEngine.showSession`. What makes "a row is a query string" true rather
  // than nearly true.
  showSession: (params: SessionParams, arrive: number) => void
  // A named fault off the shelf, with the row's whole step landing on its cut
  // frame — see `useEngine.faultTo`.
  faultTo: (transition: TransitionName, onCut: () => void) => void
  // A shelf clip onto deck A — see `useEngine.clipOn`. The part of a row that
  // a query string cannot carry, which is why it is a verb of its own rather
  // than something `showSession` could have covered.
  clipOn: (id: string, name: string) => void
  rollOn: (origin: PoolOrigin, rand: Rand) => void
  // The next row's clip, loaded during this one — see `useEngine.prerollOn`.
  prerollOn: (url: string, start: number) => void
  // And the same for a next row that names a shelf clip, which a url cannot
  // reach — see `useEngine.prerollClipOn`.
  prerollClipOn: (id: string, start: number) => void
  // Let go of it unspent. A lookahead is loaded for the *next* row of a running
  // walk, so a walk that has ended has nothing left to spend it on — see the
  // two call sites, which are the same two `track.pause` has and for the same
  // reason. Without it the parked element is only ever retired by the following
  // preroll, so a rundown stopped by hand left one `<video preload="auto">`
  // holding its whole clip for the life of the page.
  dropPreroll: () => void
  // Wait for the row that just fired to actually be on the deck. Used by the
  // offline walk and by nothing else — see `StripSink.settle` for why the live
  // one must not wait.
  settleSources: () => Promise<void>
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
  // The picked music track, if there is one — `useAudio`'s `track`.
  //
  // The rule is one sentence: **the track runs while the walk runs.** ▶ takes
  // it from the top so the two are locked at frame zero; stopping stops it; a
  // rundown that runs off its end stops it too. Firing a row by hand
  // deliberately does not touch it — that is a hand reaching into a take, not
  // the take restarting, and hauling the song back to zero under it would be
  // the one thing nobody wants mid-set.
  //
  // What this is not is a lock. The walk still advances on the engine's frame
  // counter, so a tempo that is wrong drifts against the music over minutes.
  // Cutting to the track's own clock is a bigger question (it wants the walk's
  // clock to come from `currentTime`, and an answer for what happens when the
  // song ends); starting together is most of the value for none of that.
  track: { loaded: boolean; restart: () => void; pause: () => void }
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
  // A measured clip length, into every row holding that clip. Its own verb
  // rather than a `setStrip` because it must not bank an undo step — nobody
  // performed it. See the implementation.
  learnClipSeconds: (clipId: string, seconds: number) => void
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
  // A second walk over the rundown as it stands, driven a frame at a time by
  // whoever asked — the offline half of _One walk, two clocks_. See the
  // implementation for why it keeps its own place and shares the sink.
  // A promise on the frames a row fires on, nothing on the rest — see
  // `stripRun.offlineWalk`, and `RenderSpec.onFrame` for who awaits it.
  offlineWalk: () => (frame: number) => void | Promise<void>
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

  const stripFns = new Listeners()
  const walkFns = new Listeners()
  const frameFns = new Listeners()

  // The tempo both walks measure their holds against. Its own function because
  // the offline walk wants the number and not the whole live clock — under a
  // render the frame comes from the render, not from `frameNo()`.
  const bpmNow = (): number => deps?.bpm ?? FALLBACK_BPM

  const clock = (): Clock => ({
    frame: deps?.frameNo() ?? 0,
    bpm: bpmNow(),
    fps: FPS,
  })

  // Which step's cut is still worth landing.
  //
  // A transition row's step is a *decision taken half a second before it
  // happens* — the engine holds it until the frame the picture is least legible
  // — and anything that moves the walk in between makes it stale. Without this,
  // a hand firing a plain row mid-transition watched its row arrive and then be
  // replaced, half a second later, by the row it had just cut away from; and
  // pressing stop stopped the walk and the music and then changed the source
  // anyway.
  //
  // **The fault is not cancelled, only its cut.** A fault is a picture effect
  // and should heal rather than vanish — the board is handed back by the frame
  // that ran, so stopping one mid-flight is a jump. What goes stale is the
  // decision it was carrying, which is a different thing from the damage.
  //
  // On the sink rather than on the live driver, so the offline walk gets the
  // same rule for free: both walks reach the browser through here, and the
  // engine is where the pending cut actually waits.
  let epoch = 0
  const supersede = () => {
    epoch += 1
  }

  // The sink: one closure per verb, and the whole of what a walk can ask a
  // browser for. Reads `deps` at call time rather than closing over it, since
  // the engine handed in is a different object after a device-loss rebuild.
  const sink: StripSink = {
    session: (params, seconds) => {
      // A session landing is a new step being up, which is exactly what makes
      // an older pending cut stale. Harmless inside a cut of its own: the
      // guard below has already been passed by then.
      supersede()
      deps?.showSession(params, seconds)
    },
    fault: (transition, onCut) => {
      supersede()
      const mine = epoch
      deps?.faultTo(transition, () => {
        if (mine === epoch) onCut()
      })
    },
    // A clip landing supersedes a pending cut for the same reason a session
    // does: it is a new picture being asked for, and a cut still waiting to
    // swap the source is a decision taken before that ask.
    clip: (id, name) => {
      supersede()
      deps?.clipOn(id, name)
    },
    roll: (origin, rand) => deps?.rollOn(origin, rand),
    // Safe to put on the shared sink because only `offlineWalk` calls it:
    // `runStep` — which is what the live `land` below goes through — has no
    // idea it exists. One sink, two walks, and the one that can afford to wait
    // is the only one that does.
    settle: () => deps?.settleSources() ?? Promise.resolve(),
    // `at` rather than `start`, which is the walk's own verb imported above.
    preroll: (url, at) => deps?.prerollOn(url, at),
    prerollClip: (id, at) => deps?.prerollClipOn(id, at),
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
    stripFns.emit()
  }

  // What a walk owns only while it is running. Both endings hand it back — a
  // rundown running off its end, and a hand on stop — so the two say it once
  // here rather than each remembering the list.
  const ended = () => {
    deps?.track.pause()
    deps?.dropPreroll()
  }

  // Every path that moves the walk goes through here, so no caller can move it
  // without the subscribers hearing about it or without the step being run.
  const land = (step: Step) => {
    walk = step.walk
    // A rundown that has run off its end stops the music with it — the same
    // rule `stop()` follows, applied at the one other place a walk can end.
    // Here rather than in `advance`, which is pure and has no business knowing
    // there is a song.
    if (!walking(walk)) ended()
    walkFns.emit()
    runStep(step, sink)
  }

  return {
    subscribeStrip: stripFns.subscribe,
    getStrip: () => strip,
    subscribeWalk: walkFns.subscribe,
    getWalk: () => walk,
    subscribeProgress: frameFns.subscribe,
    getProgress: () => holdProgress(walk, clock()),
    setDeps: next => {
      deps = next
    },
    tick: () => {
      // The progress readers first, and unconditionally: they move every frame
      // whether or not a boundary was crossed, and they are the reason this is
      // a rAF loop rather than a timer set to the next boundary.
      frameFns.emit()
      const step = advance(strip, walk, clock())
      if (step !== null) land(step)
    },
    start: () => {
      deps?.ensureTempo()
      // Before the walk, so the two are as close to the same instant as one
      // synchronous body gets them. Both are cheap and neither awaits.
      deps?.track.restart()
      land(start(strip, clock()))
    },
    stop: () => {
      walk = STOPPED
      ended()
      // The transport is the one way a walk ends without a step replacing it,
      // so it is the one place that has to say so out loud: a transition still
      // healing when stop is pressed keeps healing, and the source swap it was
      // holding does not land. Stop that stopped the walk and the music and
      // then cut anyway was the plainest version of this bug.
      supersede()
      walkFns.emit()
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
    // **Installed and not banked**, which is the one place that distinction has
    // to be made deliberately rather than inherited from `setStrip`.
    //
    // Nobody did this. It is a measurement landing a moment after the ＋ that
    // asked for it, so putting it on the undo stack costs a hand two presses to
    // take back one gesture — and the state in between is a row that snaps from
    // its own length back to a bar count, which reads as the undo being broken
    // rather than as there having been two steps. `install` is separate from
    // banking for exactly this reason; undo and redo were simply the only
    // callers until now.
    learnClipSeconds: (clipId, seconds) => {
      const next = learnClipSeconds(strip, clipId, seconds)
      // Identity, so a probe answering what the rundown already knew does not
      // persist it or wake the tray — see the pure function.
      if (next !== strip) install(next)
    },
    // The offline half of _One walk, two clocks_: a second walk over the
    // rundown as it stands, on a clock the caller drives (`stripRun.offlineWalk`
    // says what that means). Built here rather than by the render because the
    // sink is here — a rendered take has to ask the browser for exactly what a
    // performed one does, and two sinks is two answers to that.
    //
    // A snapshot of the rundown, taken now: a render is of the piece as it was
    // when the button went down, and a row edited while it runs would otherwise
    // change a take already half written.
    offlineWalk: () => offlineWalk(strip, sink, { bpm: bpmNow(), fps: FPS }),
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
  // Capture what is on the board now. The caller supplies the session string,
  // the suggested name and the clip on deck A, because building any of the
  // three needs the whole app's state — `useUrlState`'s `profileQuery`,
  // whichever preset the controls still match, and which shelf entry the deck
  // came off — which a strip has no business reaching into.
  addRow: (
    session: string,
    opts?: { jitter?: MutateAmount; name?: string; clip?: RowClip | null },
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
  // Step this row through the shelf and back to a plain cut — the other half of
  // "how it arrives", and the one that breaks the picture rather than the look.
  cycleTransition: (index: number) => void
  // Tell every row holding this clip how long it runs. Keyed on the shelf id
  // because the answer is a fact about the clip rather than about one row — see
  // `strip.learnClipSeconds`.
  learnClipSeconds: (clipId: string, seconds: number) => void
  // How long one lap of the rundown runs, or 0 when it cannot be said. What ⎙
  // renders, and the number a card's width will want.
  seconds: number
  setLoop: (on: boolean) => void
  // A new seed: the same rundown, different rolls and different drifts. The one
  // gesture that says "give me another take of this".
  reseed: () => void
  // Hand the offline render a walk over this rundown — see `StripRunner`. Not
  // a hook and not stateful here: each call is a fresh walk starting at the
  // top, which is what a take is.
  offlineWalk: StripRunner['offlineWalk']
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
        opts?: { jitter?: MutateAmount; name?: string; clip?: RowClip | null },
      ) => edit(s => addRow(s, session, opts)),
      renameRow: (index: number, name: string) =>
        edit(s => renameRow(s, index, name)),
      duplicateRow: (index: number) => edit(s => duplicateRow(s, index)),
      removeRow: (index: number) => edit(s => removeRow(s, index)),
      moveRow: (from: number, to: number) => edit(s => moveRow(s, from, to)),
      cycleHold: (index: number) => edit(s => stepHold(s, index)),
      cycleArrive: (index: number) => edit(s => stepArrive(s, index)),
      cycleTransition: (index: number) => edit(s => stepTransition(s, index)),
      setLoop: (on: boolean) => edit(s => ({ ...s, loop: on })),
      reseed: () => edit(s => ({ ...s, seed: randomSeed() })),
    }),
    [edit],
  )

  return {
    strip,
    // Derived at render rather than kept beside the rundown, on the same rule
    // the row index above follows: two pieces of state for one fact is how they
    // drift. It is a walk over the rows and arithmetic per row, on a list that
    // changes when a hand edits it — nothing like frame rate.
    //
    // The tempo is read here rather than inside the runner because it is what
    // this render is holding: a rundown of bar-counted holds is a different
    // length at 90bpm than at 140, and the number under the ⎙ has to say which
    // one it is now.
    seconds: stripSeconds(strip, { bpm: deps.bpm ?? FALLBACK_BPM, fps: FPS }),
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
    offlineWalk: runner.offlineWalk,
    learnClipSeconds: runner.learnClipSeconds,
    ...verbs,
  }
}
