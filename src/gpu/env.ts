// What the JS context the engine is running in actually has.
//
// The engine runs on the main thread, where all of this is present. This module
// exists because it is nonetheless worth asking rather than assuming, and the
// rule throughout is: each answer is the one that leaves behaviour unchanged
// where the thing does exist, and stays out of the way where it does not. An
// *absent* `document` must never read as a *hidden* one.
//
// Two things depend on that discipline today. The render loop's unit tests are
// the whole reason `renderloop.ts` can be exercised at all — they stub a
// document thin enough that half of this is missing, and the loop has to behave
// (`noDocument` in renderloop.test.ts). And a `try`-less read of `localStorage`
// is a crash in a privacy mode that has switched it off.
//
// It was originally written for a third reason — a worker-hosted engine, which
// has no `document`, no `localStorage`, and a `location` describing the worker
// script rather than the page. That work is deleted (docs/adr/0003); the
// tolerance is kept because it earns its place without it.

// The page's query string, or '' where there is no page. Gated on `document`
// rather than on `location` because every context has a `location` and only a
// page's means the session: `?dbg=`, `?gpu=` and `?debug` are properties of the
// session, and answering with some other context's URL would be worse than
// answering with nothing.
export const pageSearch = (): string =>
  typeof document === 'undefined' ? '' : location.search

// Whether this session asked for the per-frame logging. One predicate, because
// the alternative is what was here before: `pageSearch().includes('debug')`
// written out at each site that wanted it, which is both a duplicate and a
// looser test than it looks — it matches `?nodebug=1`, and any parameter whose
// *value* happens to contain the word. Reads the parameter instead, agreeing
// with the app half's `q.has('debug')` in urlParams.
//
// Every DEBUG line in the codebase is gated on this. An ungated one is a bug:
// the shipped console is where a frozen tab's diagnosis is read from, and a
// per-frame log buries it.
export const debugOn = (): boolean =>
  new URLSearchParams(pageSearch()).has('debug')

// A DEBUG line, printed only if this session asked for one. Prefer this to
// `if (debugOn()) console.log(...)` at the call site: with the gate on the
// outside it is a thing to remember, and the two lines in `videoSlot` that got
// forgotten printed at every user on every roll. The engine's own per-frame
// logs stay hand-gated, because there the point is to skip building the
// argument object at all.
export const debugLog = (...args: unknown[]): void => {
  if (debugOn()) console.log(...args)
}

// Whether the tab is on screen, and whether it has focus. The render loop uses
// both to decide if a missing rAF callback is a stall worth bridging. With no
// document there is no refresh driver to describe, so both report the state in
// which the loop simply runs — an absent page must never read as a hidden one,
// which would stand the loop down over a context that has no way to come back.
export const isVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

export const isFocused = (): boolean =>
  typeof document === 'undefined' || document.hasFocus()

export const isFullscreen = (): boolean =>
  typeof document !== 'undefined' && document.fullscreenElement !== null

// The refresh driver's own clock, or null where there is nothing to read it
// from. rAF callbacks and this advance from the same driver, so when the loop's
// rAF chains go flat this separates "the driver stopped" from "the driver is
// running and only the animation-frame callbacks are being dropped" — two
// faults that look identical from inside the page and want opposite fixes.
export const timelineNow = (): number | null => {
  if (typeof document === 'undefined') return null
  // the types say a document always has a timeline; a stubbed one disagrees
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const t = document.timeline?.currentTime ?? null
  // CSSNumberish: a number everywhere that matters, and not worth a cast.
  return typeof t === 'number' ? t : null
}

// The black-box recorder's backing store. Absent in the unit tests and in a
// privacy mode that has switched it off, which is why every call site already
// tolerates losing a write.
//
// Note the mismatch between the name and the API: this is `localStorage`, which
// is per *origin* and outlives the tab. That is what the recorder wants — a
// freeze is read back from a later session, often a later day.
// The `try` is not decoration and not the same guard as the `typeof`: with
// storage switched off at the browser level (Firefox's `dom.storage.enabled`,
// a partitioned third-party frame) the global is not *undefined* — reading it
// throws SecurityError from the getter, so `typeof` throws too. Both spellings
// of "there is no store here" have to answer null, or the recorder takes down
// the frame it was supposed to be describing.
export const sessionStore = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// Per *tab*, and the distinction is the whole point of having both. This is
// `sessionStorage`: it survives a reload of this tab, is not shared with any
// other tab on the same origin, and dies when the tab does — which is precisely
// the lifetime of the thing counted against it. See `gpuSessions` in context.ts.
export const tabStore = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
