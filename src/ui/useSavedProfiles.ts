import { useState } from 'react'

import {
  loadProfiles,
  removeProfile,
  storeProfiles,
  upsertProfile,
} from './savedProfiles'

import type { SavedProfile } from './savedProfiles'

// The saved-profile library, persisted. Every write re-reads the store first rather
// than editing the copy React is holding: this is the one panel state a second
// tab is likely to be editing too, and a save built off stale state would drop
// whatever the other tab had added since this one loaded.
//
// `lastName` is the other half — the profile this session is *working in*, set by
// a save and by a recall. It is what the name box offers next, and it is held
// here rather than inside the menu because ctrl+S and the ⌘K row, which save
// without opening the menu, have to offer the same name the menu would.
export function useSavedProfiles() {
  const [profiles, setProfiles] = useState<SavedProfile[]>(loadProfiles)
  const [lastName, setLastName] = useState<string | null>(null)
  // The name a save just landed under, for a second. Two of the three ways to
  // save (ctrl+S, the ⌘K row) happen with the menu shut, where the row appearing
  // in the list is feedback nobody is looking at — so the button says it instead.
  // Held here rather than in the menu for the same reason `lastName` is: the
  // paths that save without opening it have to light it up too.
  const [saved, setSaved] = useState<string | null>(null)
  const persist = (next: SavedProfile[]) => {
    storeProfiles(next)
    setProfiles(next)
  }
  return {
    profiles,
    lastName,
    saved,
    saveProfile: (name: string, query: string) => {
      persist(upsertProfile(loadProfiles(), name, query))
      setLastName(name)
      setSaved(name)
      setTimeout(() => setSaved(cur => (cur === name ? null : cur)), 1600)
    },
    // A recall makes that profile the one you are in, so the next save offers
    // its name (with a counter) rather than falling back to whichever preset the
    // controls happen to still match.
    markRecalled: setLastName,
    deleteProfile: (name: string) => {
      persist(removeProfile(loadProfiles(), name))
      // Deleting the profile you were in frees its name again: the next save
      // should offer "my rig", not "my rig 2" against a row that is gone.
      setLastName(cur => (cur === name ? null : cur))
    },
  }
}
