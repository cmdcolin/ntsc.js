import { createContext, use } from 'react'

import type { ControlKey, Controls } from '../controls'
import type { SliderDef } from './controls'
import type { BindTarget } from './midi'
import type { MutateAmount } from './mutate'

// Everything a control row needs to draw and drive itself. Read from context,
// not threaded: eleven props through every group is why the panel used to
// rebuild all 121 rows on each write just to hand them along.
export interface ControlsApi {
  controls: Controls
  // The value to show: a clock-locked control reads from tempo, not the store.
  displayValue: (key: ControlKey) => number
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
}

export const ControlsContext = createContext<ControlsApi | null>(null)

export function useControlsApi(): ControlsApi {
  const api = use(ControlsContext)
  if (api === null) throw new Error('control row rendered outside the panel')
  return api
}
