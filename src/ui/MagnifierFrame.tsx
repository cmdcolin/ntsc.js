import { useState } from 'react'

import { cx } from './cx'
import { lensView } from './lens'
import { clamp01, snapOffset, uvIn } from './miniFrame'
import styles from './MiniFrame.module.css'

import type { KeyboardEvent, PointerEvent } from 'react'

const NUDGE = new Map([
  ['ArrowLeft', { du: -1, dv: 0 }],
  ['ArrowRight', { du: 1, dv: 0 }],
  ['ArrowUp', { du: 0, dv: -1 }],
  ['ArrowDown', { du: 0, dv: 1 }],
])

// Where on the glass the magnifier is pointed. The lens rectangle is sized by
// the magnification, so the miniature also reads as how much of the screen is
// still in view; the magnification itself stays on its own slider below.
export function MagnifierFrame(props: {
  zoom: number
  point: { x: number; y: number }
  onChange: (point: { x: number; y: number }) => void
}) {
  const [dragging, setDragging] = useState(false)
  const view = lensView(props.zoom, props.point.x, props.point.y)
  const inert = props.zoom <= 1
  // The pointer is the thing being looked at, so put the lens centre under it.
  const set = (e: PointerEvent<HTMLDivElement>) => {
    const { u, v } = uvIn(e.currentTarget, e.clientX, e.clientY)
    const snap = !e.altKey
    props.onChange({
      x: clamp01(u + snapOffset([u], snap)),
      y: clamp01(v + snapOffset([v], snap)),
    })
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = NUDGE.get(e.key)
    if (step !== undefined) {
      e.preventDefault()
      // A nudge is a fraction of what is in view, so it walks the same visible
      // distance whatever the magnification.
      const d = (e.shiftKey ? 0.25 : 0.05) * view.size
      props.onChange({
        x: clamp01(view.x + step.du * d),
        y: clamp01(view.y + step.dv * d),
      })
    }
  }
  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.frame, inert && styles.inert)}
        style={{ cursor: 'crosshair' }}
        tabIndex={0}
        title={
          inert
            ? 'nothing to aim — the whole screen is in view at 1× and below'
            : 'click or drag to aim the magnifier · arrows nudge · alt drags off the guides'
        }
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          set(e)
        }}
        onPointerMove={e => {
          if (dragging) set(e)
        }}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          setDragging(false)
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={e => key(e)}
      >
        <div
          className={styles.region}
          style={{
            left: `${(view.x - view.size / 2) * 100}%`,
            top: `${(view.y - view.size / 2) * 100}%`,
            width: `${view.size * 100}%`,
            height: `${view.size * 100}%`,
          }}
        />
      </div>
      <div className={styles.readout}>
        <span>
          {props.zoom < 1
            ? 'pulled back off the set'
            : inert
              ? 'raise magnification to aim'
              : 'aim the lens'}
        </span>
        <span className={styles.nums}>
          {`x ${view.x.toFixed(2)} y ${view.y.toFixed(2)} · ${props.zoom.toFixed(2).replace(/0$/, '')}×`}
        </span>
      </div>
    </div>
  )
}
