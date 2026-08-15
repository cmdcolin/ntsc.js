import { createContext, use, useSyncExternalStore } from 'react'

import { DEFAULT_CONTROLS } from '../controls'

import type { ControlKey, Controls } from '../controls'
import type { Store } from '../listeners'
import type { FaultPlan } from '../signal/fault'
import type { SliderDef } from './controls'
import type { BindTarget } from './midi'
import type { MutateAmount } from './mutate'

// The control store as the rows see it — subscribe, then read — rather than the
// values themselves. That distinction is the panel's whole render budget: a
// `controls` object on ControlsApi changed identity on every write, so every
// `useControlsApi()` consumer re-rendered no matter what the React Compiler had
// memoized. With all 202 rows mounted (which any filter query does — expandAll
// follows the query) one slider write cost 19ms of React, well past a frame,
// and a drag dropped one off the WebGPU loop per pointer move.
//
// Both halves are stable across a write, so a component that subscribes to one
// key hears about that key and nothing else.
export type ControlStore = Store<Controls>

// What the panel reads before the async engine exists. Also what a row rendered
// outside a provider gets: a control row is worth drawing at its default rather
// than throwing, unlike ControlsApi below, which has no sane empty value.
export const NO_CONTROL_STORE: ControlStore = {
  subscribe: () => () => {},
  get: () => DEFAULT_CONTROLS,
}

export const ControlStoreContext = createContext<ControlStore>(NO_CONTROL_STORE)

// One control's live value, and the reason the store is a context of its own.
export function useControlValue(key: ControlKey): number {
  const store = use(ControlStoreContext)
  return useSyncExternalStore(store.subscribe, () => store.get()[key])
}

// A *reading* of the controls rather than a slice of them: one string, number
// or boolean answering one question — is anything in this group off its
// default, how many trims are, which gates are shut.
//
// Restricted to primitives on purpose, and it is the restriction that does the
// work. React re-renders only when the answer actually changes, and — because
// two equal primitives are `===` — the React Compiler can key a memo block on
// it. Return an object here and both properties are gone: the reading is a
// fresh identity every write, the block invalidates every write, and everything
// under it rebuilds. That is exactly what `useControls` does to a component,
// which is why the group header does not use it.
export function useControlReading<T extends string | number | boolean>(
  read: (controls: Controls) => T,
): T {
  const store = use(ControlStoreContext)
  return useSyncExternalStore(store.subscribe, () => read(store.get()))
}

// The whole set, for the few places that genuinely want it: the miniatures,
// which drag four or five values in one gesture. A component that reads this
// re-renders on every write and — via the compiler's dependency on the object's
// identity — so does everything it renders. Keep it at the leaves.
export function useControls(): Controls {
  const store = use(ControlStoreContext)
  return useSyncExternalStore(store.subscribe, store.get)
}

// Everything a control row needs to draw and drive itself. Read from context,
// not threaded: eleven props through every group is why the panel used to
// rebuild all 121 rows on each write just to hand them along.
//
// Every member here has to keep its identity across a control write, or this
// object doesn't either and the rows come back down with it.
export interface ControlsApi {
  // What tempo says this control is, for a clock-locked rate control; null for
  // everything else, which shows its own live value from the store. Only the
  // locked half lives here, precisely so this doesn't close over the controls.
  lockedValue: (key: ControlKey) => number | null
  writeControl: (key: ControlKey, value: number) => void
  writeControls: (controls: Controls) => void
  favorites: Set<ControlKey>
  toggleFavorite: (key: ControlKey) => void
  // MIDI accessories appear only once a device is wired up. Keyed by bind
  // target, not by control: the motion strip carries the same ⚟ affordance as a
  // control row, and it is not a control.
  midiReady: boolean
  bindLabel: (target: BindTarget) => string | null
  armed: BindTarget | null
  toggleArm: (target: BindTarget) => void
  // Where a bound knob is sitting while it hasn't caught the value yet, so the
  // row can show why it isn't responding. Undefined once the knob has it.
  pickup: (key: ControlKey) => number | undefined
  clockLive: boolean
  syncLabel: (key: ControlKey) => string | null
  cycleSync: (key: ControlKey) => void
  // Roll one group's controls around where they sit. Lives here rather than
  // being threaded as a prop for the same reason everything else does: the
  // group headers are rendered from a static table, and the row tree already
  // reads its verbs from this context.
  mutateGroup: (sliders: readonly SliderDef[], amount?: MutateAmount) => void
  // Put one group back to stock, for the same reason and by the same route.
  resetGroup: (sliders: readonly SliderDef[]) => void
  // Run a transition: break what a recipe names, swap the source on the frame
  // the picture is least legible, and heal (signal/fault.ts).
  //
  // Here for the reason `ModSlotsApi.fire` is on that API — it is an *event*
  // rather than a setting, so it goes straight to the engine instead of through
  // anything React owns — and a thin forward rather than a transition name,
  // because what to break, how long for and what the cut does are all the
  // deck's to decide and none of them are App's.
  startFault: (plan: FaultPlan) => void
}

export const ControlsContext = createContext<ControlsApi | null>(null)

export function useControlsApi(): ControlsApi {
  const api = use(ControlsContext)
  if (api === null) throw new Error('control row rendered outside the panel')
  return api
}
