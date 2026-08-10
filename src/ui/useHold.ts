import { useState } from 'react'

// Park a number at zero and put it back where it was.
//
// Two of the panel's surfaces are this and nothing else: the motion strip's ❚❚,
// which holds every routing's depth, and the deck's, which holds the simulation
// clock. Both had their own copy of "remember, zero, restore", and both had the
// same two-line comment about why the remembered value is local state rather
// than something persisted — a freeze is a gesture inside a session, and
// reloading into a held board with no memory of why would read as a hang.
//
// The two stay separate instances on purpose, and that is the point of a hook
// rather than a shared button: they hold different things (a wave's phase keeps
// running under one, the frame stops dead under the other), so one widget owning
// two restore values is how the two start disagreeing about what is held.
//
// The value itself is the caller's — controls for one, the bay for the other —
// so all this owns is the memory of where it was.
export function useHold(value: number, write: (v: number) => void) {
  const [held, setHeld] = useState(1)
  return {
    frozen: value === 0,
    toggle: () => {
      if (value === 0) {
        // Never back to zero: a hold entered from a resting board would
        // otherwise have nothing to be released to, and ▶ would do nothing.
        write(held === 0 ? 1 : held)
      } else {
        setHeld(value)
        write(0)
      }
    },
  }
}
