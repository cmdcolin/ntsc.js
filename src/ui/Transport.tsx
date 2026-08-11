import { useState } from 'react'

import { sliderFor } from './controls'
import { useControlValue, useControlsApi } from './ControlsContext'
import { cx } from './cx'
import { LOOP_TRANSPORT, SHUTTLE_STOPS } from './deck'
import styles from './Deck.module.css'
import { fromTravel, toTravel } from './travel'

import type { SliderDef } from './controls'
import type { PointerEvent } from 'react'

// The two rows the strips below throw, read off the schema rather than restated
// here. A span is all the curve needs (min, max, step, curve), so taking the
// SliderDef whole is what makes it impossible for the deck's strip and the stage
// row for the same control to disagree about where play sits — which is exactly
// what they did while the ring's geometry lived in the deck alone.
const TAPE_SPAN: SliderDef = sliderFor('shuttleX')
const LOOP_SPAN: SliderDef = sliderFor('tapeShuttle')

// The shuttle ring, flattened into a strip.
//
// Geometric in speed (the 'shuttle' curve — see curve.ts), because the
// interesting half of a shuttle is between pause and double and a linear track
// hands that four pixels. Bipolar or not according to the span it is given: the
// delay loop's transport carries its own direction switch, so its ring runs
// forwards only, and the tape deck's does not, so its ring is signed.
function ShuttleStrip(props: {
  span: SliderDef
  value: number
  disabled: boolean
  title: string
  onChange: (v: number) => void
}) {
  // Frozen at the press, like the pads and the lever: the first nudge takes the
  // speed off stock, which grows "This look" at the top of the panel and moves
  // every row below it.
  const [grab, setGrab] = useState<DOMRect | null>(null)
  const t = toTravel(props.span, props.value)
  // Where the throw sits along the drawn strip, and where zero is on it.
  const frac = t
  const zero = toTravel(props.span, 0)

  const set = (e: PointerEvent<HTMLDivElement>, box: DOMRect) => {
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const v = fromTravel(props.span, x)
    // Detents at pause and play, the two speeds worth being able to hit
    // exactly: a ring you cannot park on play is a ring that never gives the
    // picture back.
    const snapped = [0, 1, -1].find(d => Math.abs(v - d) < 0.12)
    props.onChange(snapped ?? Number(v.toFixed(2)))
  }

  return (
    <div
      className={cx(styles.shuttle, props.disabled && styles.shuttleOff)}
      title={props.title}
      onPointerDown={e => {
        if (props.disabled) return
        const box = e.currentTarget.getBoundingClientRect()
        e.currentTarget.setPointerCapture(e.pointerId)
        setGrab(box)
        set(e, box)
      }}
      onPointerMove={e => {
        if (grab !== null && !props.disabled) set(e, grab)
      }}
      onPointerUp={e => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setGrab(null)
      }}
      onPointerCancel={() => setGrab(null)}
    >
      {/* Play speed, marked on the strip rather than left to be found: it is the
          only setting on here at which the head follows one track. */}
      <div
        className={styles.detent}
        style={{ left: `${toTravel(props.span, 1) * 100}%` }}
      />
      {zero > 0 ? (
        <div className={styles.detent} style={{ left: `${zero * 100}%` }} />
      ) : null}
      <div
        className={styles.shuttleFill}
        style={{
          left: `${Math.min(frac, zero) * 100}%`,
          width: `${Math.abs(frac - zero) * 100}%`,
        }}
      />
      <div className={styles.shuttleThumb} style={{ left: `${frac * 100}%` }} />
    </div>
  )
}

// The deck playing the incoming tape: one speed control, signed, with the four
// speeds that are worth a button. Its own transport, and deliberately not the
// delay loop's below — they are two machines, and the tape in each was written at
// a different time by a different head. Folding them into one set of buttons
// would be the tidier panel and the wrong signal path.
//
// Head speed, and only that. It is not the clip's playhead and never was: that
// lives under the source picker, where the timeline it addresses is. See
// SHUTTLE_STOPS for why the keys read as numbers rather than as ◀◀ ❚❚ ▶ ▶▶.
export function TapeTransport() {
  const shuttleX = useControlValue('shuttleX')
  const { writeControl } = useControlsApi()
  return (
    <div className={styles.deckRow}>
      <div
        className={styles.deckLabel}
        title="the deck playing the incoming tape — how fast its head sweeps, not the clip’s playhead. At 1x the head follows one recorded track and the picture is clean"
      >
        tape deck
      </div>
      <div className={styles.stops}>
        {SHUTTLE_STOPS.map(s => (
          <button
            key={s.label}
            className={cx(
              styles.deckBtn,
              shuttleX === s.value && styles.deckBtnOn,
            )}
            title={s.title}
            onClick={() => writeControl('shuttleX', s.value)}
          >
            {s.label}
          </button>
        ))}
        <ShuttleStrip
          span={TAPE_SPAN}
          value={shuttleX}
          disabled={false}
          title="tape speed as a multiple of play — off 1 the head crosses tracks and the noise bars start"
          onChange={v => writeControl('shuttleX', v)}
        />
        <span className={styles.nums}>{`${shuttleX}x`}</span>
      </div>
    </div>
  )
}

// The delay loop's own deck. Everything here needs the record head lifted — a
// loop that is still being written over has nothing to shuttle through — so the
// gate is stated once, on the head, and the rest goes quiet behind it rather
// than each button repeating the note.
export function LoopTransport() {
  const tapeMix = useControlValue('tapeMix')
  const tapeRecord = useControlValue('tapeRecord')
  const tapeTransport = useControlValue('tapeTransport')
  const tapeShuttle = useControlValue('tapeShuttle')
  const { writeControl } = useControlsApi()
  const held = tapeRecord < 0.5
  const threaded = tapeMix > 0
  return (
    <div className={styles.deckRow}>
      <div
        className={styles.deckLabel}
        title="the loop of tape threaded through the feedback path — not the deck above it, which is what the incoming tape is played back on"
      >
        tape loop
      </div>
      <div className={styles.stops}>
        <button
          className={cx(styles.deckBtn, !held && styles.deckBtnRec)}
          title={
            held
              ? 'the record head is lifted — the loop repeats what it has. Drop it to start recording over.'
              : 'the record head is down, taking in the live picture. Lift it to hold the loop.'
          }
          onClick={() => writeControl('tapeRecord', held ? 1 : 0)}
        >
          ●
        </button>
        {LOOP_TRANSPORT.map((glyph, i) => (
          <button
            key={glyph}
            className={cx(
              styles.deckBtn,
              held && Math.round(tapeTransport) === i && styles.deckBtnOn,
            )}
            disabled={!held}
            title={loopTitle(i)}
            onClick={() => writeControl('tapeTransport', i)}
          >
            {glyph}
          </button>
        ))}
        <ShuttleStrip
          span={LOOP_SPAN}
          value={tapeShuttle}
          disabled={!held}
          title="how fast the held loop runs past the heads — the transport buttons give the direction"
          onChange={v => writeControl('tapeShuttle', Math.abs(v))}
        />
        <span className={styles.nums}>{`${tapeShuttle}x`}</span>
      </div>
      {threaded ? null : (
        <button
          className={styles.fix}
          title="nothing is threaded through the heads yet"
          onClick={() => writeControl('tapeMix', 0.5)}
        >
          no tape in the path — click to thread the loop
        </button>
      )}
    </div>
  )
}

const loopTitle = (i: number) =>
  [
    'reverse — the frames play back in the order they were laid down',
    'stopped — the tape parks and the drum re-reads one sweep',
    'forward — play',
    'scrub — the drum stalls and the head drags the waveform back end-first',
  ][i]
