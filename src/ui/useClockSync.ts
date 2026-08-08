import { useEffect, useState } from 'react'

import { SYNCABLE_KEYS, SYNC_DIVISIONS, omit, syncedValue } from './midi'
import { readRecord, writeJSON } from './storage'

import type { ControlKey, Controls } from '../controls'

// Which rate controls are clock-locked, and to which SYNC_DIVISIONS index.
type SyncMap = Partial<Record<ControlKey, number>>
const SYNC_STORE = 'video_feedback_midi_sync'

// Drop any lock whose division a shortened SYNC_DIVISIONS no longer has: every
// read below indexes straight into that list, so a stale index would throw on
// the first render rather than degrade to unlocked.
const loadSync = (): SyncMap => {
  const stored = readRecord<SyncMap>(SYNC_STORE, {})
  const out: SyncMap = {}
  for (const [k, div] of Object.entries(stored))
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries widens to string; stored's keys are already ControlKey
    if (div >= 0 && div < SYNC_DIVISIONS.length) out[k as ControlKey] = div
  return out
}

// Clock lock: a locked rate control's value is a pure function of tempo and
// division, so it's derived during render rather than stored. This owns the map
// of locks and pushes each locked value out to the engine when it changes.
export function useClockSync(args: {
  controls: Controls
  bpm: number | null
  // Called when a lock is switched on, to make sure there is a tempo for it to
  // read: see Tempo.ensure. Without it the ♩ was a control that did nothing at
  // all unless something on the wire happened to be sending clock.
  ensureTempo: () => void
  writeControl: (key: ControlKey, value: number) => void
}) {
  const { controls, bpm, ensureTempo, writeControl } = args
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
  //
  // Only the locked ones: an unlocked key's displayValue IS the live control, so
  // writing it back is a no-op that still drops its MIDI soft-takeover — a knob
  // on wipeRate losing its catch every time the *other* syncable key moved.
  const locked = SYNCABLE_KEYS.filter(k => syncMap[k] !== undefined)
  const lockedValues = locked.map(k => displayValue(k))
  // The joined values are the dep, not the array: a fresh array identity every
  // render would re-fire this and reset MIDI soft-takeover constantly.
  const lockedDep = `${locked.join(',')}=${lockedValues.join(',')}`
  useEffect(() => {
    locked.forEach((key, i) => writeControl(key, lockedValues[i]))
    // oxlint-disable-next-line react/exhaustive-deps
  }, [writeControl, lockedDep])

  // Cycle a control through off → each division → off, persisting the choice.
  const cycleSync = (key: ControlKey) => {
    // Only on the way in: landing back on "off" is not a request for a beat, and
    // a session that has never had one should not acquire a tempo by switching
    // the last division off again.
    const set = syncMap[key]
    if (set === undefined || set + 1 < SYNC_DIVISIONS.length) ensureTempo()
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
