import { useEffect, useState } from 'react'

import {
  EMPTY_SLOT,
  normalizeSlots,
  routingsToSlots,
  toEngineSlots,
  withNextSync,
} from './modSlots'
import { readArray, readJSON, writeJSONSoon } from './storage'
import { parseSessionParams } from './urlParams'

import type { ControlKey } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type { UiSlot } from './modSlots'
import type { ModSlotsApi } from './ModSlotsContext'
import type { Tempo } from './useTempo'

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
  const stored = normalizeSlots(readArray<unknown>(MOD_STORE, []))
  const fromLink = parseSessionParams(location.search).mod
  if (fromLink === null) return stored
  // …except for the run switches, which the link does not carry and must not
  // clear. `?mod=` is written on every change, so without this a reload of your
  // own tab would arrive with every parked routing running again — and worse,
  // the park would look like it had thrown the patch away. Matched by target,
  // not by position: the link decides where the routings sit.
  const parked = new Set(
    stored.flatMap(s => (s.target !== '' && !s.on ? [s.target] : [])),
  )
  return routingsToSlots(fromLink).map(s =>
    s.target !== '' && parked.has(s.target) ? { ...s, on: false } : s,
  )
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

export function useModSlots(
  engine: EngineApi | null,
  tempo: Tempo,
): ModSlotsApi {
  const [slots, setSlotsState] = useState<readonly UiSlot[]>(loadSlots)
  const [master, setMasterState] = useState<number>(loadMaster)

  // A locked slot's rate is resolved here, per render, rather than written into
  // the bay: the tempo is what moves, and the effect below already pushes the
  // list to the engine whenever anything in it changes — so a clock speeding up
  // carries every locked wobble with it without a single write to storage.
  const active = toEngineSlots(slots, master, tempo.bpm)

  // Pushed from an effect rather than from each setter: the engine arrives
  // asynchronously, so a bay patched (or a link parsed) before it exists still
  // has to reach it once it does.
  useEffect(() => {
    engine?.setModSlots(active)
  }, [engine, active])

  // Coalesced: a depth or rate slider in the row editor calls this on every
  // pointer move, and a synchronous localStorage write per frame of a drag is
  // paid on the thread that is also feeding the GPU.
  const commit = (next: readonly UiSlot[]) => {
    writeJSONSoon(MOD_STORE, next)
    setSlotsState(next)
  }

  const indexFor = (key: ControlKey) => slots.findIndex(s => s.target === key)

  // Dragged too — the motion amount is a fader, not a toggle.
  const writeMaster = (v: number) => {
    writeJSONSoon(MASTER_STORE, v)
    setMasterState(v)
  }

  // Off → 1/1 → … → 1/16 → off, for the slot at `i`. Rendered from the same
  // SYNC_DIVISIONS the control rows walk, so "1/4" means one cycle per quarter
  // note wherever it is written in the panel.
  //
  // `ensure` is the half that makes the button do something on a machine with
  // no clock on the wire: the lock is being asked for, so a tempo appears for it
  // to read rather than a ♩ that lights up and changes nothing.
  const cycleAt = (i: number) => {
    const next = withNextSync(slots[i])
    commit(slots.map((s, j) => (j === i ? next : s)))
    // Only on the way in — landing back on a free-running rate is not a request
    // for a beat, so switching the last division off cannot leave a tempo behind
    // in a session that never had one.
    if (next.syncDiv !== undefined) tempo.ensure()
  }

  return {
    slots,
    bpm: tempo.bpm,
    active,
    master,
    setMaster: writeMaster,
    setSlot: (i, patch) =>
      commit(slots.map((s, j) => (j === i ? { ...s, ...patch } : s))),
    cycleSlotSync: cycleAt,
    cycleSyncForKey: key => {
      const at = indexFor(key)
      if (at !== -1) cycleAt(at)
    },
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
      const claiming = at === -1
      const index = claiming ? slots.findIndex(s => s.target === '') : at
      if (index === -1) return
      commit(
        slots.map((s, j) =>
          j === index
            ? // A fresh claim always runs; a patch to an existing routing keeps
              // the switch where it is, so changing a parked routing's rate from
              // the editor doesn't quietly start it up again.
              { ...s, ...routing, target: key, on: claiming ? true : s.on }
            : s,
        ),
      )
      // Patching while the motion amount is at zero would otherwise be silent:
      // the row lights up as driven and the picture does not move. Asking for a
      // wobble is unambiguous, and a freeze is a gesture within a set rather
      // than a setting, so the ask wins.
      if (master === 0) writeMaster(1)
    },
    setSlotOn: (key, on) => {
      const at = indexFor(key)
      if (at === -1) return
      commit(slots.map((s, j) => (j === at ? { ...s, on } : s)))
      // Same rule the claim above follows, and for the same reason: starting a
      // routing while the whole bay is frozen would light the row up and move
      // nothing at all.
      if (on && master === 0) writeMaster(1)
    },
  }
}
