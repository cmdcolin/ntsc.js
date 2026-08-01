import { useEffect, useRef, useState } from 'react'

import type { Engine } from '../gpu/pipeline'

export const AUDIO_MODES = ['off', 'mic', 'file'] as const
export type AudioMode = (typeof AUDIO_MODES)[number]

export const AUDIO_DESC: Record<AudioMode, string> = {
  off: 'Off — no audio in',
  mic: 'Microphone — live room sound',
  file: 'File… — play a music or video file',
}

// Audio input state for the UI. The per-line waveform goes straight to the GPU
// each frame without touching React; only the meter comes back here, polled at
// 10 Hz so a level readout never drives a re-render per frame.
export function useAudio(engine: Engine | null) {
  const [mode, setMode] = useState<AudioMode>('off')
  const [name, setName] = useState('')
  const [hit, setHit] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Transport readout for a file source; duration stays 0 until metadata lands.
  const [play, setPlay] = useState({ time: 0, duration: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The playing file, held to pause it and free its blob URL on the next pick.
  const elRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let id = 0
    if (mode !== 'off' && engine !== null) {
      id = window.setInterval(() => {
        setHit(engine.audioState.hit)
        const el = elRef.current
        if (el !== null) {
          setPlay({
            time: el.currentTime,
            duration: Number.isFinite(el.duration) ? el.duration : 0,
          })
        }
      }, 100)
    }
    return () => clearInterval(id)
  }, [mode, engine])

  const stop = () => {
    const el = elRef.current
    if (el !== null) {
      el.pause()
      URL.revokeObjectURL(el.src)
      elRef.current = null
    }
    engine?.audioState.disconnect()
    setMode('off')
    setName('')
    setHit(0)
    setPlay({ time: 0, duration: 0 })
  }

  const enableMic = () => {
    if (engine !== null) {
      stop()
      engine.audioState.enableMic().then(
        () => setMode('mic'),
        (e: unknown) => setError(`microphone unavailable: ${String(e)}`),
      )
    }
  }

  const playFile = (file: File | undefined) => {
    if (file !== undefined && engine !== null) {
      stop()
      const el = new Audio(URL.createObjectURL(file))
      el.loop = true
      elRef.current = el
      engine.audioState.enableElement(el)
      el.play().then(
        () => {
          setMode('file')
          setName(file.name)
        },
        (e: unknown) => setError(`playback failed: ${String(e)}`),
      )
    }
  }

  return {
    mode,
    name,
    hit,
    error,
    time: play.time,
    duration: play.duration,
    active: mode !== 'off',
    fileInputRef,
    onFile: playFile,
    // Scrubbing moves the readout at once, so the thumb doesn't snap back and
    // wait out the poll interval.
    seek: (time: number) => {
      const el = elRef.current
      if (el !== null) {
        el.currentTime = time
        setPlay(p => ({ ...p, time }))
      }
    },
    // Picking 'file' only opens the dialog; state moves once a file is actually
    // chosen, so cancelling leaves whatever is playing alone.
    select: (next: AudioMode) => {
      setError(null)
      if (next === 'off') {
        stop()
      } else if (next === 'mic') {
        enableMic()
      } else {
        fileInputRef.current?.click()
      }
    },
  }
}
