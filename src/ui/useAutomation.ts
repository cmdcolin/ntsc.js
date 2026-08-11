// The recorder: the one part of automation that needs a running app.
//
// Two things in one file, split the way `useStrip` splits, and for the reason
// stated there rather than a fresh one. `makeAutomationRunner` is a plain
// object holding the tape, whether it is rolling and the frame it started on —
// no React, so the whole of the driver's logic is testable without a DOM.
// `useAutomation` is the thin hook over it: a stable instance, one
// `useSyncExternalStore` read, and the sink that puts a tape back into the
// engine.
//
// **The tape is not React state**, and it must not become any. It grows on
// every control write — a pointer drag, a MIDI knob at 200 Hz — and the panel's
// whole render budget is the measurement `ControlsContext` carries: one write
// costing 19 ms of React is past a frame and drops one off the WebGPU loop. So
// what this publishes is a *summary* — rolling, and how long the sealed tape is
// — whose identity changes at the two moments a hand presses something, and
// never at write rate. The events themselves are read by the render, once,
// through `getTape`.
//
// **Recording writes down; replaying writes back, and the two never meet.** The
// tap is on the write path App owns (`useMidi`'s `writeControl`/`writeControls`
// and the MIDI-origin path beside them), and a replay goes straight to the
// engine — so a render cannot re-record itself even if one were somehow started
// while the tape was rolling. Belt and braces, and cheap: MIDI's soft-takeover
// bookkeeping means nothing to an offline render anyway.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { EMPTY_TAPE, playTape, push, takeSeconds } from './automation'
import { morphTo } from './morph'

import type { ControlKey, Controls } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type { AutoEvent, AutoSink, Tape } from './automation'
import type { RefObject } from 'react'

// The simulation's own rate, and the rate a take is rendered at — the same
// number `useStrip` and `useRender` name, for the same reason: it is what a
// frame *is* here rather than a preference.
const FPS = 60

// Where a write is written down. Three verbs, matching the three variants, and
// deliberately shaped like the call sites rather than like the events: whoever
// is holding this is in the middle of doing something to the engine and should
// not have to build a record to say so.
//
// Every member is stable across a render, because two of them end up in
// `useCallback` dependency arrays that must not re-fire — see `useMidi`, where
// a fresh `writeControl` identity per render would reset soft-takeover every
// frame and a physical knob could never hold its catch.
export interface AutomationTap {
  set: (key: ControlKey, value: number) => void
  apply: (controls: Controls) => void
  glide: (to: Controls, seconds: number) => void
}

// What the tray draws from. Rebuilt only when one of the two answers changes —
// a fresh object per call would spin `useSyncExternalStore` forever, and the
// same trap `StripRunner.getDepth` documents.
export interface AutomationState {
  rolling: boolean
  frames: number
}

export interface AutomationRunner {
  subscribe: (fn: () => void) => () => void
  getState: () => AutomationState
  getTape: () => Tape
  // Where the stamp comes from. Handed in rather than read at construction for
  // the reason `scripts/compilercheck.mjs` gives and nothing else would: an
  // engine ref reached from inside `useState`'s initialiser is a ref read
  // during render, and the compiler drops the hook's memoization *silently*
  // when it sees one. The same shape `StripRunner.setDeps` uses, one field
  // wide. Until it is called the counter reads zero, which costs nothing —
  // nothing is rolling before a hand has pressed ●.
  setFrameNo: (fn: () => number) => void
  tap: AutomationTap
  // Roll from here. Whatever was on the tape is gone: a take is a performance,
  // and the gesture that starts one is not asking to append to the last.
  start: () => void
  // Seal it. The length is the frames elapsed rather than the last event's
  // stamp, so four bars of doing nothing at the end are still four bars.
  stop: () => void
  clear: () => void
}

// The clock before one has been handed over — the same shape `NO_SINKS` and
// `NO_CONTROL_STORE` take, and the same reason: an empty value is better than a
// null test at every call site. Nothing is rolling before a hand presses ●, so
// nobody ever reads it.
const NO_FRAMES = (): number => 0

export function makeAutomationRunner(): AutomationRunner {
  let frameNo: () => number = NO_FRAMES
  // Mutable, and handed out only as a sealed `Tape` — this is the array a
  // pointer drag appends to sixty times a second.
  let events: AutoEvent[] = []
  let tape: Tape = EMPTY_TAPE
  // The frame recording started on, or null when it is not rolling. Both facts
  // in one field, because two would be two chances to disagree about whether a
  // stamp means anything.
  let from: number | null = null
  let state: AutomationState = { rolling: false, frames: 0 }
  const listeners = new Set<() => void>()

  const publish = (next: AutomationState) => {
    if (next.rolling === state.rolling && next.frames === state.frames) return
    state = next
    for (const fn of listeners) fn()
  }

  // The stamp, and the whole of what makes an event belong to a take. `null`
  // means nothing is rolling, which every tap verb checks first — the tap is
  // live for the app's whole session and silent for nearly all of it.
  const at = (): number | null => (from === null ? null : frameNo() - from)

  return {
    subscribe: fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getState: () => state,
    getTape: () => tape,
    setFrameNo: fn => {
      frameNo = fn
    },
    tap: {
      set: (key, value) => {
        const t = at()
        if (t !== null) push(events, { kind: 'set', at: t, key, value })
      },
      // A copy, not the caller's object. `useMix` builds a fresh look for every
      // write so this is usually free — but `mutate` and `blendPresets` are not
      // the only callers, and a tape holding a board somebody goes on to mutate
      // in place is a take that changes after it was performed.
      apply: controls => {
        const t = at()
        if (t !== null)
          push(events, { kind: 'apply', at: t, controls: { ...controls } })
      },
      glide: (to, seconds) => {
        const t = at()
        if (t !== null)
          push(events, { kind: 'glide', at: t, to: { ...to }, seconds })
      },
    },
    start: () => {
      events = []
      tape = EMPTY_TAPE
      from = frameNo()
      publish({ rolling: true, frames: 0 })
    },
    stop: () => {
      if (from === null) return
      // `+ 1` because the frame recording started on is frame 0 and it is part
      // of the take: a tape started and stopped on one frame is one frame long,
      // not zero, and a zero-length take is one the render declines outright.
      const frames = Math.max(1, frameNo() - from + 1)
      tape = { events, frames }
      from = null
      publish({ rolling: false, frames })
    },
    clear: () => {
      events = []
      tape = EMPTY_TAPE
      from = null
      publish({ rolling: false, frames: 0 })
    },
  }
}

// Where a replay writes: straight at the engine, past the tap — see the header
// for why the two never meet.
//
// Its own exported function rather than three lines inside the hook, for a
// reason that is about harnesses and not about tidiness. `scripts/rendercheck.
// mjs` drives a take from outside React, and a harness that re-implements the
// app's wiring inside itself measures the engine correctly and the app not at
// all — which is exactly how a transition's stale-cut bug survived a browser
// check that was passing (docs/EDITOR.md › _Landed: between rows_). This is the
// seam that keeps the two the same code.
//
// Takes a getter rather than an engine so the app can read through its ref at
// call time, where a device-loss rebuild has put a different object.
export const engineAutoSink = (engine: () => EngineApi | null): AutoSink => ({
  set: (key, value) => engine()?.setControl(key, value),
  apply: controls => engine()?.applyControls(controls),
  // Rebuilt through `morphTo`, which is where the two key sets a plan needs
  // come from — so a replayed morph moves exactly the keys the recorded one
  // did, including the rule that leaves the magnifier where it is.
  glide: (to, seconds) => engine()?.startGlide(morphTo(to, seconds)),
})

export interface AutomationApi {
  rolling: boolean
  // The sealed take's length in seconds, 0 when there is nothing on the tape.
  // What ⎙ renders, and what the tray's readout shows.
  seconds: number
  tap: AutomationTap
  start: () => void
  stop: () => void
  clear: () => void
  // The tape as something a render drives a frame at a time — the automation's
  // half of `onFrame`, beside the rundown's. Not a hook and not stateful: each
  // call is a fresh walk from the top, which is what a take is.
  replay: () => (frame: number) => void
}

export function useAutomation(
  engineRef: RefObject<EngineApi | null>,
): AutomationApi {
  const [runner] = useState(makeAutomationRunner)
  // The clock, handed over rather than reached for — see `setFrameNo`. Its own
  // callback so the effect below has something stable to name, and through the
  // ref because a device-loss rebuild puts a different engine in it.
  const frameNo = useCallback(
    () => engineRef.current?.frameNo() ?? 0,
    [engineRef],
  )
  useEffect(() => {
    runner.setFrameNo(frameNo)
  }, [runner, frameNo])
  const state = useSyncExternalStore(runner.subscribe, runner.getState)

  const replay = useCallback(
    () =>
      playTape(
        runner.getTape(),
        engineAutoSink(() => engineRef.current),
      ),
    [runner, engineRef],
  )

  return {
    rolling: state.rolling,
    seconds: takeSeconds(state.frames, FPS),
    tap: runner.tap,
    start: runner.start,
    stop: runner.stop,
    clear: runner.clear,
    replay,
  }
}
