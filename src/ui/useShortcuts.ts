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

// What a keystroke means, decided before anything is called. Split out from the
// dispatch below so the rule that says which modifiers reach which gesture is a
// pure function with a test, rather than a condition repeated down an if-chain
// where a missing copy is invisible — which is exactly how ⌘F, ⌘C and ⌘1 each
// came to answer a bare-letter gesture. `takes` marks the ones that must beat
// the browser's own reading of the chord.
export type Shortcut =
  | { do: 'escape' }
  | { do: 'palette' }
  | { do: 'saveProfile' }
  | { do: 'undo' }
  | { do: 'redo' }
  | { do: 'fullscreen' }
  | { do: 'compare' }
  | { do: 'record' }
  | { do: 'still' }
  | { do: 'tapCue'; slot: 'a' | 'b' }
  | { do: 'retrigger'; slot: 'a' | 'b' }
  | { do: 'fire' }
  | { do: 'saveSlot'; n: number }
  | { do: 'recallSlot'; n: number }

// The half of a KeyboardEvent this decision reads, plus the one thing it cannot
// read off the event alone: whether the target is somewhere text is being typed.
export interface Keystroke {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
  typing: boolean
}

// Which gestures the browser will also act on, so the dispatch knows to call
// preventDefault. Undo and redo are absent on purpose: they are suppressed only
// when there is actually a step to take, so an exhausted walk still lets the
// browser have the chord.
export const TAKES_KEY: ReadonlySet<Shortcut['do']> = new Set<Shortcut['do']>([
  'palette',
  'saveProfile',
])

export function resolveShortcut(e: Keystroke): Shortcut | null {
  const key = e.key.toLowerCase()
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'Escape') return { do: 'escape' }
  // Reachable while typing: the filter box is the most likely place to be when
  // you decide you wanted the palette instead, and the name box is the likeliest
  // place to be when you decide to save.
  //
  // ⌘S also takes the chord away from two worse readings. The browser's
  // save-page dialog was one; the other was the bare-`s` still grab below, which
  // used not to check for a modifier — so ⌘S downloaded a png *and* opened that
  // dialog.
  if (mod && key === 'k') return { do: 'palette' }
  if (mod && key === 's') return { do: 'saveProfile' }
  // Both spellings of redo, since which one is muscle memory depends on where
  // you learned it.
  if (mod && key === 'z' && e.shiftKey) return { do: 'redo' }
  if (mod && key === 'y') return { do: 'redo' }
  if (mod && key === 'z') return { do: 'undo' }
  // Ctrl/Cmd is the browser's half of the keyboard, so past this line no gesture
  // may answer to it: ⌘F is find, ⌘C is copy, ⌘1 picks a tab. One guard for all
  // of them — the per-branch copies this replaced were each missed somewhere.
  if (e.typing || mod) return null
  if (key === 'f') return { do: 'fullscreen' }
  if (key === 'c') return e.repeat ? null : { do: 'compare' }
  if (key === 'r') return e.repeat ? null : { do: 'record' }
  if (key === 's') return e.repeat ? null : { do: 'still' }
  // Not guarded against repeat, unlike the one-shots above: held down, `i`
  // marking a cue then closing a loop on it is harmless, and a performer leaning
  // on the key gets a run of short loops rather than a stuck one.
  if (key === 'i') return { do: 'tapCue', slot: e.shiftKey ? 'b' : 'a' }
  // This one IS guarded: one press is one stab. Auto-repeat would turn a held
  // key into a seek fired every few milliseconds, which is a loop the decoder
  // never gets ahead of and a picture that stops moving.
  if (key === 'o') {
    return e.repeat ? null : { do: 'retrigger', slot: e.shiftKey ? 'b' : 'a' }
  }
  // `t` for trigger, and guarded like the stab above for the same reason: a
  // one-shot envelope struck at the OS repeat rate never gets to decay, so a
  // held key would pin the bay at full instead of hitting it. The gesture the
  // ⚡ buttons are, which were mouse-only — the wrong input for something whose
  // whole point is when it lands.
  if (key === 't') return e.repeat ? null : { do: 'fire' }
  // The saved library's first nine, by position in the list. Read from `code`
  // rather than `key` so shift+1 is still slot 1 and not `!`.
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (m !== null && !e.repeat) {
    const n = Number(m[1])
    return e.shiftKey ? { do: 'saveSlot', n } : { do: 'recallSlot', n }
  }
  return null
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
  // are beaten in time to something, and a mouse trip to a 22px button at the
  // head of a stage is not a gesture you can perform.
  onTapCue: (slot: 'a' | 'b') => void
  onRetrigger: (slot: 'a' | 'b') => void
  // Strike every one-shot in the modulation bay. Bound for the same reason the
  // cue gestures are, and it is the one the argument fits best: the whole bay
  // fired together is a gesture you land on a beat.
  onFire: () => void
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
      const hit = resolveShortcut({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        typing: isTextEntry(e.target),
      })
      if (hit === null) return
      // The walk's two verbs are the only ones whose chord is conditionally
      // ours: with nothing to step to, the browser keeps it.
      if (hit.do === 'undo' && !h.canUndo) return
      if (hit.do === 'redo' && !h.canRedo) return
      if (TAKES_KEY.has(hit.do) || hit.do === 'undo' || hit.do === 'redo') {
        e.preventDefault()
      }
      switch (hit.do) {
        case 'escape':
          h.onEscape()
          break
        case 'palette':
          h.onPalette()
          break
        case 'saveProfile':
          h.onSaveProfile()
          break
        case 'undo':
          h.onUndo()
          break
        case 'redo':
          h.onRedo()
          break
        case 'fullscreen':
          h.onToggleFullscreen()
          break
        case 'compare':
          h.onStartCompare()
          break
        case 'record':
          h.onToggleRecord()
          break
        case 'still':
          h.onGrabStill()
          break
        case 'tapCue':
          h.onTapCue(hit.slot)
          break
        case 'retrigger':
          h.onRetrigger(hit.slot)
          break
        case 'fire':
          h.onFire()
          break
        case 'saveSlot':
          h.onSaveSlot(hit.n)
          break
        case 'recallSlot':
          h.onRecallSlot(hit.n)
          break
      }
    }
    // Same text-entry guard as the keydown side: without it, typing a "c" in the
    // filter box ends a compare that was never started, and each keystroke costs
    // a full filter-bank rebuild on the next frame.
    //
    // Deliberately *not* given the keydown's Ctrl/Cmd guard as well, though the
    // asymmetry looks like an oversight: press `c`, then tap Ctrl, then release,
    // and the keyup carries a modifier the keydown did not. Guarding here would
    // drop that release and leave the stage previewing stock with every slider
    // showing the real value — the exact stuck hold the blur handler below
    // exists to clean up. Ending a compare that never started is harmless, so
    // the release is always taken.
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
