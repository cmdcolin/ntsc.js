// A bounded undo/redo walk over whole look snapshots.
//
// One step back was enough while every destructive action was deliberate — a
// preset, a saved-look recall. It stopped being enough once finding a look became a
// search: mutate, mutate, surprise, mutate, and the frame worth keeping is
// three steps behind the one on screen with no way back to it. So the walk is
// retraceable in both directions, which also makes a wild jitter safe to try —
// the cost of a bad roll is one keystroke, not the look you had.
//
// Pure and generic on purpose: hooks have no test tooling in this repo, and the
// interesting behaviour (dedupe, cap, when the redo tail dies) is exactly the
// part worth pinning down.

// Deep enough to cover a run of rolls, small enough that a Controls snapshot
// per entry stays free — ~130 numbers each.
export const HISTORY_MAX = 24

export interface History<T> {
  // Oldest first, so the most recent step back is the last element.
  readonly past: readonly T[]
  // Nearest first: the state undo just left, ready to be stepped back into.
  readonly future: readonly T[]
}

export const EMPTY_HISTORY: History<never> = { past: [], future: [] }

// Record the state being replaced. `same` decides what counts as no movement:
// several paths snapshot the same look on the way to one change (a preset drag
// snapshots on pointer down and again on apply), and a stack of identical
// entries turns undo into a key you have to press four times to see anything.
export function record<T>(
  h: History<T>,
  prev: T,
  same: (a: T, b: T) => boolean,
): History<T> {
  const top = h.past.at(-1)
  if (top !== undefined && same(top, prev)) {
    // Still a new branch: the redo tail belonged to a walk this write leaves.
    return h.future.length === 0 ? h : { past: h.past, future: [] }
  }
  return { past: [...h.past, prev].slice(-HISTORY_MAX), future: [] }
}

// Step back. `current` is the live state, which becomes the head of the redo
// tail — the caller owns it (the engine is the store), so it is passed in
// rather than kept here and allowed to drift.
export function stepBack<T>(
  h: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const value = h.past.at(-1)
  if (value === undefined) return null
  return {
    history: { past: h.past.slice(0, -1), future: [current, ...h.future] },
    value,
  }
}

export function stepForward<T>(
  h: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const [value, ...rest] = h.future
  if (value === undefined) return null
  return {
    history: { past: [...h.past, current].slice(-HISTORY_MAX), future: rest },
    value,
  }
}
