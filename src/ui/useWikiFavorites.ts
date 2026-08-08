import { useState } from 'react'

import {
  dropFavorite,
  favoriteOf,
  isStarred,
  loadFavorites,
  saveFavorites,
  toggleFavorite,
} from './wikiFavorites'

import type { CommonsId, CommonsPick } from '../sources/commons'
import type { WikiFavorite } from './wikiFavorites'

// The starred rolls, as the app holds them: the list, and the two verbs that
// change it. Its own hook rather than more of useEngine for the reason the clip
// shelf is one — a favourite is a title until something plays it, and the only
// thing that crosses into the engine is the pick that comes back off Commons.
//
// Read once from localStorage and written through on every change: the list is
// short, a star is a deliberate single click rather than a drag, and the write
// has to survive the tab being closed straight afterwards.

export function useWikiFavorites() {
  const [faves, setFaves] = useState(loadFavorites)

  const settle = (next: WikiFavorite[]) => {
    setFaves(next)
    saveFavorites(next)
  }

  // Star what is on the slot, or unstar it if it already is. The channel comes
  // from the caller because the pick cannot know it: a favourite resolved back
  // off Commons is the same shape as a fresh roll, and by then which pool it
  // came out of is only remembered here.
  const star = (pick: CommonsPick, channel: CommonsId | '') =>
    settle(toggleFavorite(faves, favoriteOf(pick, channel)))

  const forget = (title: string) => settle(dropFavorite(faves, title))

  return {
    faves,
    star,
    forget,
    starred: (title: string) => isStarred(faves, title),
  }
}
