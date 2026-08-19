import { useState } from 'react'

import { cx } from './cx'
import { clampZoom, panLens, pictureUv, zoomToBox } from './lens'
import styles from './Stage.module.css'
import ui from './ui.module.css'

import type { FrozenKind } from '../core/gpu/renderloop'
import type { Lens } from './lens'
import type { PointerEvent, ReactNode, RefObject } from 'react'

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

export function Stage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  error: string
  frozen: FrozenKind | null
  rebuilding: 'lost' | 'hung' | null
  // What has been spent on GPU devices — `builds` by this page, `releases` by this
  // tab — and whether that is worth telling the user about (gpuAtRisk in
  // gpu/context.ts). Said on the stage while the stage is still being painted,
  // because that is the only window in which saying it is any use — once the tab
  // loses its rendering step, nothing the DOM says arrives.
  budget: { builds: number; releases: number; atRisk: boolean }
  lens: Lens
  onLens: (lens: Lens) => void
  // Which tool a plain drag on the picture is: the crosshair that boxes a region
  // to zoom into, or the hand that pushes the magnified picture around. Armed
  // from the masthead rather than decided here, which is why it arrives as a
  // prop — see the switch in app.tsx for what it replaced.
  boxZoom: boolean
  // The corner of chrome over the picture, or null for a picture with nothing on
  // it. Handed in rather than built here: what goes in it is the app's own menu
  // (AppMenu), which is normally in the masthead and only comes over the picture
  // where the panel is off this window's screen. The stage owns where it sits,
  // app.tsx owns whether there is anything to sit there.
  chrome: ReactNode
}) {
  // Pulled out rather than read as `props.canvasRef` at the <canvas>: a ref read
  // off the props object marks the whole object as ref-ish to the React Compiler,
  // which then refuses every other `props.x` read as a ref access during render
  // and drops this component's memoization entirely.
  const { canvasRef } = props
  const [drag, setDrag] = useState<Drag | null>(null)
  // The build count the notice was dismissed at, not a boolean: building another
  // device is new news about the same subject, so it comes back for that and stays
  // gone otherwise. Not persisted — it is a property of this page's spending, and a
  // reload has built nothing yet.
  const [budgetSeen, setBudgetSeen] = useState(0)
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
      {/* `alert`, not a bare div: every async failure in the app ends at this
          one banner — a video that would not decode, a pool that returned
          nothing, a stash that could not be reopened — and it appears over a
          canvas whose whole content is invisible to a screen reader. Without a
          live region the failure is simply not announced, and the picture not
          changing is the only other evidence there was one. */}
      {props.error !== '' && (
        <div className={styles.error} role="alert">
          {props.error}
        </div>
      )}
      {/* The GPU handed the device back — a driver reset, a sleep/wake. The
          session rebuilds itself, so this says what the gap is rather than
          offering a button; it clears itself when the picture returns. Ahead of
          the frozen notice and exclusive with it: a loss can land on a tab that
          was already stalled, and two centred boxes would sit on top of each
          other — this one is the newer news and the one that resolves itself. */}
      {/* `status` rather than `alert` for both notices below: they are the app
          reporting on itself, and one of them resolves on its own. An assertive
          region would cut off whatever was being read at the moment the GPU
          blinked, which is the wrong trade for news that is still true a second
          later. */}
      {props.rebuilding !== null ? (
        <div className={cx(styles.frozen, styles.rebuilding)} role="status">
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
      ) : props.frozen !== null ? (
        <div className={styles.frozen} role="status">
          {/* Both say the app is fine and the frames aren't arriving. They
              differ on the only thing the reader can act on. A stall came back
              in recorded sessions and a reload is reasonable; a cold tab has
              never had one animation frame since it loaded, so the fault
              belongs to the tab and a reload lands in the same hole — measured,
              not inferred (docs/adr/0002). Offering "reload" there is offering
              the one thing that cannot work. */}
          <b>
            {props.frozen === 'cold'
              ? 'this tab will not paint — open a new one'
              : 'the browser stopped painting this tab'}
          </b>
          <span>
            {props.frozen === 'cold' ? (
              <>
                The app and the GPU are both still running, but this tab has
                never been given a single animation frame since it loaded. That
                belongs to the tab rather than the page, so reloading lands in
                the same place —{' '}
                {/* The advice, as something that can be clicked. It used to
                    name the action and leave the reader to perform it next to a
                    reload button that cannot work. */}
                <a
                  className={ui.link}
                  href={location.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  open this look in a new tab
                </a>
                .
              </>
            ) : (
              <>
                The app and the GPU are both still running — rendered frames
                just aren&apos;t reaching the screen. It clears itself if the
                browser resumes; if it doesn&apos;t, close the tab and open it
                again.
              </>
            )}
          </span>
          <button className={ui.btn} onClick={() => location.reload()}>
            reload
          </button>
        </div>
      ) : null}
      {/* Nothing has gone wrong yet, and that is the point of saying it now: the
          picture is live, the DOM is being painted, and the way this fails is that
          both stop for the life of the tab. Shown under the two notices above
          because either of them is the more urgent news.

          Two things can raise it, and they are not equally bad — a destroyed
          device is the measured killer, a pile of created ones only means the
          device keeps going away — so they get different sentences, and only the
          first one offers a new tab. Telling someone whose card suspends on every
          alt-tab to move tabs would send them somewhere the same thing happens,
          having implied their working session was doomed.

          `builds` counts devices this *page* made, which is what makes the
          rebuilding sentence true when it appears. Against the tab's lifetime
          total it also counted reloads, and a reload makes a fresh document that
          leaves its device behind — so this used to open on the third refresh of a
          perfectly healthy session and tell the reader their working tab was
          rebuilding itself. */}
      {props.budget.atRisk && budgetSeen !== props.budget.builds ? (
        <div className={styles.budget}>
          {props.budget.releases > 0 ? (
            <span>
              <b>this tab has released a GPU device</b> ({props.budget.releases}{' '}
              destroyed). A browser that has been handed back a presenting
              device may stop painting this tab, and a reload does not clear
              that —{' '}
              <a
                className={ui.link}
                href={location.href}
                target="_blank"
                rel="noreferrer"
              >
                carry this look into a new tab
              </a>{' '}
              to start clean.
            </span>
          ) : (
            <span>
              <b>this page keeps rebuilding its GPU engine</b> (
              {props.budget.builds} devices built for this page). The device has
              gone away and been replaced that many times, and each replacement
              starts the phosphor, the frame store and the tape loop empty. The
              session carries on; if it keeps happening the fault is below the
              app — a driver, or a card suspending — rather than in the look.
            </span>
          )}
          <button
            className={styles.budgetDismiss}
            title="hide until another device is spent"
            onClick={() => setBudgetSeen(props.budget.builds)}
          >
            ✕
          </button>
        </div>
      ) : null}
      {props.chrome === null ? null : (
        <div className={styles.overlayBar}>{props.chrome}</div>
      )}
    </div>
  )
}
