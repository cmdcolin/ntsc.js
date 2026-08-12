import { useState } from 'react'

import type { PointerEvent } from 'react'

// A drag measured in a frame's own box, with the box frozen at the press.
//
// It exists to delete a mistake rather than to save typing. Every pad that reads
// absolute positions has to freeze its box, for the reason `uvInRect` records:
// writing a control off its default adds a row to "This look" at the top of the
// panel, which pushes everything below it down, so re-measuring on each
// pointermove measures the frame *after* it has moved out from under the
// pointer. Sixty-eight pixels, mid-gesture, the first time a pad is touched —
// and only the first time, which is what makes it so easy to write and so hard
// to notice. Written out per pad, the correct version was a fourteen-line
// quartet that had to be got right again each time; here it is what you get by
// default, and a new pad cannot forget it.
//
// Not for the pads that work in *deltas* from the press (PipFrame,
// MagnifierFrame): those are already immune, because the number they read is a
// difference between two client positions and a frame that moves under the
// pointer moves both. Nor for a grip that measures against something other than
// itself — PurityFrame's sizes against its parent frame, since the grip travels
// out from under the pointer as the patch grows.
export function useGrabRect(
  // Where the pointer is, against the box as it was at the press. Called once on
  // the press too, so a click without a drag lands.
  drag: (e: PointerEvent<HTMLDivElement>, box: DOMRect) => void,
  // Anything the press means beyond starting the drag — TBar takes back a
  // running take, since touching the bar is taking it back.
  onGrab?: () => void,
) {
  const [grab, setGrab] = useState<DOMRect | null>(null)
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      onGrab?.()
      const box = e.currentTarget.getBoundingClientRect()
      e.currentTarget.setPointerCapture(e.pointerId)
      setGrab(box)
      drag(e, box)
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (grab !== null) drag(e, grab)
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId)
      setGrab(null)
    },
    // No release here, unlike the up above: a cancelled pointer has already lost
    // its capture, and asking for it back throws NotFoundError.
    onPointerCancel: () => setGrab(null),
  }
}
