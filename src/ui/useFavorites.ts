import { useState } from 'react'
import type { ControlKey } from '../controls'
import { readJSON, writeJSON } from './storage'

// Sliders the user has pinned to the Favorites section, by control key. Stored
// as a plain key list so a reload keeps the pins.
const FAVORITES_STORE = 'video_feedback_favorites'
const loadFavorites = () => new Set(readJSON<ControlKey[]>(FAVORITES_STORE, []))

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<ControlKey>>(loadFavorites)
  const toggleFavorite = (key: ControlKey) =>
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeJSON(FAVORITES_STORE, [...next])
      return next
    })
  return { favorites, toggleFavorite }
}
