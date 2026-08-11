import { use, useEffect, useRef, useState } from 'react'

import {
  ControlStoreContext,
  useControls,
  useControlsApi,
} from './ControlsContext'
import { cx } from './cx'
import {
  B_ON_AIR,
  TAKE_SECONDS,
  barCut,
  barInert,
  barPosition,
  barThrow,
  takeAt,
  wipeEngaged,
} from './deck'
import styles from './Deck.module.css'

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

// Left is A, right is B.
//
// A real T-bar throws vertically, and an earlier draft of this did too. It cost
// 140px of panel height to say what a 16px strip says, and the sidebar it lives
// in is a column — every vertical control in it is height taken from the stages
// below. The gesture that matters here is the *continuous throw you can stop
// anywhere*, and that survives the rotation intact; the axis was the part of the
// metaphor that was only ever decoration.
//
// Measured against the track's box as it was when the throw began, not as it is
// each frame: the first move takes wipePos or bGain off stock, which grows
// "This look" at the top of the panel and moves everything below it. A
// horizontal throw survives the vertical shove that causes today, but only by
// luck — the deck sits above two sections that can also change width.
const posFrom = (e: ReactPointerEvent<HTMLDivElement>, box: DOMRect) =>
  Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))

// The transition lever.
//
// A switcher's T-bar is one throw that means whatever the transition-type
// buttons beside it say it means — which is exactly the relationship bGain and
// wipePos have in mix_b, and exactly the relationship two sliders in two
// different folds of the panel cannot show. `barThrow` is where that lives; this
// is the hand on it.
//
// It does not spring back, and that is the part of the lever that had to
// survive: a fader you can let go of mid-throw is what makes a half-dissolve a
// place you can sit rather than a moment you pass through.
export function TBar() {
  const controls = useControls()
  const { writeControl, writeControls } = useControlsApi()
  // The store, not this render's snapshot, is what an auto-take reads: the
  // animation outlives the render that started it, and a preset landing or a
  // knob moving mid-take has to be composited rather than clobbered by a
  // controls object captured a second ago. Both halves of the store keep their
  // identity across a write, so the frame loop can hold onto it.
  const store = use(ControlStoreContext)
  const [grab, setGrab] = useState<DOMRect | null>(null)
  const [takeIndex, setTakeIndex] = useState(1)
  const [taking, setTaking] = useState(false)
  const raf = useRef(0)

  const p = barPosition(controls)
  const wiping = wipeEngaged(controls.wipeMode)
  const inert = barInert(controls)

  const throwTo = (pos: number) => writeControls(barThrow(store.get(), pos))

  const stopTake = () => {
    cancelAnimationFrame(raf.current)
    setTaking(false)
  }

  // An auto-take is a machine running on its own, not a render to keep in sync
  // with one: it is started by the press, it reads the store and writes the
  // store, and React is told about it only so the button can offer to stop it.
  const startTake = () => {
    const from = barPosition(store.get())
    const to = from < 0.5 ? 1 : 0
    const seconds = TAKE_SECONDS[takeIndex]
    const began = performance.now()
    const step = (now: number) => {
      const pos = takeAt(from, to, (now - began) / 1000, seconds)
      writeControls(barThrow(store.get(), pos))
      if (pos === to) setTaking(false)
      else raf.current = requestAnimationFrame(step)
    }
    setTaking(true)
    raf.current = requestAnimationFrame(step)
  }

  // The one thing here React does own: a take still running when the deck is
  // folded away would keep writing controls at 60 Hz with nothing on screen.
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.1 : 0.02
    const to = new Map([
      ['ArrowRight', p + d],
      ['ArrowUp', p + d],
      ['ArrowLeft', p - d],
      ['ArrowDown', p - d],
      ['Home', 0],
      ['End', 1],
    ]).get(e.key)
    if (to !== undefined) {
      e.preventDefault()
      throwTo(to)
    }
  }

  return (
    <>
      <div className={styles.tbar}>
        <span className={styles.tbarEnd}>A</span>
        <div
          className={cx(styles.track, inert && styles.trackInert)}
          role="slider"
          tabIndex={0}
          aria-label={wiping ? 'wipe lever' : 'A/B crossfade'}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(p.toFixed(3))}
          title={
            wiping
              ? 'the wipe lever — a pattern is armed, so the throw moves the boundary'
              : 'the crossfade — full A at the left, full B at the right'
          }
          onPointerDown={e => {
            // A take is a hands-off gesture; touching the bar is taking it back.
            stopTake()
            const box = e.currentTarget.getBoundingClientRect()
            e.currentTarget.setPointerCapture(e.pointerId)
            setGrab(box)
            throwTo(posFrom(e, box))
          }}
          onPointerMove={e => {
            if (grab !== null) throwTo(posFrom(e, grab))
          }}
          onPointerUp={e => {
            e.currentTarget.releasePointerCapture(e.pointerId)
            setGrab(null)
          }}
          onPointerCancel={() => setGrab(null)}
          onKeyDown={e => key(e)}
        >
          <div className={styles.trackFill} style={{ width: `${p * 100}%` }} />
          <div className={styles.handle} style={{ left: `${p * 100}%` }} />
        </div>
        <span className={styles.tbarEnd}>B</span>
        <span className={styles.nums}>{p.toFixed(2)}</span>
        <button
          className={styles.deckBtn}
          title="cut — throw the bar to the other end now"
          onClick={() => {
            stopTake()
            writeControls(barCut(store.get()))
          }}
        >
          cut
        </button>
        <button
          className={cx(styles.deckBtn, taking && styles.deckBtnOn)}
          title={
            taking
              ? 'stop the take where it is'
              : `auto-take — run the bar to the other end over ${TAKE_SECONDS[takeIndex]}s`
          }
          onClick={() => (taking ? stopTake() : startTake())}
        >
          {taking ? 'stop' : 'take'}
        </button>
        <button
          className={styles.rate}
          title="how long an auto-take runs — click to cycle"
          onClick={() => setTakeIndex((takeIndex + 1) % TAKE_SECONDS.length)}
        >
          {`${TAKE_SECONDS[takeIndex]}s`}
        </button>
      </div>
      {/* Only when it has something to say. What the lever is throwing is
          already on screen — the lit pattern button directly above it — so a
          permanent caption under the bar would be a line of the panel spent
          repeating it. */}
      {inert ? (
        <button
          className={styles.fix}
          title="mix_b multiplies the wipe gate into B's level, so the boundary moves and nothing appears"
          onClick={() => writeControl('bGain', B_ON_AIR)}
        >
          B is at 0 — click to open the fader
        </button>
      ) : null}
    </>
  )
}
