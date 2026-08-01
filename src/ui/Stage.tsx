import { useState } from 'react'

import { FpsMonitor } from './FpsMonitor'
import { Popover } from './Popover'
import popoverStyles from './Popover.module.css'
import styles from './Stage.module.css'
import { cx } from './cx'
import { CameraIcon, GearIcon } from './icons'
import {
  clampZoom,
  nudgeZoom,
  panLens,
  pictureUv,
  zoomAtTravel,
  zoomAbout,
  zoomTravel,
  zoomToBox,
} from './lens'
import { usePersistedFlag } from './storage'

import type { FrameStats } from '../controls'
import type { Lens } from './lens'
import type { PointerEvent, RefObject, WheelEvent } from 'react'

// Persisted across reloads so a collapse sticks.
const BAR_HIDDEN_STORE = 'ntscsynth_overlay_bar_hidden'

function CaptureMenu(props: {
  recording: boolean
  onGrabStill: () => void
  onToggleRecord: () => void
}) {
  return (
    <Popover
      trigger={toggle => (
        <button
          className={cx(styles.overlayBtn, props.recording && styles.recording)}
          onClick={toggle}
          title={
            props.recording
              ? 'recording — click for capture options'
              : 'capture options (s: still, r: record)'
          }
        >
          <CameraIcon /> {props.recording ? 'rec' : 'capture'}
        </button>
      )}
    >
      {close => (
        <>
          <button
            className={popoverStyles.menuItem}
            onClick={() => {
              props.onGrabStill()
              close()
            }}
          >
            <span>◍ save still</span>
            <span className={popoverStyles.menuHint}>s</span>
          </button>
          <button
            className={popoverStyles.menuItem}
            onClick={() => {
              props.onToggleRecord()
              close()
            }}
          >
            <span>
              {props.recording ? '■ stop recording' : '● start recording'}
            </span>
            <span className={popoverStyles.menuHint}>r</span>
          </button>
        </>
      )}
    </Popover>
  )
}

// A drag this short is a stray click, not a box — zooming to it would slam
// straight to maximum magnification.
const MIN_BOX = 0.02
// One wheel notch, as a fraction of the magnifier's travel. Small: creeping in
// from 1x is the common move, and a notch there is a couple of percent closer.
const WHEEL_STEP = 0.03

// A drag in progress. `a` is the press and `b` the pointer now, both in canvas
// pixels — the canvas fills the stage, so they double as the marquee's layout.
// The lens is kept from the press too, so every move is computed against it
// rather than accumulated (which would drift, and fight the shader's edge clamp).
interface Drag {
  a: { x: number; y: number }
  b: { x: number; y: number }
  box: boolean
  from: Lens
}

const dragged = (d: Drag) =>
  Math.abs(d.b.x - d.a.x) + Math.abs(d.b.y - d.a.y) > 3

// Zoom readout and lever for the stage: the gestures are the fast path, but
// nothing on screen would otherwise say the magnifier exists.
function ZoomBar(props: { lens: Lens; onChange: (lens: Lens) => void }) {
  const { lens } = props
  const at = (zoom: number) => props.onChange({ ...lens, zoom })
  return (
    <div className={styles.zoomBar}>
      <span
        className={styles.zoomLabel}
        title="where your eye is — scroll or drag a box on the picture to close in, drag to move around the glass, double-click to go back to 1×. Below 1× it pulls back off the set."
      >
        ⌕
      </span>
      <input
        type="range"
        className={styles.zoomRange}
        min={0}
        max={1}
        step={0.002}
        value={zoomTravel(lens.zoom)}
        onChange={e => at(zoomAtTravel(Number(e.target.value)))}
      />
      <button
        className={styles.zoomReset}
        title="back to the picture filling the frame"
        onClick={() => at(1)}
      >
        {`${clampZoom(lens.zoom).toFixed(2).replace(/0$/, '')}×`}
      </button>
    </div>
  )
}

export function Stage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  error: string
  stats: FrameStats
  res: string
  fullscreen: boolean
  poppedOut: boolean
  recording: boolean
  lens: Lens
  onLens: (lens: Lens) => void
  onToggleRecord: () => void
  onGrabStill: () => void
  onToggleFullscreen: () => void
  onPopout: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
}) {
  const [barHidden, setBarHidden] = usePersistedFlag(BAR_HIDDEN_STORE)
  const [drag, setDrag] = useState<Drag | null>(null)
  const zoomed = clampZoom(props.lens.zoom) > 1
  // Canvas pixels, and the picture UV they land on. The canvas box is what the
  // shader letterboxes inside, so this is the same 4:3 mapping present.wgsl does.
  const at = (
    e: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>,
  ) => {
    const r = e.currentTarget.getBoundingClientRect()
    const p = { x: e.clientX - r.left, y: e.clientY - r.top }
    return { p, uv: pictureUv(r, p.x, p.y) }
  }
  // Box first: a drag with nothing magnified yet, or one held with shift, picks
  // the region to look at. Once you are already in close a plain drag pushes the
  // glass around under a fixed lens instead, which is what you then want.
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const { p } = at(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ a: p, b: p, box: e.shiftKey || !zoomed, from: props.lens })
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag !== null) {
      const { p, uv } = at(e)
      setDrag({ ...drag, b: p })
      if (!drag.box) {
        const start = pictureUv(
          e.currentTarget.getBoundingClientRect(),
          drag.a.x,
          drag.a.y,
        )
        props.onLens(panLens(drag.from, uv.u - start.u, uv.v - start.v))
      }
    }
  }
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (drag !== null) {
      const r = e.currentTarget.getBoundingClientRect()
      const from = pictureUv(r, drag.a.x, drag.a.y)
      const to = at(e).uv
      const covered = Math.max(Math.abs(to.u - from.u), Math.abs(to.v - from.v))
      if (drag.box && covered >= MIN_BOX) {
        props.onLens(zoomToBox(drag.from, from, to))
      }
      setDrag(null)
    }
  }
  // The marquee: drawn only once the drag is long enough to mean it, so a click
  // on the picture doesn't flash a box.
  const marquee =
    drag !== null && drag.box && dragged(drag)
      ? {
          left: Math.min(drag.a.x, drag.b.x),
          top: Math.min(drag.a.y, drag.b.y),
          width: Math.abs(drag.b.x - drag.a.x),
          height: Math.abs(drag.b.y - drag.a.y),
        }
      : null
  return (
    <div className={styles.stage}>
      <canvas
        ref={props.canvasRef}
        className={styles.canvas}
        style={{
          cursor:
            drag !== null && !drag.box
              ? 'grabbing'
              : zoomed
                ? 'grab'
                : 'zoom-in',
        }}
        title={
          zoomed
            ? 'drag to move around the glass · shift-drag a box to close in · scroll to magnify · double-click to pull back'
            : 'drag a box to zoom into it · scroll to magnify'
        }
        onWheel={e => {
          const { uv } = at(e)
          const step = e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP
          props.onLens(
            zoomAbout(props.lens, uv.u, uv.v, nudgeZoom(props.lens.zoom, step)),
          )
        }}
        onPointerDown={e => down(e)}
        onPointerMove={e => move(e)}
        onPointerUp={e => up(e)}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={() => props.onLens({ ...props.lens, zoom: 1 })}
      />
      {marquee === null ? null : (
        <div className={styles.marquee} style={marquee} />
      )}
      {props.error !== '' && <div className={styles.error}>{props.error}</div>}
      {barHidden ? (
        <button
          className={styles.reopenBar}
          onClick={() => setBarHidden(false)}
          title="show controls"
        >
          ⋯
        </button>
      ) : (
        <div className={styles.overlayBar}>
          <ZoomBar lens={props.lens} onChange={props.onLens} />
          <CaptureMenu
            recording={props.recording}
            onGrabStill={props.onGrabStill}
            onToggleRecord={props.onToggleRecord}
          />
          <button
            className={styles.overlayBtn}
            style={{ fontWeight: 700 }}
            onClick={props.onShowHelp}
            title="help / about"
          >
            ?
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onShowAdvanced}
            title="advanced settings"
          >
            <GearIcon />
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onPopout}
            title={
              props.poppedOut
                ? 'controls are in their own window — click to focus it'
                : 'pop controls into their own window (for a second screen)'
            }
          >
            ⧉ {props.poppedOut ? 'controls ↗' : 'pop out'}
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onToggleFullscreen}
            title="toggle fullscreen (f)"
          >
            {props.fullscreen ? '⤢ exit' : '⛶ fullscreen'}
          </button>
          <button
            className={styles.overlayBtn}
            onClick={() => setBarHidden(true)}
            title="hide controls"
          >
            ×
          </button>
        </div>
      )}
      <FpsMonitor stats={props.stats} res={props.res} />
    </div>
  )
}
