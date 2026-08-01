import { createContext, use } from 'react'

import type { ControlKey, Controls } from '../controls'

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
  // MIDI accessories appear only once a device is wired up.
  midiReady: boolean
  bindLabel: (key: ControlKey) => string | null
  armedKey: ControlKey | null
  toggleArm: (key: ControlKey) => void
  clockLive: boolean
  syncLabel: (key: ControlKey) => string | null
  cycleSync: (key: ControlKey) => void
}

export const ControlsContext = createContext<ControlsApi | null>(null)

export function useControlsApi(): ControlsApi {
  const api = use(ControlsContext)
  if (api === null) throw new Error('control row rendered outside the panel')
  return api
}
