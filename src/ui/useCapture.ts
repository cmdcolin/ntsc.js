import { useEffect, useRef, useState } from 'react'

import { isSupported, startRecording } from './record'

import type { Recorder } from './record'
import type { RefObject } from 'react'

const pad2 = (n: number) => String(n).padStart(2, '0')

// yyyymmdd-hhmmss, so saved files sort chronologically and never collide.
function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function fileName(name: string, ext: string): string {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `ntsc.js-${slug}-${stamp()}.${ext}`
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// The rate the file is written at, and it is the simulation's own: the signal
// path is a fixed-timestep 60Hz sim (`signal/modstate.ts` is `const DT = 1/60`,
// and the artifacts clock off the frame counter), so any other number would be
// a file whose timing disagrees with what produced it.
const FPS = { num: 60, den: 1 }

// A still still needs the 2D mirror, and that is not an oversight: `toBlob` on
// a WebGPU canvas comes back blank in Firefox because the presented drawing
// buffer is not retained for async readback, while `drawImage` out of it
// synchronously does work. The *recording* path no longer needs the mirror —
// `new VideoFrame(canvas)` reads the WebGPU canvas directly (see record.ts) —
// which is the copy per frame this used to cost.
function mirrorOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  canvas.getContext('2d')?.drawImage(src, 0, 0)
  return canvas
}

// Save the rendered canvas as a PNG still or a constant-framerate MP4.
// Downstream of `present` — the same pixels the user sees — so nothing touches
// the signal path. Recording holds the window visible (rAF at full rate) by
// design.
export function useCapture(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  name: string,
  onError: (message: string) => void,
) {
  const recRef = useRef<Recorder | null>(null)
  const rafRef = useRef(0)
  const [recording, setRecording] = useState(false)

  // The encoder and its rAF pump are browser objects that outlive React, so a
  // teardown mid-recording would leave both running forever. Aborted rather
  // than finished, unlike the `MediaRecorder` this replaces: that one could
  // flush a clip to disk on the way out, and a download started from an
  // unmounting tree is not a thing that reliably lands.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      recRef.current?.abort()
      recRef.current = null
    },
    [],
  )

  const grabStill = () => {
    const canvas = canvasRef.current
    if (canvas !== null) {
      // Drawn inside a frame: Chrome only keeps the WebGPU drawing buffer
      // readable during a paint, so a synchronous drawImage from the event
      // handler copies a blank buffer.
      requestAnimationFrame(() => {
        mirrorOf(canvas).toBlob(blob => {
          if (blob !== null) save(blob, fileName(name, 'png'))
        }, 'image/png')
      })
    }
  }

  const stop = async () => {
    const rec = recRef.current
    cancelAnimationFrame(rafRef.current)
    recRef.current = null
    setRecording(false)
    if (rec === null) return
    try {
      save(await rec.finish(), fileName(name, 'mp4'))
    } catch (e) {
      onError(`recording failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const toggleRecord = () => {
    if (recRef.current !== null) {
      void stop()
      return
    }
    const canvas = canvasRef.current
    if (canvas === null) return
    if (!isSupported()) {
      onError('this browser cannot encode video (WebCodecs is missing)')
      return
    }
    // The size is fixed for the whole recording, unlike the stream this
    // replaces, which tracked the canvas and changed resolution mid-clip when
    // somebody went fullscreen. An encoder is configured once with a frame
    // size, and a file whose resolution changes halfway is one an editor has to
    // be told about — so going fullscreen now scales into the size the
    // recording started at, which is the behaviour a take actually wants.
    const width = canvas.width
    const height = canvas.height
    startRecording({ width, height, fps: FPS }).then(
      rec => {
        recRef.current = rec
        setRecording(true)
        const pump = () => {
          rafRef.current = requestAnimationFrame(pump)
          const live = canvasRef.current
          if (live !== null && recRef.current !== null) {
            // One frame per rAF, and the timestamp comes off the count rather
            // than the clock (record.ts). A slow frame therefore stretches the
            // take in real time and not in the file, which is the trade this
            // whole path exists to make.
            recRef.current.frame(live)
          }
        }
        rafRef.current = requestAnimationFrame(pump)
      },
      (e: unknown) => {
        onError(
          `could not start recording: ${e instanceof Error ? e.message : String(e)}`,
        )
      },
    )
  }

  return { recording, toggleRecord, grabStill }
}
