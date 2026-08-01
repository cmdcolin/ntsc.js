import { useEffect, useRef } from 'react'

// Drive a native <dialog> as a modal: showModal() puts it in the top layer (no
// z-index juggling), traps focus, makes the rest of the page inert, and turns
// Escape into a `cancel` event. Opens in whichever document the element was
// portaled into, so it works in the popout window too.
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el !== null) {
      el.showModal()
      // showModal focuses the first tabbable; honor an opt-in field that would
      // rather have it, like the palette's search box.
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus()
      return () => {
        if (el.open) el.close()
      }
    }
    return undefined
  }, [])
  return ref
}
