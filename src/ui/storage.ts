import { useState } from 'react'

// The raw string under a key, or null for absent — and for "there is no store
// here to read". `getItem` is not only a lookup: where the browser has storage
// switched off, touching `localStorage` at all throws SecurityError from the
// global's getter. That lands in `useState(() => …)` at mount, which is the
// precise crash the doc comment below is about, so the guard belongs under
// every read and not only the parsed ones.
//
// Exported for the two flags that are plain strings rather than JSON — the MIDI
// opt-in and the signed-in hint — which read them outside a hook and so cannot
// go through `usePersistedFlag`. They used to touch the global directly, which
// is the one spelling of a read this module exists to stop: both run from an
// effect body, and a SecurityError there is thrown during commit, so a browser
// with storage switched off lost the whole tree rather than one flag.
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// Parsed contents of a key, or undefined when absent or unparseable.
function parseStored(key: string): unknown {
  const raw = readStored(key)
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see doc comment above
  return v === undefined ? fallback : (v as T)
}

// A stored JSON array. A stale-schema value of some other shape falls back
// rather than throwing where the caller filters, spreads, or builds a Set from
// it. Element types are still trusted — this closes the crash, not every lie.
export function readArray<T>(key: string, fallback: T[]): T[] {
  const v = parseStored(key)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see doc comment above
  return Array.isArray(v) ? (v as T[]) : fallback
}

// A stored JSON object. Guards null and arrays too: `typeof null === 'object'`,
// and indexing a stored `null` throws at the call site exactly like a bad parse.
export function readRecord<T extends object>(key: string, fallback: T): T {
  const v = parseStored(key)
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see doc comment above
      (v as T)
    : fallback
}

// Whether the "storage is gone" line has been said. Once per session, not once
// per write: on a browser with storage blocked *every* write fails, and this
// app writes on drags, so the honest report is one line and not a flood.
let warnedUnavailable = false

// Every write goes through here. `localStorage.setItem` throws two ways that
// have nothing to do with this app's data — QuotaExceededError when the origin
// is full, and SecurityError where the browser has storage switched off
// (Safari's private mode, "block all cookies", a partitioned third-party frame)
// — and both take down the call site, which is a click handler, a pointer move,
// or the pagehide flush.
//
// The reads above already refuse to throw for the same reason; a write has even
// less claim to. All that is lost when one fails is durability, which was
// best-effort to begin with: the state itself is in React and the session
// carries on intact, one refresh away from stock.
function tryWrite(run: () => void): void {
  try {
    run()
  } catch (e) {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn(
        'localStorage unavailable — this session will not persist',
        e,
      )
    }
  }
}

export function writeJSON(key: string, value: unknown) {
  tryWrite(() => localStorage.setItem(key, JSON.stringify(value)))
}

// Forget a key. Guarded like the writes, and exported so no caller has to reach
// for `localStorage` directly and rediscover that removeItem throws too.
export function removeStored(key: string) {
  tryWrite(() => localStorage.removeItem(key))
}

// Write a bare string — for the flags and hints that were never JSON. Same
// guard; the point of having it here is that the try/catch is written once.
export function writeString(key: string, value: string) {
  tryWrite(() => localStorage.setItem(key, value))
}

// The same write, coalesced — for state a *drag* changes, where the setter runs
// once per pointer move. `localStorage.setItem` is synchronous and serializes
// on the main thread, so sixty of them a second lands on the same thread that
// is feeding the GPU. Same trade the address bar makes in useUrlState: state
// updates immediately, the durable copy catches up when the value settles.
const pending = new Map<string, unknown>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function flushWrites() {
  for (const [key, value] of pending) writeJSON(key, value)
  pending.clear()
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
}

// A tab can be discarded without ever firing `unload`, and on mobile usually
// is; `pagehide` is the one that reliably arrives. Registered once, at module
// load, so no caller has to remember it.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrites)
}

export function writeJSONSoon(key: string, value: unknown, ms = 300) {
  pending.set(key, value)
  const existing = timers.get(key)
  if (existing !== undefined) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const v = pending.get(key)
      pending.delete(key)
      writeJSON(key, v)
    }, ms),
  )
}

// What a stored flag says, or `fallback` where nothing is stored.
//
// `fallback` is not a nicety: most of these are opt-in and start off, but a flag
// that switches off behaviour the app has always had has to start *on*, or
// shipping it silently changes the app for everyone who has never opened the
// switch. Absent and '0' have to stay different answers for that, which is why
// this reads the raw string instead of comparing against '1'.
//
// Exported for the readers outside React — the one that matters is the reload
// switch, written by a toggle in the Advanced dialog and read once at boot by
// `useEngine`, in two files that would otherwise agree only by convention (see
// fileStash's `reopensOnLoad`). Sharing the reader is what makes them agree by
// construction instead.
export function storedFlag(key: string, fallback: boolean): boolean {
  const raw = readStored(key)
  return raw === null ? fallback : raw === '1'
}

// A boolean flag persisted across reloads (stored as '1'/'0'). The setter writes
// through, so a toggle survives a refresh without any extra effect wiring.
export function usePersistedFlag(key: string, fallback = false) {
  const [on, setOn] = useState(() => storedFlag(key, fallback))
  const set = (next: boolean) => {
    setOn(next)
    writeString(key, next ? '1' : '0')
  }
  return [on, set] as const
}

// A nullable string persisted across reloads — null clears the key, so absent
// and "nothing selected" are the same state rather than two.
export function usePersistedString(key: string) {
  const [value, setValue] = useState(() => readStored(key))
  const set = (next: string | null) => {
    setValue(next)
    if (next === null) removeStored(key)
    else writeString(key, next)
  }
  return [value, set] as const
}
