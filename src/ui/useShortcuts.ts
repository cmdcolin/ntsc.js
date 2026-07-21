import { useEffect, useRef } from 'react'

// The panel can live in the popout window, whose elements belong to a foreign
// realm — `instanceof HTMLInputElement` is always false there — so sniff the
// shape instead. Range sliders don't count: they should not swallow shortcuts.
function isTextEntry(t: EventTarget | null): boolean {
  return (
    t !== null &&
    'tagName' in t &&
    t.tagName === 'INPUT' &&
    'type' in t &&
    t.type !== 'range'
  )
}

interface Handlers {
  onEscape: () => void
  onUndo: () => void
  canUndo: boolean
  onToggleFullscreen: () => void
  onStartCompare: () => void
  onEndCompare: () => void
  onToggleRecord: () => void
  onGrabStill: () => void
  onSaveScene: (n: number) => void
  onRecallScene: (n: number) => void
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
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        if (h.canUndo) {
          e.preventDefault()
          h.onUndo()
        }
      } else if (!typing && key === 'f') {
        h.onToggleFullscreen()
      } else if (!typing && key === 'c' && !e.repeat) {
        h.onStartCompare()
      } else if (!typing && key === 'r' && !e.repeat) {
        h.onToggleRecord()
      } else if (!typing && key === 's' && !e.repeat) {
        h.onGrabStill()
      } else if (!typing) {
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
        if (m !== null && !e.repeat) {
          if (e.shiftKey) h.onSaveScene(Number(m[1]))
          else h.onRecallScene(Number(m[1]))
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c') ref.current.onEndCompare()
    }
    const targets = popout === null ? [window] : [window, popout]
    for (const t of targets) {
      t.addEventListener('keydown', onKey)
      t.addEventListener('keyup', onKeyUp)
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener('keydown', onKey)
        t.removeEventListener('keyup', onKeyUp)
      }
    }
  }, [popout])
}
