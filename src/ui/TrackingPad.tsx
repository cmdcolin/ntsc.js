import { clamp01 } from '../math'
import { useControls, useControlsApi } from './ControlsContext'
import { cx } from './cx'
import styles from './Deck.module.css'
import { uvInRect } from './miniFrame'
import mini from './MiniFrame.module.css'
import { useGrabRect } from './useGrabRect'

import type { KeyboardEvent, PointerEvent } from 'react'

// Arrows walk the band, alt+arrows push the head off track — the same split
// PipFrame and PurityFrame use, so a pad in this family is always reachable
// without a pointer.
const NUDGE = new Map([
  ['ArrowLeft', { du: -1, dv: 0 }],
  ['ArrowRight', { du: 1, dv: 0 }],
  ['ArrowUp', { du: 0, dv: -1 }],
  ['ArrowDown', { du: 0, dv: 1 }],
])

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
  const grab = useGrabRect(set)

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = NUDGE.get(e.key)
    if (step !== undefined) {
      e.preventDefault()
      const d = e.shiftKey ? 0.05 : 0.005
      writeControls(
        e.altKey
          ? { ...controls, trackAmt: clamp01(amt + step.du * d * 2) }
          : { ...controls, trackPos: clamp01(pos + step.dv * d) },
      )
    }
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
        tabIndex={0}
        title="drag down to the band, right to push the head off track · arrows move the band · alt+arrows push it off track"
        {...grab}
        onKeyDown={e => key(e)}
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
