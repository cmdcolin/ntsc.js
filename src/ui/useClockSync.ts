import { useEffect, useState } from 'react'

import { SYNCABLE_KEYS, SYNC_DIVISIONS, omit, syncedValue } from './midi'
import { readJSON, writeJSON } from './storage'

import type { ControlKey, Controls } from '../controls'

// Which rate controls are clock-locked, and to which SYNC_DIVISIONS index.
type SyncMap = Partial<Record<ControlKey, number>>
const SYNC_STORE = 'video_feedback_midi_sync'
const loadSync = () => readJSON<SyncMap>(SYNC_STORE, {})

// Clock lock: a locked rate control's value is a pure function of tempo and
// division, so it's derived during render rather than stored. This owns the map
// of locks and pushes each locked value out to the engine when it changes.
export function useClockSync(args: {
  controls: Controls
  bpm: number | null
  writeControl: (key: ControlKey, value: number) => void
}) {
  const { controls, bpm, writeControl } = args
  const [syncMap, setSyncMap] = useState<SyncMap>(loadSync)

  const syncLabel = (key: ControlKey): string | null => {
    const div = syncMap[key]
    return div === undefined ? null : SYNC_DIVISIONS[div].label
  }

  const displayValue = (key: ControlKey): number => {
    const div = syncMap[key]
    return div !== undefined && bpm !== null
      ? syncedValue(key, bpm, SYNC_DIVISIONS[div].beats)
      : controls[key]
  }

  // The one genuine synchronization: push each locked value to the external GPU
  // engine (and MIDI takeover state) whenever the rendered value changes. Driven
  // off SYNCABLE_KEYS rather than one effect per key, so adding a key there
  // can't leave a control that shows the ♩ lock but never reaches the engine.
  const syncedValues = SYNCABLE_KEYS.map(k => displayValue(k))
  // The joined values are the dep, not the array: a fresh array identity every
  // render would re-fire this and reset MIDI soft-takeover constantly.
  const syncedDep = syncedValues.join(',')
  useEffect(() => {
    SYNCABLE_KEYS.forEach((key, i) => writeControl(key, syncedValues[i]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeControl, syncedDep])

  // Cycle a control through off → each division → off, persisting the choice.
  const cycleSync = (key: ControlKey) => {
    setSyncMap(prev => {
      const cur = prev[key]
      const nextIdx = cur === undefined ? 0 : cur + 1
      const next =
        nextIdx >= SYNC_DIVISIONS.length
          ? omit(prev, key)
          : { ...prev, [key]: nextIdx }
      writeJSON(SYNC_STORE, next)
      return next
    })
  }

  return { cycleSync, syncLabel, displayValue }
}
