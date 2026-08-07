import { useState } from 'react'

import { loadLooks, removeLook, storeLooks, upsertLook } from './savedLooks'

import type { SavedLook } from './savedLooks'

// The saved-look library, persisted. Every write re-reads the store first rather
// than editing the copy React is holding: this is the one panel state a second
// tab is likely to be editing too, and a save built off stale state would drop
// whatever the other tab had added since this one loaded.
//
// `lastName` is the other half — the saved look this session is *working in*,
// set by a save and by a recall. It is what the name box offers next, and it is
// held here rather than inside the menu because the ⌘K row that saves without
// opening the menu has to offer the same name the menu would.
export function useSavedLooks() {
  const [looks, setLooks] = useState<SavedLook[]>(loadLooks)
  const [lastName, setLastName] = useState<string | null>(null)
  const persist = (next: SavedLook[]) => {
    storeLooks(next)
    setLooks(next)
  }
  return {
    looks,
    lastName,
    saveLook: (name: string, query: string) => {
      persist(upsertLook(loadLooks(), name, query))
      setLastName(name)
    },
    // A recall makes that look the one you are in, so the next save offers its
    // name (with a counter) rather than falling back to whichever preset the
    // controls happen to still match.
    markRecalled: setLastName,
    deleteLook: (name: string) => {
      persist(removeLook(loadLooks(), name))
      // Deleting the look you were in frees its name again: the next save
      // should offer "my rig", not "my rig 2" against a row that is gone.
      setLastName(cur => (cur === name ? null : cur))
    },
  }
}
