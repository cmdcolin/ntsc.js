import { useEffect, useState } from 'react'

import type { Engine } from '../gpu/pipeline'

// Audio input state for the UI. The per-line waveform goes straight to the GPU
// each frame without touching React; only the meter comes back here, polled at
// 10 Hz so a level readout never drives a re-render per frame.
export function useAudio(engine: Engine | null) {
  const [active, setActive] = useState(false)
  const [level, setLevel] = useState(0)
  const [hit, setHit] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let id = 0
    if (active && engine !== null) {
      id = window.setInterval(() => {
        setLevel(engine.audioState.level)
        setHit(engine.audioState.hit)
      }, 100)
    }
    return () => clearInterval(id)
  }, [active, engine])

  return {
    active,
    level,
    hit,
    error,
    enableMic: () => {
      if (engine !== null) {
        engine.audioState
          .enableMic()
          .then(() => {
            setActive(true)
            setError(null)
          })
          .catch((e: unknown) =>
            setError(`microphone unavailable: ${String(e)}`),
          )
      }
    },
    disable: () => {
      engine?.audioState.disconnect()
      setActive(false)
      setLevel(0)
      setHit(0)
    },
  }
}
