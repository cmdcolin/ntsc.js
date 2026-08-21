import { DEFAULT_CONTROLS } from '../core/controls'
import { clamp01 } from '../core/math'
import { sliderFor } from './controls'
import { useControlValue, useControlsApi } from './ControlsContext'
import { cx } from './cx'
import styles from './Deck.module.css'
import { LOOP_TRANSPORT, SHUTTLE_STOPS } from './deckModel'
import { fromTravel, toTravel, TRAVEL_STEP } from './travel'

import type { SliderDef } from './controls'
import type { CSSProperties } from 'react'

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
//
// A range input, not a div with pointer handlers. That was ~50 lines of
// capture, a DOMRect frozen at the press, and a hand-drawn fill and thumb — and
// none of it reachable from a keyboard, which the lever and the pads beside it
// both were. The frozen box in particular was working around a problem the
// browser does not have: it existed because the first nudge takes the speed off
// stock, which grows "This look" at the top of the panel and shoves every row
// below it, so a gesture measured against clientX aimed at a strip that had
// moved. A range input tracks its own thumb and never notices.
function ShuttleStrip(props: {
  span: SliderDef
  value: number
  disabled: boolean
  title: string
  onChange: (v: number) => void
}) {
  // Where the fill runs from and to: the row's stock — play, on both of these —
  // out to where the ring is set, which is the panel's reading of every other
  // track. The tick that marks the default is the play detent for free.
  const pct = (v: number) => clamp01(toTravel(props.span, v)) * 100
  const at = pct(props.value)
  const def = pct(DEFAULT_CONTROLS[props.span.key])
  const fill: CSSProperties & Record<'--lo' | '--hi' | '--def', string> = {
    '--lo': `${Math.min(at, def)}%`,
    '--hi': `${Math.max(at, def)}%`,
    '--def': `${def}%`,
  }
  return (
    <input
      type="range"
      className={cx(styles.shuttle, props.disabled && styles.shuttleOff)}
      style={fill}
      title={props.title}
      aria-label={props.span.label}
      // The travel is what the input rides, so what it would announce is a
      // 0..1 fraction. The speed is the honest reading, and the one the number
      // beside the strip shows.
      aria-valuetext={`${props.value}x`}
      disabled={props.disabled}
      min={0}
      max={1}
      step={TRAVEL_STEP}
      value={toTravel(props.span, props.value)}
      // Back to play, which is the only stop on here the picture survives.
      onDoubleClick={() => props.onChange(DEFAULT_CONTROLS[props.span.key])}
      onChange={e => {
        const v = fromTravel(props.span, Number(e.target.value))
        // Detents at pause and play, the two speeds worth being able to hit
        // exactly: a ring you cannot park on play is a ring that never gives
        // the picture back. Only pause needs the help now — play is the stock
        // value, so the double-click above lands on it too.
        const snapped = [0, 1, -1].find(d => Math.abs(v - d) < 0.12)
        props.onChange(snapped ?? Number(v.toFixed(2)))
      }}
    />
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
