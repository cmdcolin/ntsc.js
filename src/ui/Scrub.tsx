import styles from './Scrub.module.css'

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
  meter?: ReactNode
  onSeek: (time: number) => void
}) {
  const fill: CSSProperties & Record<'--p', string> = {
    '--p': `${((props.time / props.duration) * 100).toFixed(1)}%`,
  }
  return (
    <div className={styles.scrubRow}>
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
      {props.meter}
      <span className={styles.scrubTime}>
        {clock(props.time)} / {clock(props.duration)}
      </span>
    </div>
  )
}
