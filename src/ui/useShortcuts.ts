import { useEffect, useRef } from 'react'

// The panel can live in the popout window, whose elements belong to a foreign
// realm — `instanceof HTMLInputElement` is always false there — so sniff the
// shape instead. Range sliders don't count: they should not swallow shortcuts.
// A textarea always does: the teletype card is typed into one, and the 'r' in
// the middle of a word must not start a recording.
function isTextEntry(t: EventTarget | null): boolean {
  if (t === null || !('tagName' in t)) return false
  if (t.tagName === 'TEXTAREA') return true
  return t.tagName === 'INPUT' && 'type' in t && t.type !== 'range'
}

interface Handlers {
  onEscape: () => void
  onPalette: () => void
  onUndo: () => void
  canUndo: boolean
  onRedo: () => void
  canRedo: boolean
  onToggleFullscreen: () => void
  onStartCompare: () => void
  onEndCompare: () => void
  onToggleRecord: () => void
  onGrabStill: () => void
  onSaveSlot: (n: number) => void
  onRecallSlot: (n: number) => void
  onSaveProfile: () => void
  // The cue gestures, per slot. `i` marks/closes/re-arms, `o` stabs back to the
  // cue; shift picks slot B. Bound rather than left to the buttons because both
  // are beaten in time to something, and a mouse trip to a 22px button in the
  // Input section is not a gesture you can perform.
  onTapCue: (slot: 'a' | 'b') => void
  onRetrigger: (slot: 'a' | 'b') => void
}

// Global keyboard shortcuts, bound wherever the panel lives (main window and the
// popout). Handlers are read through a ref, so the listeners re-subscribe only
// when the popout appears or goes away, never on every render — and always see
// the latest closures without capturing stale ones. Letter keys match
// case-insensitively so the hints work whether or not Shift/Caps is down.
export function useShortcuts(popout: Window | null, handlers: Handlers) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current
      const typing = isTextEntry(e.target)
      const key = e.key.toLowerCase()
      if (e.key === 'Escape') {
        h.onEscape()
      } else if ((e.ctrlKey || e.metaKey) && key === 'k') {
        // Reachable while typing too: the filter box is the most likely place
        // to be when you decide you wanted the palette instead.
        e.preventDefault()
        h.onPalette()
      } else if ((e.ctrlKey || e.metaKey) && key === 's') {
        // The keystroke everything else on a computer uses for "keep this", aimed
        // at the thing this app makes. Reachable while typing, like ⌘K: the name
        // box is the likeliest place to be when you decide to save.
        //
        // It also takes ctrl+S away from two worse readings. The browser's
        // save-page dialog was one; the other was the bare-`s` still grab below,
        // which did not check for a modifier — so ctrl+S used to download a png
        // *and* open that dialog.
        e.preventDefault()
        h.onSaveProfile()
      } else if ((e.ctrlKey || e.metaKey) && key === 'z' && e.shiftKey) {
        // Both spellings of redo, since which one is muscle memory depends on
        // where you learned it.
        if (h.canRedo) {
          e.preventDefault()
          h.onRedo()
        }
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        if (h.canRedo) {
          e.preventDefault()
          h.onRedo()
        }
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        if (h.canUndo) {
          e.preventDefault()
          h.onUndo()
        }
      } else if (!typing && key === 'f') {
        h.onToggleFullscreen()
      } else if (!typing && key === 'c' && !e.repeat) {
        h.onStartCompare()
      } else if (
        !typing &&
        key === 'r' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.repeat
      ) {
        h.onToggleRecord()
      } else if (!typing && key === 's' && !e.repeat) {
        h.onGrabStill()
      } else if (!typing && key === 'i' && !e.ctrlKey && !e.metaKey) {
        // Not guarded against repeat, unlike the one-shots above: held down, `i`
        // marking a cue then closing a loop on it is harmless, and a performer
        // leaning on the key gets a run of short loops rather than a stuck one.
        h.onTapCue(e.shiftKey ? 'b' : 'a')
      } else if (!typing && key === 'o' && !e.ctrlKey && !e.metaKey) {
        // This one IS guarded: one press is one stab. Auto-repeat would turn a
        // held key into a seek fired every few milliseconds, which is a loop the
        // decoder never gets ahead of and a picture that stops moving.
        if (!e.repeat) h.onRetrigger(e.shiftKey ? 'b' : 'a')
      } else if (!typing) {
        // The saved library's first nine, by position in the list. Read from
        // `e.code` rather than `e.key` so shift+1 is still slot 1 and not `!`.
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
        if (m !== null && !e.repeat) {
          if (e.shiftKey) h.onSaveSlot(Number(m[1]))
          else h.onRecallSlot(Number(m[1]))
        }
      }
    }
    // Same text-entry guard as the keydown side: without it, typing a "c" in the
    // filter box ends a compare that was never started, and each keystroke costs
    // a full filter-bank rebuild on the next frame.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isTextEntry(e.target) && e.key.toLowerCase() === 'c')
        ref.current.onEndCompare()
    }
    // Compare is a hold, and a window that loses focus mid-hold never delivers
    // the keyup: alt-tab away with `c` down and the engine stays previewing the
    // defaults while every slider shows the real value. End it on blur too —
    // ending a compare that never started is already harmless.
    const onBlur = () => ref.current.onEndCompare()
    const targets = popout === null ? [window] : [window, popout]
    for (const t of targets) {
      t.addEventListener('keydown', onKey)
      t.addEventListener('keyup', onKeyUp)
      t.addEventListener('blur', onBlur)
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener('keydown', onKey)
        t.removeEventListener('keyup', onKeyUp)
        t.removeEventListener('blur', onBlur)
      }
    }
  }, [popout])
}
