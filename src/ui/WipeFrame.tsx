import { cx } from './cx'
import { WIPE_SHAPES, cqw, snapOffset, uvInRect } from './miniFrame'
import styles from './MiniFrame.module.css'
import { useGrabRect } from './useGrabRect'

import type { PointerEvent } from 'react'

export function WipeFrame(props: {
  mode: number
  pos: number
  soft: number
  // The lever is being driven by the sweep, so the drawn edge is only where
  // the ping-pong started — say so rather than draw a boundary that lies.
  swept: boolean
  // No pattern selected: the lever still moves, but nothing downstream reads
  // it. Drawn faint, with the fix one click away, the same bargain the gate
  // notes on ordinary rows strike.
  inert: boolean
  onFix: () => void
  onChange: (pos: number) => void
}) {
  const shape = WIPE_SHAPES.get(Math.round(props.mode))
  // The pointer sits on the wipe edge itself: whatever distance the pattern
  // reports under the cursor is the lever position that puts the boundary there.
  const set = (e: PointerEvent<HTMLDivElement>, box: DOMRect) => {
    if (shape !== undefined) {
      const { u, v } = uvInRect(box, e.clientX, e.clientY)
      const p = shape.pos(u, v)
      props.onChange(Math.min(1, Math.max(0, p + snapOffset([p], !e.altKey))))
    }
  }
  const grab = useGrabRect(set)
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
        {...grab}
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
        {props.inert ? (
          <button className={styles.fix} onClick={() => props.onFix()}>
            no pattern — click to wipe horizontally
          </button>
        ) : (
          <span>
            {props.swept
              ? 'sweeping — drag sets the start'
              : 'drag the boundary'}
          </span>
        )}
        <span className={styles.nums}>{props.pos.toFixed(3)}</span>
      </div>
    </div>
  )
}
