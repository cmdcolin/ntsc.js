import styles from './AppMenu.module.css'
import { cx } from './cx'
import {
  FRAME_LOCK_HELP,
  FRAME_LOCK_LABEL,
  FRAME_LOCK_SHORT,
} from './frameLock'
import { CameraIcon, GearIcon, GraphIcon, MenuIcon } from './icons'
import { clampZoom, zoomAtTravel, zoomTravel } from './lens'
import { MenuItem, Popover } from './Popover'
import popoverStyles from './Popover.module.css'
import { tapFor } from './signalTap'
import { ToggleButtonGroup } from './ToggleButtonGroup'
import ui from './ui.module.css'

import type { Lens } from './lens'

// Magnification, as the menu trigger and the reset button both say it.
const zoomLabel = (lens: Lens) =>
  `${clampZoom(lens.zoom).toFixed(2).replace(/0$/, '')}×`

// Everything the app can do that isn't a control, behind one ☰.
//
// It used to be two menus a few hundred pixels apart — a ⋮ in the masthead for
// the board of controls, a ☰ over the picture for the picture — and the
// division was real but nobody was holding it: three rows (pop out, advanced,
// help) were in both, and the answer to "where is fullscreen" versus "where is
// the wide bench" was a distinction about what a menu is *of* that you had to
// already know to use. One list is shorter to read than two are to choose
// between.
//
// It lives at the far top right of the app, which in the ordinary layout is the
// masthead's right end — the panel is the right-hand pane, so its corner is the
// window's. `variant` is the other place it can be: fullscreen and the popout
// both take the panel off this window's screen, and from there the masthead's
// copy is not reachable, so the stage keeps one over the picture. Same rows,
// same order, a pill instead of a chrome square — the only row that differs is
// the one about the bar it is sitting in.
//
// Three states have to read without opening anything, so they ride on the
// closed trigger: recording (which has to carry across a room), a magnifier
// left anywhere but 1×, which would otherwise be an unexplained crop of the
// picture, and a live signal tap, which replaces the picture outright — the
// strongest case of the three, since without a badge the way back is a dialog
// you have to already know about.
export function AppMenu(props: {
  variant: 'masthead' | 'stage'
  recording: boolean
  fullscreen: boolean
  poppedOut: boolean
  lens: Lens
  onLens: (lens: Lens) => void
  tap: number
  frameLock: number
  onFrameLock: (v: number) => void
  onGrabStill: () => void
  onToggleRecord: () => void
  onToggleFullscreen: () => void
  bench: boolean
  // Whether there is width for a second column at all. Stacked under the
  // picture on a phone the flag is ignored by construction, so the row would be
  // a switch that visibly does nothing — it used to hide itself with a media
  // query, and moving it into the menu must not lose that.
  canBench: boolean
  onToggleBench: () => void
  onPopout: () => void
  showFps: boolean
  onToggleFps: () => void
  onShowPalette: () => void
  onShowAdvanced: () => void
  onShowHelp: () => void
  // Only the stage's copy has this: the bar being hidden is the one it is in,
  // and the masthead has no bar to hide.
  onHideBar?: () => void
}) {
  const { onHideBar } = props
  const stage = props.variant === 'stage'
  const zoomed = clampZoom(props.lens.zoom) !== 1
  return (
    <Popover
      trigger={attrs => (
        <button
          className={cx(
            stage ? styles.stageTrigger : ui.chromeBtn,
            !stage &&
              (zoomed || props.tap !== 0 || props.recording) &&
              styles.badged,
            props.recording && styles.recording,
          )}
          popoverTarget={attrs.popoverTarget}
          style={attrs.style}
          // The same sentence in both places, so the one thing a session learns
          // about this button survives going fullscreen.
          title={
            props.recording
              ? 'recording — click for options'
              : 'menu (s: still, r: record, f: fullscreen)'
          }
          aria-label="menu"
        >
          <MenuIcon />
          {zoomed ? (
            <span className={styles.triggerZoom}>{zoomLabel(props.lens)}</span>
          ) : null}
          {props.tap === 0 ? null : (
            <span className={styles.triggerTap}>{tapFor(props.tap).short}</span>
          )}
          {/* Spelt out over the picture, where the nearest reader may be at the
              back of a room, and a dot in the masthead, which is a 22px square
              an arm's length from the eye — the button goes red either way. */}
          {props.recording ? (stage ? '● rec' : '●') : null}
        </button>
      )}
    >
      {id => (
        <>
          {/* The ⌘K key used to be a button beside the filter box; with that
              row gone this is what says the palette exists at all. First,
              because it is the only row here that reaches the controls. */}
          <MenuItem
            icon=">"
            label="jump to anything"
            hint="⌘K"
            closes={id}
            onClick={props.onShowPalette}
          />
          <div className={popoverStyles.menuSep} />
          <ZoomRow lens={props.lens} onChange={props.onLens} />
          <LockRow value={props.frameLock} onChange={props.onFrameLock} />
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
          {/* Where the app sits: the three rows that move the picture and the
              board around rather than changing either. */}
          <MenuItem
            icon={props.fullscreen ? '⤢' : '⛶'}
            label={props.fullscreen ? 'exit fullscreen' : 'fullscreen'}
            hint="f"
            closes={id}
            onClick={() => props.onToggleFullscreen()}
          />
          {/* Stays open: this is the one row whose effect is visible behind the
              menu, and pressing it twice to compare the two widths should not
              cost re-opening the menu in between. */}
          {props.canBench ? (
            <MenuItem
              icon="▥"
              label={props.bench ? 'one column' : 'wide bench — two columns'}
              hint={props.bench ? 'on' : ''}
              onClick={props.onToggleBench}
            />
          ) : null}
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
          {/* The other half of the frame-lock row above: this is where a
              stutter gets noticed, and the readout badges the divisor the loop
              actually ran at, which under `auto` is the only thing that says
              whether the lock has engaged. */}
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
          {onHideBar === undefined ? null : (
            <>
              <div className={popoverStyles.menuSep} />
              <MenuItem
                icon="×"
                label="hide this bar"
                hint=""
                closes={id}
                onClick={() => onHideBar()}
              />
            </>
          )}
        </>
      )}
    </Popover>
  )
}

// The way back from "hide this bar". Same pill as the trigger it replaces,
// dimmed until the pointer finds it — over a picture with nothing else on it,
// this is the only chrome left.
export function ShowMenuButton(props: { onClick: () => void }) {
  return (
    <button
      className={styles.reopen}
      title="show the menu"
      aria-label="show the menu"
      onClick={() => props.onClick()}
    >
      ⋯
    </button>
  )
}

// Zoom readout and lever, the first widget row of the menu: the gestures on the
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

// The frame-rate lock, laid out rather than stepped through — under the zoom,
// because the two are the same kind of thing: neither touches the signal, both
// decide how the picture is presented. Zoom picks which part of it you get,
// this picks how often.
//
// Every setting on show, which is what the ask was and what frameLock.ts argues
// for: the rate you want is the one you are about to try, and a row that steps
// makes you pass through two others to reach it. The panel's own segmented
// control, so the row is the same widget as the one in Advanced and in Screen ·
// Display — three surfaces, one control, no third rendering of it.
function LockRow(props: { value: number; onChange: (v: number) => void }) {
  return (
    <div className={styles.lockRow}>
      <span className={styles.lockLabel} title={FRAME_LOCK_HELP}>
        ⏱
      </span>
      <div className={styles.lockGroup}>
        <ToggleButtonGroup
          label={FRAME_LOCK_LABEL}
          options={[...FRAME_LOCK_SHORT]}
          value={props.value}
          onChange={props.onChange}
        />
      </div>
    </div>
  )
}
