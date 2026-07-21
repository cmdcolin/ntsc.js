import { useEffect, useState } from 'react'
import type { ControlKey, Controls } from '../controls'
import { SYNC_DIVISIONS, omit, syncedValue } from './midi'
import { readJSON, writeJSON } from './storage'

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
  // engine (and MIDI takeover state) whenever the rendered value changes.
  const wipeRateValue = displayValue('wipeRate')
  const bLineHzValue = displayValue('bLineHz')
  useEffect(
    () => writeControl('wipeRate', wipeRateValue),
    [writeControl, wipeRateValue],
  )
  useEffect(
    () => writeControl('bLineHz', bLineHzValue),
    [writeControl, bLineHzValue],
  )

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
