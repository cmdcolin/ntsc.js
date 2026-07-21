import { useState } from 'react'

// Read a JSON-encoded value from localStorage, falling back when it's absent or
// unparseable — a corrupt or stale-schema value should reset to the default, not
// throw out of the mount-time loaders that read it and crash the whole app.
export function readJSON<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// A boolean flag persisted across reloads (stored as '1'/'0'). The setter writes
// through, so a toggle survives a refresh without any extra effect wiring.
export function usePersistedFlag(key: string) {
  const [on, setOn] = useState(() => localStorage.getItem(key) === '1')
  const set = (next: boolean) => {
    setOn(next)
    localStorage.setItem(key, next ? '1' : '0')
  }
  return [on, set] as const
}
