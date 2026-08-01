import { useState } from 'react'

import { FpsMonitor } from './FpsMonitor'
import { Popover } from './Popover'
import popoverStyles from './Popover.module.css'
import styles from './Stage.module.css'
import { cx } from './cx'
import { CameraIcon, ChainIcon, GearIcon, MenuIcon } from './icons'
import {
  clampZoom,
  panLens,
  pictureUv,
  zoomAtTravel,
  zoomToBox,
  zoomTravel,
} from './lens'
import { usePersistedFlag } from './storage'

import type { FrameStats } from '../controls'
import type { Lens } from './lens'
import type { PointerEvent, ReactNode, RefObject } from 'react'

// Persisted across reloads so a collapse sticks.
const BAR_HIDDEN_STORE = 'ntscynthia_overlay_bar_hidden'

// Magnification, as the menu trigger and the reset button both say it.
const zoomLabel = (lens: Lens) =>
  `${clampZoom(lens.zoom).toFixed(2).replace(/0$/, '')}×`

// One row of the stage menu. The icon sits in a fixed slot so glyphs and svgs
// share a text column; a blank hint means the action has no shortcut.
function MenuItem(props: {
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button className={popoverStyles.menuItem} onClick={() => props.onClick()}>
      <span className={popoverStyles.menuLabel}>
        <span className={popoverStyles.menuIcon}>{props.icon}</span>
        {props.label}
      </span>
      {props.hint === '' ? null : (
        <span className={popoverStyles.menuHint}>{props.hint}</span>
      )}
    </button>
  )
}

// Everything the stage can do, behind one button — the picture is the point,
// and a row of pills competing with it was not. Two states still have to read
// without opening anything, so they ride on the trigger: recording (which has
// to carry across a room) and a magnifier left anywhere but 1×, which would
// otherwise be an unexplained crop of the picture.
function StageMenu(props: {
  recording: boolean
  fullscreen: boolean
  poppedOut: boolean
  lens: Lens
  onLens: (lens: Lens) => void
  onGrabStill: () => void
  onToggleRecord: () => void
  onToggleFullscreen: () => void
  onPopout: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
  onShowChain: () => void
  onHideBar: () => void
}) {
  return (
    <Popover
      trigger={toggle => (
        <button
          className={cx(styles.overlayBtn, props.recording && styles.recording)}
          onClick={() => toggle()}
          title={
            props.recording
              ? 'recording — click for options'
              : 'menu (s: still, r: record, f: fullscreen)'
          }
        >
          <MenuIcon />
          {clampZoom(props.lens.zoom) === 1 ? null : (
            <span className={styles.triggerZoom}>{zoomLabel(props.lens)}</span>
          )}
          {props.recording ? '● rec' : null}
        </button>
      )}
    >
      {close => {
        const run = (act: () => void) => () => {
          act()
          close()
        }
        return (
          <>
            <ZoomRow lens={props.lens} onChange={props.onLens} />
            <div className={popoverStyles.menuSep} />
            {/* the way into every control, so it heads the menu rather than
                sitting with the save/record housekeeping below */}
            <MenuItem
              icon={<ChainIcon />}
              label="signal chain"
              hint=""
              onClick={run(props.onShowChain)}
            />
            <div className={popoverStyles.menuSep} />
            <MenuItem
              icon={<CameraIcon />}
              label="save still"
              hint="s"
              onClick={run(props.onGrabStill)}
            />
            <MenuItem
              icon={props.recording ? '■' : '●'}
              label={props.recording ? 'stop recording' : 'start recording'}
              hint="r"
              onClick={run(props.onToggleRecord)}
            />
            <div className={popoverStyles.menuSep} />
            <MenuItem
              icon={props.fullscreen ? '⤢' : '⛶'}
              label={props.fullscreen ? 'exit fullscreen' : 'fullscreen'}
              hint="f"
              onClick={run(props.onToggleFullscreen)}
            />
            <MenuItem
              icon="⧉"
              label={
                props.poppedOut ? 'focus controls window' : 'pop out controls'
              }
              hint=""
              onClick={run(props.onPopout)}
            />
            <div className={popoverStyles.menuSep} />
            <MenuItem
              icon={<GearIcon />}
              label="advanced settings"
              hint=""
              onClick={run(props.onShowAdvanced)}
            />
            <MenuItem
              icon="?"
              label="help / about"
              hint=""
              onClick={run(props.onShowHelp)}
            />
            <MenuItem
              icon="×"
              label="hide this bar"
              hint=""
              onClick={run(props.onHideBar)}
            />
          </>
        )
      }}
    </Popover>
  )
}

// A drag this short is a stray click, not a box — zooming to it would slam
// straight to maximum magnification.
const MIN_BOX = 0.02

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

// Zoom readout and lever, the first row of the stage menu: the gestures on the
// picture are the fast path, but nothing would otherwise say the magnifier
// exists. It stays put when used — a drag on the slider must not close the menu
// out from under the hand doing it.
function ZoomRow(props: { lens: Lens; onChange: (lens: Lens) => void }) {
  const { lens } = props
  const at = (zoom: number) => props.onChange({ ...lens, zoom })
  return (
    <div className={styles.zoomRow}>
      <span
        className={styles.zoomLabel}
        title="where your eye is — drag a box on the picture to close in, drag to move around the glass, double-click to go back to 1×. Below 1× it pulls back off the set."
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
        {zoomLabel(lens)}
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
  onShowChain: () => void
}) {
  const [barHidden, setBarHidden] = usePersistedFlag(BAR_HIDDEN_STORE)
  const [drag, setDrag] = useState<Drag | null>(null)
  const zoomed = clampZoom(props.lens.zoom) > 1
  // Canvas pixels, and the picture UV they land on. The canvas box is what the
  // shader letterboxes inside, so this is the same 4:3 mapping present.wgsl does.
  const at = (e: PointerEvent<HTMLCanvasElement>) => {
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
            ? 'drag to move around the glass · shift-drag a box to close in · double-click to pull back'
            : 'drag a box to zoom into it'
        }
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
          className={cx(styles.overlayBtn, styles.reopenBar)}
          onClick={() => setBarHidden(false)}
          title="show controls"
        >
          ⋯
        </button>
      ) : (
        <div className={styles.overlayBar}>
          <StageMenu
            recording={props.recording}
            fullscreen={props.fullscreen}
            poppedOut={props.poppedOut}
            lens={props.lens}
            onLens={props.onLens}
            onGrabStill={props.onGrabStill}
            onToggleRecord={props.onToggleRecord}
            onToggleFullscreen={props.onToggleFullscreen}
            onPopout={props.onPopout}
            onShowHelp={props.onShowHelp}
            onShowAdvanced={props.onShowAdvanced}
            onShowChain={props.onShowChain}
            onHideBar={() => setBarHidden(true)}
          />
        </div>
      )}
      <FpsMonitor stats={props.stats} res={props.res} />
    </div>
  )
}
