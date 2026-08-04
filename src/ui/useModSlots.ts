import { useEffect, useState } from 'react'

import {
  EMPTY_SLOT,
  normalizeSlots,
  routingsToSlots,
  toEngineSlots,
} from './modSlots'
import { readArray, readJSON, writeJSON } from './storage'
import { parseSessionParams } from './urlParams'

import type { ControlKey } from '../controls'
import type { Engine } from '../gpu/pipeline'
import type { UiSlot } from './modSlots'
import type { ModSlotsApi } from './ModSlotsContext'

const MOD_STORE = 'video_feedback_mod'
const MASTER_STORE = 'video_feedback_motion'

// React owns the bay; the engine is written to, never read from. `setModSlots`
// takes a list and applies it per frame around its own controls with a restore,
// so nothing it does comes back out through `getControls` — which is exactly
// why the state has to live here rather than being mirrored from the engine.
function loadSlots(): UiSlot[] {
  // A link's routings beat the stored bay, and the address bar still holds them
  // at first render: useUrlState's rewrite is gated on the engine existing and
  // debounced behind it, so nothing has overwritten the query yet.
  const fromLink = parseSessionParams(location.search).mod
  return fromLink === null
    ? normalizeSlots(readArray<unknown>(MOD_STORE, []))
    : routingsToSlots(fromLink)
}

// Deliberately not on the URL: the routing is the look, the gesture is not.
// Sharing a link that pins someone else's motion amount to whatever it happened
// to be when they copied it would hand them a still picture as often as not.
const loadMaster = (): number => {
  const v = readJSON<unknown>(MASTER_STORE, 1)
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : 1
}

export function useModSlots(engine: Engine | null): ModSlotsApi {
  const [slots, setSlotsState] = useState<readonly UiSlot[]>(loadSlots)
  const [master, setMasterState] = useState<number>(loadMaster)

  const active = toEngineSlots(slots, master)

  // Pushed from an effect rather than from each setter: the engine arrives
  // asynchronously, so a bay patched (or a link parsed) before it exists still
  // has to reach it once it does.
  useEffect(() => {
    engine?.setModSlots(active)
  }, [engine, active])

  const commit = (next: readonly UiSlot[]) => {
    writeJSON(MOD_STORE, next)
    setSlotsState(next)
  }

  const indexFor = (key: ControlKey) => slots.findIndex(s => s.target === key)

  const writeMaster = (v: number) => {
    writeJSON(MASTER_STORE, v)
    setMasterState(v)
  }

  return {
    slots,
    active,
    master,
    setMaster: writeMaster,
    setSlot: (i, patch) =>
      commit(slots.map((s, j) => (j === i ? { ...s, ...patch } : s))),
    setSlots: next => commit(normalizeSlots(next)),
    setRoutings: mod => commit(routingsToSlots(mod)),
    modFor: key => slots.find(s => s.target === key) ?? null,
    setSlotForKey: (key, routing) => {
      const at = indexFor(key)
      if (routing === null) {
        // Blanked in place rather than removed: the slot number is the phase's
        // identity, and shuffling the bay to close a gap would restart every
        // routing below it.
        if (at !== -1) commit(slots.map((s, j) => (j === at ? EMPTY_SLOT : s)))
        return
      }
      const free = at === -1 ? slots.findIndex(s => s.target === '') : at
      if (free === -1) return
      commit(
        slots.map((s, j) =>
          j === free ? { ...s, ...routing, target: key } : s,
        ),
      )
      // Patching while the motion amount is at zero would otherwise be silent:
      // the row lights up as driven and the picture does not move. Asking for a
      // wobble is unambiguous, and a freeze is a gesture within a set rather
      // than a setting, so the ask wins.
      if (master === 0) writeMaster(1)
    },
  }
}
