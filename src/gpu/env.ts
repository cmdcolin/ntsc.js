// What the JS context the engine is running in actually has.
//
// The engine currently runs on the main thread, where all of this is present.
// It is written this way so it can also run inside a worker, which is the one
// place the render loop stops competing with React, video staging and the
// browser's own layout work for the thread that delivers frames — measured on
// Firefox Nightly with the real signal path, a worker-owned loop held 60 fps
// with zero dropped frames under a main-thread load that dragged the same
// engine down to 43 fps and 100 ms stalls.
//
// A worker has no `document`, no `localStorage`, and a `location` describing the
// worker script rather than the page. None of those absences mean anything is
// wrong, so each answer below is the one that leaves behaviour unchanged where
// the thing does exist, and stays out of the way where it does not.

// The page's query string, or '' where there is no page. Everything that reads
// it (`?dbg=`, `?gpu=`, `?debug`) is a property of the session, so in a worker
// it has to arrive by message rather than be read from the worker's own URL —
// reading `location.search` there would silently return the script's.
let injectedSearch: string | null = null

export const pageSearch = (): string =>
  injectedSearch ?? (typeof document === 'undefined' ? '' : location.search)

// How a worker learns the page's query string: it is told, once, before the
// engine is built. Reading `location.search` there would answer with the worker
// script's own URL, and `?dbg=` / `?gpu=` / `?debug` are properties of the
// session rather than of whichever thread happens to be running the engine.
export function setPageSearch(search: string): void {
  injectedSearch = search
}

// Whether the tab is on screen, and whether it has focus. The render loop uses
// both to decide if a missing rAF callback is a stall worth bridging. Both
// describe the *page's* refresh driver, which is exactly the dependency a
// worker-owned loop sheds — so with no document, report the state in which the
// loop simply runs.
export const isVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

export const isFocused = (): boolean =>
  typeof document === 'undefined' || document.hasFocus()

export const isFullscreen = (): boolean =>
  typeof document !== 'undefined' && document.fullscreenElement !== null

// The black-box recorder's backing store. Absent in a worker, and absent in the
// unit tests, which is why every call site already tolerates losing a write.
export const sessionStore = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage
