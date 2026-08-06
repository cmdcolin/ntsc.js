import { createContext, use } from 'react'

import type { ControlKey, ModSlot } from '../controls'
import type { ModRouting, UiSlot } from './modSlots'

// The modulation bay, read by anything that needs to know what is moving: the
// Modulation section, the ∿ on every control row, the motion strip.
//
// A separate context from ControlsContext on purpose. Both change identity when
// their state changes, and the two move on completely different clocks — a
// slider drag writes controls on every pointer move, while the bay changes when
// someone patches it. Sharing one context would rebuild every mounted row on
// each drag frame for the sake of a routing that didn't move.
export interface ModSlotsApi {
  // All N_SLOTS of them, positional: index is the slot number on screen, and
  // the identity ModState keys a wave's phase and noise seed by.
  slots: readonly UiSlot[]
  // The same bay as the render loop sees it — compacted, scaled by the motion
  // amount, ranges attached. What the section dot and the strip count.
  active: readonly ModSlot[]
  // One scale over every depth: the motion amount. 0 freezes (and holds phase),
  // 1 is what each slot's own depth says.
  master: number
  setMaster: (v: number) => void
  // Positional edit, from the Modulation section's own rows.
  setSlot: (i: number, patch: Partial<UiSlot>) => void
  // Whole-bay restore, positions kept, so undo resumes phases rather than
  // reseeding them.
  setSlots: (next: readonly UiSlot[]) => void
  // Replace every routing: a preset applied outright, or a link arriving.
  setRoutings: (mod: readonly ModRouting[]) => void
  // The slot driving this control, if one is. Duplicate targets are possible
  // (the section can point two slots at one control) — this addresses the
  // first, which is the one the row's ∿ then edits.
  modFor: (key: ControlKey) => UiSlot | null
  // Patch the slot driving `key` in place (so its phase carries), or claim the
  // first free one. With every slot busy and none of them this control's, it is
  // a no-op: the row gates on `slots` and says who is holding them rather than
  // silently evicting someone else's routing. null clears.
  setSlotForKey: (
    key: ControlKey,
    routing: Omit<ModRouting, 'target'> | null,
  ) => void
  // Park or restart the routing driving `key`, keeping what it is patched with.
  // The one-click "off" a set needs: `setSlotForKey(key, null)` is the other
  // kind of off — it hands the slot back and the patch with it. A no-op when
  // nothing is driving the control.
  setSlotOn: (key: ControlKey, on: boolean) => void
}

export const ModSlotsContext = createContext<ModSlotsApi | null>(null)

export function useModSlotsApi(): ModSlotsApi {
  const api = use(ModSlotsContext)
  if (api === null) throw new Error('modulation read outside the panel')
  return api
}
