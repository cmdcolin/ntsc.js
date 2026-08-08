import type { ControlKey } from '../controls'
import type { SliderDef } from './controls'

// Derived lists, handed back with the identity they had the last time the same
// members came through.
//
// The panel derives lists from the controls on every render — "every slider
// this look has moved", "which gates are shut behind a banner" — and each one
// is a fresh array or Set even when nothing about it changed. Handed to a row
// as a prop, that fresh identity re-renders the row, which is how a write to
// one control ended up rebuilding every row under the list. The members change
// far more rarely than the values do, so keying on the members is enough.
//
// Module-level rather than a ref or a hook: the identity has to survive the
// component that derived it re-rendering, and the same list derived in the
// docked panel and in the popout window should be the same list.

// Bounded, because a session that mutates its way through hundreds of distinct
// edit sets should not accumulate an entry per set. Cleared wholesale rather
// than evicted one at a time: a clear costs one rebuild, and the alternative is
// LRU bookkeeping on the hot path to save it.
//
// Well clear of the standing set, which is the two row lists each of the ~50
// groups holds plus their filtered variants — a ceiling that thrashed would be
// worse than no cache at all, since every clear rebuilds every row.
const LIMIT = 512

function keep<T>(store: Map<string, T>, key: string, build: () => T): T {
  const hit = store.get(key)
  if (hit !== undefined) return hit
  if (store.size >= LIMIT) store.clear()
  const made = build()
  store.set(key, made)
  return made
}

const LISTS = new Map<string, readonly SliderDef[]>()

// Slider defs are static, so two lists with the same keys in the same order are
// interchangeable — this returns whichever one arrived first.
export function sameList(list: readonly SliderDef[]): readonly SliderDef[] {
  return keep(LISTS, list.map(s => s.key).join(' '), () => list)
}

const KEY_SETS = new Map<string, ReadonlySet<ControlKey>>()

export function sameKeySet(
  keys: readonly ControlKey[],
): ReadonlySet<ControlKey> {
  return keep(KEY_SETS, keys.join(' '), () => new Set(keys))
}
