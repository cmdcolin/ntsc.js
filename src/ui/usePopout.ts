import { useEffect, useState } from 'react'

// A same-origin blank window the control panel portals into, for dual-screen
// setups: stage fullscreen on a projector, controls on the laptop. The popout
// shares the JS heap, so the same React tree, engine store, and MIDI wiring
// keep working with no message plumbing.
// One column, and two. The panel fills whatever width the window has and its
// container query splits the bench at 540px, so these are only ever opening
// sizes — the edge the user drags afterwards is the real setting.
const NARROW = 340
const WIDE = 780

export function usePopout() {
  const [popout, setPopout] = useState<Window | null>(null)

  // `wide` opens it at bench width: a 340px window would show the bench folded
  // back into one column until the user dragged it out.
  const openPopout = (wide: boolean) => {
    // `closed` too: if the window went away without firing pagehide, the stale
    // handle sticks around and focus() is a no-op, leaving no way to reopen.
    if (popout !== null && !popout.closed) {
      popout.focus()
    } else {
      const w = window.open(
        '',
        'ntsc.js_controls',
        `width=${wide ? WIDE : NARROW},height=900`,
      )
      if (w !== null) {
        w.document.title = 'ntsc.js — controls'
        w.document.body.style.margin = '0'
        // Mirror the app's styles (Vite dev injects <style>; prod links CSS).
        for (const el of document.querySelectorAll('style')) {
          w.document.head.appendChild(w.document.importNode(el, true))
        }
        for (const el of document.querySelectorAll<HTMLLinkElement>(
          'link[rel="stylesheet"]',
        )) {
          const link = w.document.createElement('link')
          link.rel = 'stylesheet'
          link.href = el.href
          w.document.head.appendChild(link)
        }
        w.addEventListener('pagehide', () => setPopout(null))
        setPopout(w)
      }
    }
  }

  // Switching the bench on inside the popout is a request for two columns, and
  // a one-column window cannot hold them — the container query folds them
  // straight back, so the toggle would read as doing nothing. Only ever grows:
  // a window already wide enough is one the user sized, and stays as it is.
  const widenPopout = () => {
    if (popout !== null && !popout.closed && popout.outerWidth < WIDE) {
      popout.resizeTo(WIDE, popout.outerHeight)
    }
  }

  // Dependent window: it goes away with the app (reload, close, unmount).
  useEffect(() => {
    const close = () => popout?.close()
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      close()
    }
  }, [popout])

  return { popout, openPopout, widenPopout }
}
