import { useState } from 'react'

import { cx } from './cx'
import { CameraIcon, GearIcon, GraphIcon, MenuIcon } from './icons'
import {
  clampZoom,
  panLens,
  pictureUv,
  zoomAtTravel,
  zoomToBox,
  zoomTravel,
} from './lens'
import { MenuItem, Popover } from './Popover'
import popoverStyles from './Popover.module.css'
import { nextTap, tapFor } from './signalTap'
import styles from './Stage.module.css'
import { usePersistedFlag } from './storage'
import ui from './ui.module.css'

import type { Lens } from './lens'
import type { PointerEvent, RefObject } from 'react'

// Persisted across reloads so a collapse sticks.
const BAR_HIDDEN_STORE = 'ntsc.js_overlay_bar_hidden'

// Magnification, as the menu trigger and the reset button both say it.
const zoomLabel = (lens: Lens) =>
  `${clampZoom(lens.zoom).toFixed(2).replace(/0$/, '')}×`

// Everything the stage can do, behind one button — the picture is the point,
// and a row of pills competing with it was not. Three states still have to read
// without opening anything, so they ride on the trigger: recording (which has
// to carry across a room), a magnifier left anywhere but 1×, which would
// otherwise be an unexplained crop of the picture, and a live signal tap, which
// replaces the picture outright — the strongest case of the three, since
// without a badge the way back is a dialog you have to already know about.
function StageMenu(props: {
  recording: boolean
  fullscreen: boolean
  poppedOut: boolean
  lens: Lens
  onLens: (lens: Lens) => void
  tap: number
  onTap: (v: number) => void
  onGrabStill: () => void
  onToggleRecord: () => void
  onToggleFullscreen: () => void
  onPopout: () => void
  showFps: boolean
  onToggleFps: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
  onHideBar: () => void
}) {
  return (
    <Popover
      trigger={attrs => (
        <button
          className={cx(styles.overlayBtn, props.recording && styles.recording)}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
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
          {props.tap === 0 ? null : (
            <span className={styles.triggerTap}>{tapFor(props.tap).short}</span>
          )}
          {props.recording ? '● rec' : null}
        </button>
      )}
    >
      {id => (
        <>
          <ZoomRow lens={props.lens} onChange={props.onLens} />
          <div className={popoverStyles.menuSep} />
          {/* Sits with the zoom rather than under Advanced only, for the same
              reason the zoom row does: the gesture-less way in is what says the
              thing exists at all, and this one is the app's whole premise made
              visible. A row that steps, not a picker — five taps is a short
              enough ring that stepping beats a dropdown inside a popover, and
              it means one place both enters and leaves the mode. */}
          <MenuItem
            icon="◫"
            label={
              props.tap === 0
                ? 'signal tap — see inside the decode'
                : `signal tap: ${tapFor(props.tap).short}`
            }
            hint={props.tap === 0 ? '' : 'on'}
            onClick={() => props.onTap(nextTap(props.tap))}
          />
          <div className={popoverStyles.menuSep} />
          <MenuItem
            icon={<CameraIcon />}
            label="save still"
            hint="s"
            closes={id}
            onClick={() => props.onGrabStill()}
          />
          <MenuItem
            icon={props.recording ? '■' : '●'}
            label={props.recording ? 'stop recording' : 'start recording'}
            hint="r"
            closes={id}
            onClick={() => props.onToggleRecord()}
          />
          <div className={popoverStyles.menuSep} />
          <MenuItem
            icon={props.fullscreen ? '⤢' : '⛶'}
            label={props.fullscreen ? 'exit fullscreen' : 'fullscreen'}
            hint="f"
            closes={id}
            onClick={() => props.onToggleFullscreen()}
          />
          <MenuItem
            icon="⧉"
            label={
              props.poppedOut ? 'focus controls window' : 'pop out controls'
            }
            hint=""
            closes={id}
            onClick={() => props.onPopout()}
          />
          <div className={popoverStyles.menuSep} />
          <MenuItem
            icon={<GraphIcon />}
            label={props.showFps ? 'hide fps' : 'show fps'}
            hint=""
            closes={id}
            onClick={() => props.onToggleFps()}
          />
          <MenuItem
            icon={<GearIcon />}
            label="advanced settings"
            hint=""
            closes={id}
            onClick={() => props.onShowAdvanced()}
          />
          <MenuItem
            icon="?"
            label="help / about"
            hint=""
            closes={id}
            onClick={() => props.onShowHelp()}
          />
          <MenuItem
            icon="×"
            label="hide this bar"
            hint=""
            closes={id}
            onClick={() => props.onHideBar()}
          />
        </>
      )}
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

// Canvas pixels, and the picture UV they land on. The canvas box is what the
// shader letterboxes inside, so this is the same 4:3 mapping present.wgsl does.
const at = (e: PointerEvent<HTMLCanvasElement>) => {
  const r = e.currentTarget.getBoundingClientRect()
  const p = { x: e.clientX - r.left, y: e.clientY - r.top }
  return { p, uv: pictureUv(r, p.x, p.y) }
}

// Zoom readout and lever, the first row of the stage menu: the gestures on the
// picture are the fast path, but nothing would otherwise say the magnifier
// exists. It stays put when used — a drag on the slider must not close the menu
// out from under the hand doing it.
function ZoomRow(props: { lens: Lens; onChange: (lens: Lens) => void }) {
  const { lens } = props
  const setZoom = (zoom: number) => props.onChange({ ...lens, zoom })
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
        onChange={e => setZoom(zoomAtTravel(Number(e.target.value)))}
      />
      <button
        className={styles.zoomReset}
        title="back to the picture filling the frame"
        onClick={() => setZoom(1)}
      >
        {zoomLabel(lens)}
      </button>
    </div>
  )
}

export function Stage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  error: string
  frozen: boolean
  rebuilding: 'lost' | 'hung' | null
  fullscreen: boolean
  poppedOut: boolean
  recording: boolean
  lens: Lens
  onLens: (lens: Lens) => void
  // Which tool a plain drag on the picture is: the crosshair that boxes a region
  // to zoom into, or the hand that pushes the magnified picture around. Armed
  // from the masthead rather than decided here, which is why it arrives as a
  // prop — see the switch in app.tsx for what it replaced.
  boxZoom: boolean
  tap: number
  onTap: (v: number) => void
  onToggleRecord: () => void
  onGrabStill: () => void
  onToggleFullscreen: () => void
  onPopout: () => void
  showFps: boolean
  onToggleFps: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
}) {
  // Pulled out rather than read as `props.canvasRef` at the <canvas>: a ref read
  // off the props object marks the whole object as ref-ish to the React Compiler,
  // which then refuses every other `props.x` read as a ref access during render
  // and drops this component's memoization entirely.
  const { canvasRef } = props
  const [barHidden, setBarHidden] = usePersistedFlag(BAR_HIDDEN_STORE)
  const [drag, setDrag] = useState<Drag | null>(null)
  const zoomed = clampZoom(props.lens.zoom) > 1
  // The armed tool, and shift for the other one. Shift used to mean "box" flatly
  // — which said nothing when box was already what a plain drag did — so reading
  // it as "the tool you are not holding" costs nothing and buys the whole pair
  // back in fullscreen and the popout, where the masthead switch is off screen.
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const { p } = at(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      a: p,
      b: p,
      box: e.shiftKey ? !props.boxZoom : props.boxZoom,
      from: props.lens,
    })
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
        ref={canvasRef}
        className={styles.canvas}
        // The armed tool, except that the hand is only offered where there is
        // something to move: `panLens` returns the lens untouched at 1×, so a
        // grab cursor over an unmagnified picture would promise a drag that
        // does nothing.
        style={{
          cursor:
            drag !== null && !drag.box
              ? 'grabbing'
              : props.boxZoom
                ? 'crosshair'
                : zoomed
                  ? 'grab'
                  : 'default',
        }}
        title={
          props.boxZoom
            ? 'drag a box to zoom into it · shift-drag moves the glass · double-click pulls back to 1×'
            : zoomed
              ? 'drag to move around the glass · shift-drag a box to close in · double-click pulls back to 1×'
              : 'nothing to move at 1× — shift-drag a box to close in, or switch back to the crosshair'
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
      {/* The GPU handed the device back — a driver reset, a sleep/wake. The
          session rebuilds itself, so this says what the gap is rather than
          offering a button; it clears itself when the picture returns. Ahead of
          the frozen notice and exclusive with it: a loss can land on a tab that
          was already stalled, and two centred boxes would sit on top of each
          other — this one is the newer news and the one that resolves itself. */}
      {props.rebuilding !== null ? (
        <div className={cx(styles.frozen, styles.rebuilding)}>
          {/* Two faults, one recovery. A device that announced it was going
              away and a device that just stopped answering want the same
              sentence about what survives and different ones about what
              happened — saying "lost" over a hang describes an event that did
              not occur, and the hang is the one a user is most likely to have
              caused by tabbing away. */}
          <b>
            {props.rebuilding === 'hung'
              ? 'the GPU stopped responding — rebuilding'
              : 'the GPU device was lost — rebuilding'}
          </b>
          <span>
            Your look, the modulation and the sources are all being put back.
            Anything the picture had built up — phosphor trails, the frame
            store, the tape loop — starts over.
          </span>
        </div>
      ) : props.frozen ? (
        <div className={styles.frozen}>
          <b>the browser stopped painting this tab</b>
          <span>
            The app and the GPU are both still running — rendered frames just
            aren&apos;t reaching the screen. It clears itself if the browser
            resumes; if it doesn&apos;t, close the tab and open it again.
          </span>
          <button className={ui.btn} onClick={() => location.reload()}>
            reload
          </button>
        </div>
      ) : null}
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
            tap={props.tap}
            onTap={props.onTap}
            onGrabStill={props.onGrabStill}
            onToggleRecord={props.onToggleRecord}
            onToggleFullscreen={props.onToggleFullscreen}
            onPopout={props.onPopout}
            showFps={props.showFps}
            onToggleFps={props.onToggleFps}
            onShowHelp={props.onShowHelp}
            onShowAdvanced={props.onShowAdvanced}
            onHideBar={() => setBarHidden(true)}
          />
        </div>
      )}
    </div>
  )
}
