import { readArray, writeJSON } from './storage'

// Named saves of the whole board, the way a synth saves a voice: dial something
// in, give it a name, get it back later.
//
// The stored form is a query string — the same one the address bar carries, from
// the same writer (writeLookParams). That is deliberate, and it is the one
// decision here worth defending:
//
//   - It is already the app's serialization of a session, tested, and read back
//     by a parser that drops anything it no longer recognises. A saved look that
//     outlives a renamed control loses that knob rather than failing to load —
//     the property that matters most for something meant to be kept.
//   - It makes a saved look shareable for free: prefix the origin and it is a
//     link, so "send someone this look" needs no second format.
//
// The alternative — storing resolved controls like Scenes does — would need its
// own migration story for every field that is not a control (motion, the vapor
// speeds, which source), and would still have to grow a serializer the day
// somebody wanted to send one to a friend.
//
// Scenes stay what they were: nine numbered slots on the 1–9 keys, for a live
// set where recall has to be one keystroke and naming things is a distraction.
// These are the library — unbounded, named, and no keys.
export interface SavedLook {
  name: string
  query: string
}

const LOOKS_STORE = 'video_feedback_looks'

// The longest name a row will hold before the popover starts wrapping. Trimmed
// rather than refused: a paste of a whole sentence should become a name, not an
// error message.
export const LOOK_NAME_MAX = 40

// Collapse the whitespace a paste brings with it, and cap the length. An empty
// result means "no name given", which the caller declines to save.
export const cleanLookName = (raw: string): string =>
  raw.replaceAll(/\s+/g, ' ').trim().slice(0, LOOK_NAME_MAX).trim()

// One stored entry, or undefined when it is not one. Both fields have to be
// strings: the name is rendered and the query is handed to URLSearchParams, and
// a stale-schema value of some other shape would throw at whichever came first.
function readLook(raw: unknown): SavedLook | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const name = 'name' in raw ? raw.name : undefined
  const query = 'query' in raw ? raw.query : undefined
  if (typeof name !== 'string' || typeof query !== 'string') return undefined
  const clean = cleanLookName(name)
  return clean === '' ? undefined : { name: clean, query }
}

export const readLooks = (raw: unknown[]): SavedLook[] =>
  raw.flatMap(v => {
    const look = readLook(v)
    return look === undefined ? [] : [look]
  })

export const loadLooks = (): SavedLook[] =>
  readLooks(readArray<unknown>(LOOKS_STORE, []))

export const storeLooks = (looks: readonly SavedLook[]) =>
  writeJSON(LOOKS_STORE, looks)

// Save under a name, replacing any look already using it **in place**. Order is
// insertion order and a re-save does not disturb it: the list is read by eye
// during a set, and a save that reshuffled everything above it would cost the
// one thing a library of looks is for.
export function upsertLook(
  looks: readonly SavedLook[],
  name: string,
  query: string,
): SavedLook[] {
  const clean = cleanLookName(name)
  if (clean === '') return [...looks]
  const at = looks.findIndex(l => l.name === clean)
  const entry = { name: clean, query }
  if (at === -1) return [...looks, entry]
  return looks.map((l, i) => (i === at ? entry : l))
}

export const removeLook = (
  looks: readonly SavedLook[],
  name: string,
): SavedLook[] => looks.filter(l => l.name !== name)

// What the name box offers, so saving is type-nothing-and-press-save. `base` is
// whatever the board is already called — the active preset, or the last one
// edited — and the counter only appears once that name is taken, so the first
// save off a preset is just its name.
export function suggestLookName(
  looks: readonly SavedLook[],
  base: string,
): string {
  const clean = cleanLookName(base)
  const stem = clean === '' ? 'look' : clean
  if (!looks.some(l => l.name === stem)) return stem
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} ${n}`
    if (!looks.some(l => l.name === candidate)) return candidate
  }
  return stem
}
