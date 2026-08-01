import { useState } from 'react'

import { readJSON, writeJSON } from './storage'

// The presets you actually reach for, most-recent first. Drives the shortlist
// the panel opens on, so the front door narrows to your own habits instead of
// showing all thirty-five every time.
const STORE = 'video_feedback_recent_presets'
const MAX = 8

export function useRecentPresets() {
  const [recent, setRecent] = useState<string[]>(() =>
    readJSON<string[]>(STORE, []),
  )
  // Already at the head is the common case — a drag calls this on every
  // pointer move — so bail before allocating a new array and re-rendering.
  const noteUse = (name: string) =>
    setRecent(prev => {
      if (prev[0] === name) {
        return prev
      }
      const next = [name, ...prev.filter(n => n !== name)].slice(0, MAX)
      writeJSON(STORE, next)
      return next
    })
  return { recent, noteUse }
}
