import { useState } from 'react'

import styles from './MiniFrame.module.css'
import { cx } from './cx'
import { WIPE_SHAPES, cqw, snapOffset, uvIn } from './miniFrame'

import type { PointerEvent } from 'react'

export function WipeFrame(props: {
  mode: number
  pos: number
  soft: number
  // The lever is being driven by the sweep, so the drawn edge is only where
  // the ping-pong started — say so rather than draw a boundary that lies.
  swept: boolean
  inert: boolean
  onChange: (pos: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const shape = WIPE_SHAPES.get(Math.round(props.mode))
  // The pointer sits on the wipe edge itself: whatever distance the pattern
  // reports under the cursor is the lever position that puts the boundary there.
  const set = (e: PointerEvent<HTMLDivElement>) => {
    if (shape !== undefined) {
      const { u, v } = uvIn(e.currentTarget, e.clientX, e.clientY)
      const p = shape.pos(u, v)
      props.onChange(Math.min(1, Math.max(0, p + snapOffset([p], !e.altKey))))
    }
  }
  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.frame, props.inert && styles.inert)}
        title={
          props.inert
            ? 'no wipe pattern selected — the boundary is not on air'
            : 'drag the boundary · alt drags off the guides'
        }
        style={{ cursor: shape === undefined ? 'default' : 'crosshair' }}
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
      >
        {shape === undefined ? null : (
          <div
            className={cx(styles.region, props.swept && styles.swept)}
            style={{
              ...shape.region(props.pos),
              filter:
                props.soft === 0 ? undefined : `blur(${cqw(props.soft / 2)})`,
            }}
          />
        )}
        <span className={cx(styles.side, styles.sideA)}>A</span>
        {shape === undefined ? null : (
          <span className={cx(styles.side, styles.sideB)}>B</span>
        )}
      </div>
      <div className={styles.readout}>
        <span>
          {props.swept ? 'sweeping — drag sets the start' : 'drag the boundary'}
        </span>
        <span className={styles.nums}>{props.pos.toFixed(3)}</span>
      </div>
    </div>
  )
}
