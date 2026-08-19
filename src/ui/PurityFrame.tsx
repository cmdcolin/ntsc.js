import { useState } from 'react'

import { clamp, clamp01 } from '../core/math'
import { cx } from './cx'
import { nudgeFor, snapOffset, uvInRect } from './miniFrame'
import styles from './MiniFrame.module.css'

import type { KeyboardEvent, PointerEvent } from 'react'

// The patch radius is a fraction of picture *height* (see crt_face.wgsl), and
// the miniature is 4:3, so a horizontal distance in frame widths converts by
// this much. Getting it backwards would draw a circle as an ellipse and size it
// at 4/3 the rate the shader reads.
const ASPECT = 3 / 4

const SIZE_MIN = 0.02
const SIZE_MAX = 2
const clampSize = (v: number) => clamp(v, SIZE_MIN, SIZE_MAX)

export interface Patch {
  x: number
  y: number
  size: number
}

// Where the magnetised patch sits on the glass, and how big it is.
//
// These three were the panel's clearest case of a control you could not use: the
// *strength* had a row of its own on show while where-and-how-big were folded
// away behind "fine tweaks", so the visible slider stained a picture at a place
// you had to go two disclosures deep to discover, in units ("h", a fraction of
// picture height) that mean nothing until you can see the circle they describe.
// Nothing in the preset table ever set any of the four, which is about what you
// would expect.
//
// The strength keeps its own slider above — it is signed, and the sign is which
// way the beams land, not where they land — so this frame owns placement only.
export function PurityFrame(props: {
  patch: Patch
  // Zero strength: the patch is somewhere, but nothing is bending. Drawn faint,
  // with the fix one click away, the same bargain the gate notes on ordinary rows
  // strike.
  inert: boolean
  onFix: () => void
  onChange: (patch: Patch) => void
}) {
  // Which gesture is in flight. Placing works in the frame's own 0..1; sizing
  // needs no start state, since the radius is just how far the pointer is from
  // the centre.
  // The gesture, and the frame's box as it was when it began. Frozen because
  // placing the patch writes crtPurityX/Y off stock, which grows "This look" at
  // the top of the panel and shoves this frame down the page mid-drag — see
  // uvInRect.
  const [drag, setDrag] = useState<{
    kind: 'place' | 'size'
    box: DOMRect
  } | null>(null)
  const { x, y, size } = props.patch
  const place = (
    e: PointerEvent<HTMLDivElement>,
    box: DOMRect,
    snap: boolean,
  ) => {
    const p = uvInRect(box, e.clientX, e.clientY)
    props.onChange({
      x: clamp01(p.u + snapOffset([p.u], snap)),
      y: clamp01(p.v + snapOffset([p.v], snap)),
      size,
    })
  }
  // Sizing measures against the frame, not the grip: the grip travels out from
  // under the pointer as the patch grows.
  const resize = (e: PointerEvent<HTMLDivElement>, box: DOMRect) => {
    const p = uvInRect(box, e.clientX, e.clientY)
    props.onChange({ x, y, size: clampSize(Math.abs(p.u - x) / ASPECT) })
  }
  // alt+arrows size it, matching PipFrame's window — the geometry stays
  // reachable without a pointer, which is the whole reason the three sliders can
  // go behind the reveal rather than staying on show.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = nudgeFor(e)
    if (n !== null) {
      props.onChange(
        n.resize
          ? { x, y, size: clampSize(size + n.du * n.d * 4) }
          : { x: clamp01(x + n.du * n.d), y: clamp01(y + n.dv * n.d), size },
      )
    }
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(null)
  }
  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.frame, props.inert && styles.inert)}
        style={{ cursor: 'crosshair' }}
        tabIndex={0}
        title="click or drag to put the magnetised patch there · the grip sizes it · arrows nudge · alt+arrows resize · alt drags off the guides"
        onPointerDown={e => {
          const box = e.currentTarget.getBoundingClientRect()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ kind: 'place', box })
          place(e, box, !e.altKey)
        }}
        onPointerMove={e => {
          if (drag?.kind === 'place') place(e, drag.box, !e.altKey)
        }}
        onPointerUp={e => end(e)}
        onPointerCancel={e => end(e)}
        onKeyDown={e => key(e)}
      >
        <div
          className={styles.blob}
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            // Width against the frame's width, height against its height — the
            // same radius in two different denominators.
            width: `${size * ASPECT * 200}%`,
            height: `${size * 200}%`,
          }}
        />
        <div
          className={styles.grip}
          style={{
            left: `${clamp01(x + size * ASPECT) * 100}%`,
            top: `${y * 100}%`,
            cursor: 'ew-resize',
          }}
          title="drag to set the patch radius"
          onPointerDown={e => {
            e.stopPropagation()
            // The grip's parent is the frame the radius is measured against —
            // the grip itself travels out from under the pointer as the patch
            // grows, so it can never be the reference.
            const frame = e.currentTarget.parentElement
            if (frame !== null) {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag({ kind: 'size', box: frame.getBoundingClientRect() })
            }
          }}
          onPointerMove={e => {
            e.stopPropagation()
            if (drag?.kind === 'size') resize(e, drag.box)
          }}
          onPointerUp={e => {
            e.stopPropagation()
            end(e)
          }}
          onPointerCancel={e => end(e)}
        />
      </div>
      <div className={styles.readout}>
        {props.inert ? (
          <button className={styles.fix} onClick={() => props.onFix()}>
            purity is at 0 — click to magnetise
          </button>
        ) : (
          <span>drag to place · grip sizes</span>
        )}
        <span className={styles.nums}>
          {`x ${x.toFixed(2)} y ${y.toFixed(2)} · r ${size.toFixed(2)}h`}
        </span>
      </div>
    </div>
  )
}
