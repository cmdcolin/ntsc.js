import { cx } from './cx'
import styles from './Scrub.module.css'

import type { Cue } from './cue'
import type { CSSProperties, ReactNode } from 'react'

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// Transport for a source with a timeline — the audio file, and either video
// slot holding a clip: drag to seek. The position polls at 10 Hz alongside the
// meter, so the thumb follows playback without a re-render per frame.
//
// Shared rather than per-caller because the fill is the point: the track paints
// in accent up to the playhead, which is what tells a seek bar apart from the
// knobs stacked above it. Two copies of that would be two things to keep
// looking alike.
export function Scrub(props: {
  time: number
  duration: number
  // The cue point, and the loop hanging off it, drawn on the track. Marked over
  // the bar rather than described in a readout beside it: "a little section of
  // this clip" is a shape, and the whole reason to draw it is so you can see
  // where in the clip you put it and how long it is without reading two numbers.
  cue?: { in: number; out: number | null } | null
  meter?: ReactNode
  onSeek: (time: number) => void
}) {
  const pc = (t: number) => `${((t / props.duration) * 100).toFixed(1)}%`
  const fill: CSSProperties & Record<'--p', string> = { '--p': pc(props.time) }
  const cue = props.cue ?? null
  return (
    <div className={styles.scrubRow}>
      <span className={styles.scrubTrack}>
        <input
          type="range"
          className={styles.scrub}
          style={fill}
          min={0}
          max={props.duration}
          step={0.01}
          value={Math.min(props.time, props.duration)}
          onChange={e => props.onSeek(Number(e.target.value))}
        />
        {/* Behind the thumb and ignoring pointers, so marking a loop never costs
            the drag that the bar is mainly for. A cue with no out-point is one
            tick — there is no span yet, and drawing a zero-width one would read
            as a loop that had somehow collapsed. */}
        {cue === null ? null : cue.out === null ? (
          <span className={styles.cueMark} style={{ left: pc(cue.in) }} />
        ) : (
          <span
            className={styles.cueSpan}
            style={{ left: pc(cue.in), width: pc(cue.out - cue.in) }}
          />
        )}
      </span>
      {props.meter}
      <span className={styles.scrubTime}>
        {clock(props.time)} / {clock(props.duration)}
      </span>
    </div>
  )
}

// The cue buttons for one slot with a timeline. Two gestures, and the second one
// is the reason the first is worth having:
//
//   ⇤   stab back to the cue and keep playing. On its own, hammered in time, this
//       is the stutter you get off a cue button — no loop involved.
//   cue one press marks the cue, the next closes a loop on it, the next re-arms.
//       See ui/cue.ts for why that is one button rather than two.
//
// Only the tap button is ever unavailable, and only before there is a clip under
// it; the retrigger goes quiet with no cue to return to, which is a different
// thing from being switched off and reads that way.
export function CueRow(props: {
  cue: Cue | null
  onTap: () => void
  onRetrigger: () => void
  onClear: () => void
  // What the jump back is costing, in ms, or null before there is a reading.
  // Reported, not judged — see the note on wrapCostMs in ui/cue.ts for why there
  // is no threshold behind this.
  wrapCost: number | null
  // Which slot's keys to name in the tooltips. The bindings live in
  // useShortcuts; naming them here is what makes them findable, since a key
  // nothing mentions is a key nobody presses.
  keys: { tap: string; retrigger: string }
}) {
  const { cue } = props
  const armed = cue !== null && cue.out === null
  const looping = cue !== null && cue.out !== null
  return (
    <div className={styles.cueRow}>
      <button
        className={cx(styles.cueBtn, styles.cueStab)}
        disabled={cue === null}
        title={`jump back to the cue and keep playing (${props.keys.retrigger}) — stab it in time for a stutter`}
        onClick={props.onRetrigger}
      >
        ⇤
      </button>
      <button
        className={cx(styles.cueBtn, looping && styles.cueBtnOn)}
        title={
          armed
            ? `close the loop here (${props.keys.tap}) — it starts repeating at once`
            : looping
              ? `drop this loop and mark a new cue here (${props.keys.tap})`
              : `mark a cue at the playhead (${props.keys.tap}) — press again to close a loop on it`
        }
        onClick={props.onTap}
      >
        {armed ? 'loop out' : 'cue'}
      </button>
      {/* The length, once there is one. A loop is judged by how long it is far
          more than by where it starts, and the span on the bar above already
          says where. */}
      {looping && cue.out !== null ? (
        <span className={styles.cueLen}>{(cue.out - cue.in).toFixed(2)}s</span>
      ) : armed ? (
        <span className={styles.cueHint}>cued</span>
      ) : null}
      {cue === null ? null : (
        <button
          className={styles.cueBtn}
          title="forget the cue and the loop"
          onClick={props.onClear}
        >
          ✕
        </button>
      )}
      {/* What this particular wrap costs, measured on this clip at this in-point
          over the laps it has run. Quiet, and stated rather than judged: anyone who
          does not care about it can ignore a small grey number, and anyone who does
          can re-mark the loop and watch it change, which is the actual remedy. A
          threshold could only have said "bad" — and could not be calibrated
          (ui/cue.ts). Inline rather than a second row: the panel is 332px. */}
      {looping && props.wrapCost !== null ? (
        <span
          className={styles.cueWrap}
          title={
            'What the jump back to the in-point costs, measured. The decoder has to ' +
            'start at the last keyframe before your in-point and decode forward to it, ' +
            'so this is set by how the file was encoded, not by the loop.\n\n' +
            'Under about 0.1s nothing is visible. Higher than that the picture catches ' +
            'on every lap: mark the loop somewhere else and watch this number — some ' +
            'in-points land near a keyframe and are cheap — or re-export the file with ' +
            'denser keyframes (ffmpeg -x264-params keyint=30).'
          }
        >
          wrap {(props.wrapCost / 1000).toFixed(2)}s
        </span>
      ) : null}
    </div>
  )
}
