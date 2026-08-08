import { useState } from 'react'

import { useControls, useControlsApi } from './ControlsContext'
import { cx } from './cx'
import styles from './Deck.module.css'
import { uvInRect } from './miniFrame'
import mini from './MiniFrame.module.css'

import type { PointerEvent } from 'react'

// The tracking control, as the two-axis gesture it always was.
//
// A VCR's tracking knob had one job with two answers in it: how badly the head
// is off the track, and — because a real head drifts as the tape stretches —
// where down the picture the resulting band lands. Split across two sliders in
// two tiers (trackPos is a folded trim) that reads as two unrelated numbers.
// On a miniature of the raster it is one movement: drag to the band, push right
// until it breaks.
//
// Down is the band's position, right is how far off-track the head is, which is
// the same axis assignment the picture itself uses — the band is a horizontal
// stripe at a vertical position, and the damage runs across it.
export function TrackingPad() {
  const controls = useControls()
  const { writeControls } = useControlsApi()
  // The frame's box as it was when the drag started, and the whole gesture is
  // measured against it — see uvInRect. The first press moves trackAmt off
  // stock, which grows "This look" at the top of the panel and shoves this pad
  // down the page; measuring live, the rest of the drag is aimed at a frame
  // that is no longer there.
  const [grab, setGrab] = useState<DOMRect | null>(null)
  const amt = controls.trackAmt
  const pos = controls.trackPos

  const set = (e: PointerEvent<HTMLDivElement>, box: DOMRect) => {
    const { u, v } = uvInRect(box, e.clientX, e.clientY)
    // One write for both axes, so a drag notifies the engine once per pointer
    // move rather than twice — the same bargain the other miniatures strike.
    writeControls({
      ...controls,
      trackAmt: Number(u.toFixed(2)),
      trackPos: Number(v.toFixed(3)),
    })
  }

  // The band grows and softens as the head goes further off-track, which is
  // what the shader does with it: a wider stretch of the sweep reads off two
  // tracks at once, and the tear through it deepens.
  const band = {
    top: `${(pos - amt * 0.18) * 100}%`,
    height: `${Math.max(amt * 0.36, 0.02) * 100}%`,
    opacity: amt === 0 ? 0.25 : 0.35 + amt * 0.65,
  }

  return (
    <div className={mini.wrap}>
      <div
        className={cx(mini.frame, amt === 0 && mini.inert)}
        style={{ cursor: 'crosshair' }}
        title="drag down to the band, right to push the head off track"
        onPointerDown={e => {
          const box = e.currentTarget.getBoundingClientRect()
          e.currentTarget.setPointerCapture(e.pointerId)
          setGrab(box)
          set(e, box)
        }}
        onPointerMove={e => {
          if (grab !== null) set(e, grab)
        }}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          setGrab(null)
        }}
        onPointerCancel={() => setGrab(null)}
      >
        <div className={styles.band} style={band} />
      </div>
      <div className={mini.readout}>
        <span>{amt === 0 ? 'tracking — drag →' : '↓ band · → error'}</span>
        <span className={mini.nums}>
          {`${amt.toFixed(2)} @ ${pos.toFixed(2)}`}
        </span>
      </div>
    </div>
  )
}
