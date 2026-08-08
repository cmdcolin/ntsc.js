import { useEffect, useRef, useState } from 'react'

import type { EngineApi } from '../gpu/engineapi'

export const AUDIO_MODES = ['off', 'mic', 'file', 'video'] as const
export type AudioMode = (typeof AUDIO_MODES)[number]

export const AUDIO_DESC: Record<AudioMode, string> = {
  off: 'Off — no audio in',
  mic: 'Microphone — live room sound',
  file: 'File… — play a music or video file',
  video: 'Video — the clip on screen, its own sound',
}

// Audio input state for the UI. The per-line waveform goes straight to the GPU
// each frame without touching React, and so does the level: the meter reads
// engine.audioState itself every animation frame. Only the transport readout
// comes back through state, polled at 10 Hz — a clock ticking in tenths does not
// need a re-render per frame, an onset envelope does.
//
// One source at a time, which is what makes this a picker rather than a set of
// switches: the clip's own sound track is a mode here (routeVideo, into the same
// analyser) rather than a button in Vaporwave, so picking a mic mutes the clip
// instead of leaving both on the wire. That exclusion is also the safe answer —
// a mic listening to a room with the clip playing out loud is a howl.
export function useAudio(
  engine: EngineApi | null,
  routeVideo: (on: boolean) => void,
) {
  const [mode, setMode] = useState<AudioMode>('off')
  const [name, setName] = useState('')
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
    // Mutes and unroutes the clips too: they are one of the four things this
    // picker picks between, so leaving them on the analyser while something
    // else is selected would put two sources on one wire.
    routeVideo(false)
    engine?.audioState.disconnect()
    setMode('off')
    setName('')
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
    audioState: engine === null ? null : engine.audioState,
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
      } else if (next === 'video') {
        // Nothing to adopt here: the clips are already elements the engine
        // owns, and it routes whichever slots are live — including ones picked
        // after this, since it re-applies the routing as sources change.
        stop()
        routeVideo(true)
        setMode('video')
      } else {
        fileInputRef.current?.click()
      }
    },
  }
}
