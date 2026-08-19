import { useEffect, useRef } from 'react'

import { cx } from './cx'
import styles from './Meter.module.css'

import type { AudioState } from '../core/signal/audiostate'

// Level bar for audio onsets, green until it is loud and red near clipping. The
// track carries the gradient at full size and an unlit mask eats back from the
// loud end, so the colour at a given level never shifts as the level moves.
//
// The envelope it shows falls away in ~0.2 s, so sampling it into React state at
// 10 Hz aliased the kick: two samples per punch, landing at whatever phase of
// the decay the timer happened to fire. It reads the live value every animation
// frame instead and writes the one style property itself — same cadence the
// engine updates the envelope at, and still no re-render per frame.
export function Meter({
  audio,
  orient,
}: {
  audio: AudioState
  orient: 'h' | 'v'
}) {
  const unlitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      const el = unlitRef.current
      if (el !== null) {
        const lit = Math.min(Math.max(audio.hit, 0) * 100, 100)
        const unlit = `${(100 - lit).toFixed(1)}%`
        if (orient === 'h') {
          el.style.width = unlit
        } else {
          el.style.height = unlit
        }
      }
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [audio, orient])

  const h = orient === 'h'
  return (
    <div className={cx(styles.meter, h ? styles.meterH : styles.meterV)}>
      <div
        ref={unlitRef}
        className={cx(styles.unlit, h ? styles.unlitH : styles.unlitV)}
      />
    </div>
  )
}
