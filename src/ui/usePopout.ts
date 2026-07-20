import { useEffect, useState } from 'react'

// A same-origin blank window the control panel portals into, for dual-screen
// setups: stage fullscreen on a projector, controls on the laptop. The popout
// shares the JS heap, so the same React tree, engine store, and MIDI wiring
// keep working with no message plumbing.
export function usePopout() {
  const [popout, setPopout] = useState<Window | null>(null)

  const openPopout = () => {
    if (popout !== null) {
      popout.focus()
    } else {
      const w = window.open('', 'phosphene_controls', 'width=340,height=900')
      if (w !== null) {
        w.document.title = 'Phosphene — controls'
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

  // Dependent window: it goes away with the app (reload, close, unmount).
  useEffect(() => {
    const close = () => popout?.close()
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      close()
    }
  }, [popout])

  return { popout, openPopout }
}
