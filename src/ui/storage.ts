import { useState } from 'react'

// Parsed contents of a key, or undefined when absent or unparseable.
function parseStored(key: string): unknown {
  const raw = localStorage.getItem(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

// Read a JSON-encoded value from localStorage, falling back when it's absent or
// unparseable — a corrupt or stale-schema value should reset to the default, not
// throw out of the mount-time loaders that read it and crash the whole app.
//
// Note this only guards *parsing*: the value's shape is asserted, not checked.
// Callers that go on to index, spread or iterate the result want readArray or
// readRecord below, which check the shape the call site actually depends on.
export function readJSON<T>(key: string, fallback: T): T {
  const v = parseStored(key)
  return v === undefined ? fallback : (v as T)
}

// A stored JSON array. A stale-schema value of some other shape falls back
// rather than throwing where the caller filters, spreads, or builds a Set from
// it. Element types are still trusted — this closes the crash, not every lie.
export function readArray<T>(key: string, fallback: T[]): T[] {
  const v = parseStored(key)
  return Array.isArray(v) ? (v as T[]) : fallback
}

// A stored JSON object. Guards null and arrays too: `typeof null === 'object'`,
// and indexing a stored `null` throws at the call site exactly like a bad parse.
export function readRecord<T extends object>(key: string, fallback: T): T {
  const v = parseStored(key)
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as T)
    : fallback
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
