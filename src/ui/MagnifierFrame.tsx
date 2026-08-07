import { useState } from 'react'

import { boxToLens, lensView } from './lens'
import { clamp01, snapOffset, uvIn } from './miniFrame'
import styles from './MiniFrame.module.css'

import type { Lens } from './lens'
import type { KeyboardEvent, PointerEvent } from 'react'

const NUDGE = new Map([
  ['ArrowLeft', { du: -1, dv: 0 }],
  ['ArrowRight', { du: 1, dv: 0 }],
  ['ArrowUp', { du: 0, dv: -1 }],
  ['ArrowDown', { du: 0, dv: 1 }],
])

// Shorter than this is a stray click, not a box: a 1% box would slam straight
// to maximum magnification. Same reasoning as MIN_BOX on the stage, in the same
// units — the frame is the whole picture, so a fraction here is a fraction there.
const MIN_BOX = 0.02

interface Pt {
  u: number
  v: number
}

// A drag in progress. Drawing a new box and aiming both work in the frame's own
// 0..1 (`a` the press, `b` the pointer now); moving the lens rectangle works in
// client pixels against the frame it was measured in, so the grabbed point stays
// under the pointer however the panel is sized.
type Drag =
  | { kind: 'box' | 'aim'; a: Pt; b: Pt }
  | {
      kind: 'move'
      px: number
      py: number
      fw: number
      fh: number
      from: { x: number; y: number }
      size: number
    }

const covered = (d: { a: Pt; b: Pt }) =>
  Math.max(Math.abs(d.b.u - d.a.u), Math.abs(d.b.v - d.a.v))

// Where on the glass the magnifier is pointed, and — by dragging a box — how far
// in. The lens rectangle is sized by the magnification, so the miniature also
// reads as how much of the screen is still in view; and once there is a
// rectangle smaller than the frame, it is a thing to be pushed around, which is
// the same gesture the picture itself takes. The magnification keeps its own
// slider below, for when a number is what you want.
export function MagnifierFrame(props: {
  zoom: number
  point: { x: number; y: number }
  onChange: (point: { x: number; y: number }) => void
  onLens: (lens: Lens) => void
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const view = lensView(props.zoom, props.point.x, props.point.y)
  // The rectangle is a handle only once it has left the frame some room. At 1x
  // it *is* the frame and there is nothing to push; barely magnified it still
  // covers nearly all of it, and a handle that big would swallow the press that
  // draws a new box while moving it hardly anywhere.
  const grabbable = view.size < 0.9
  // The pointer is the thing being looked at, so put the lens centre under it.
  const aim = (p: Pt, snap: boolean) =>
    props.onChange({
      x: clamp01(p.u + snapOffset([p.u], snap)),
      y: clamp01(p.v + snapOffset([p.v], snap)),
    })
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
  // Grabbing the rectangle. Measured against the frame rather than the
  // rectangle, since the rectangle moves out from under the pointer as it goes.
  // The rectangle sits inside the frame that boxes and aims, so every gesture it
  // owns has to be kept from bubbling into one of those as well.
  const takeLens = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const frame = e.currentTarget.parentElement
    if (frame !== null) {
      const r = frame.getBoundingClientRect()
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({
        kind: 'move',
        px: e.clientX,
        py: e.clientY,
        fw: r.width,
        fh: r.height,
        from: { x: view.x, y: view.y },
        size: view.size,
      })
    }
  }
  const moveLens = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (drag !== null && drag.kind === 'move') {
      const snap = !e.altKey
      const rawU = (e.clientX - drag.px) / drag.fw
      const rawV = (e.clientY - drag.py) / drag.fh
      // Both edges and the centre are offered to the guides, so the lens settles
      // on a third the way a boxed region does.
      const left = drag.from.x - drag.size / 2 + rawU
      const top = drag.from.y - drag.size / 2 + rawV
      const du =
        rawU + snapOffset([left, left + drag.size / 2, left + drag.size], snap)
      const dv =
        rawV + snapOffset([top, top + drag.size / 2, top + drag.size], snap)
      props.onChange({
        x: clamp01(drag.from.x + du),
        y: clamp01(drag.from.y + dv),
      })
    }
  }
  // Drawn only once the drag is long enough to mean it, so a click doesn't
  // flash a box across the miniature.
  const marquee =
    drag !== null && drag.kind === 'box' && covered(drag) >= MIN_BOX
      ? {
          left: `${Math.min(drag.a.u, drag.b.u) * 100}%`,
          top: `${Math.min(drag.a.v, drag.b.v) * 100}%`,
          width: `${Math.abs(drag.b.u - drag.a.u) * 100}%`,
          height: `${Math.abs(drag.b.v - drag.a.v) * 100}%`,
        }
      : null
  const end = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(null)
  }
  return (
    <div className={styles.wrap}>
      <div
        className={styles.frame}
        style={{ cursor: 'crosshair' }}
        tabIndex={0}
        title="drag a box to magnify into it · click or shift-drag to aim · arrows nudge · alt drags off the guides"
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const p = uvIn(e.currentTarget, e.clientX, e.clientY)
          setDrag({ kind: e.shiftKey ? 'aim' : 'box', a: p, b: p })
          if (e.shiftKey) aim(p, !e.altKey)
        }}
        onPointerMove={e => {
          if (drag !== null && drag.kind !== 'move') {
            const p = uvIn(e.currentTarget, e.clientX, e.clientY)
            setDrag({ ...drag, b: p })
            if (drag.kind === 'aim') aim(p, !e.altKey)
          }
        }}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (drag !== null && drag.kind !== 'move') {
            const p = uvIn(e.currentTarget, e.clientX, e.clientY)
            const d = { ...drag, b: p }
            // A drag too short to be a box is a click, and a click still aims
            // where it landed — as does the whole of a shift-drag.
            if (d.kind === 'box' && covered(d) >= MIN_BOX)
              props.onLens(boxToLens(d.a, d.b))
            else aim(p, !e.altKey)
            setDrag(null)
          }
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={e => key(e)}
      >
        {/* Two rectangles, one meaning: pulled back it is a read-out of what is
            in view and the press underneath it belongs to the frame, magnified
            it is the handle. */}
        {grabbable ? (
          <div
            className={styles.window}
            style={{
              left: `${(view.x - view.size / 2) * 100}%`,
              top: `${(view.y - view.size / 2) * 100}%`,
              width: `${view.size * 100}%`,
              height: `${view.size * 100}%`,
              cursor: drag?.kind === 'move' ? 'grabbing' : 'move',
            }}
            title="drag the lens where you want it · drag outside to box a new view · alt drags off the guides"
            onPointerDown={e => takeLens(e)}
            onPointerMove={e => moveLens(e)}
            onPointerUp={e => end(e)}
            onPointerCancel={e => end(e)}
          />
        ) : (
          <div
            className={styles.region}
            style={{
              left: `${(view.x - view.size / 2) * 100}%`,
              top: `${(view.y - view.size / 2) * 100}%`,
              width: `${view.size * 100}%`,
              height: `${view.size * 100}%`,
            }}
          />
        )}
        {marquee === null ? null : (
          <div className={styles.marquee} style={marquee} />
        )}
      </div>
      <div className={styles.readout}>
        <span>
          {props.zoom < 1
            ? 'pulled back off the set'
            : grabbable
              ? 'drag the lens · box a new view'
              : 'drag a box to magnify'}
        </span>
        <span className={styles.nums}>
          {`x ${view.x.toFixed(2)} y ${view.y.toFixed(2)} · ${props.zoom.toFixed(2).replace(/0$/, '')}×`}
        </span>
      </div>
    </div>
  )
}
