import { useCallback, useRef, useState } from 'react'

import { fileName, save } from './download'
import { renderTake, RenderCancelled } from './render'

import type { EngineApi } from '../gpu/engineapi'
import type { RefObject } from 'react'

// The offline render, as something a button can press.
//
// Thin on purpose: `render.ts` owns the loop, the clock and the encoder, and
// what is left here is the three things React has to know — whether one is
// running, how far along, and how to stop it.
//
// **Rendering is not recording, and the tray says so by having both.** The
// recorder follows the picture in real time and is what you want while playing;
// this takes the frames away from the screen and produces a file whose timing
// is the simulation's rather than the tab's. The visible difference is that a
// render is *faster than real time* when the GPU allows and slower when it does
// not, and either way the file comes out the same length.

// What a take is worth rendering at. The simulation's own rate — anything else
// would be a file whose timing disagrees with what produced it.
const FPS = 60

export interface RenderApi {
  // 0..1 while a render is running, null when none is. One value rather than a
  // boolean and a number: "busy" is exactly "progress is not null", and two
  // fields is two chances for them to disagree.
  progress: number | null
  // `seed` is the rundown's, so re-rendering a take asks the dice the same
  // questions — see `RenderSpec.seed`. `onFrame` is what should be on screen
  // for frame N: the rundown a frame at a time (`StripApi.offlineWalk`) and the
  // automation tape behind it (`AutomationApi.replay`), composed by the caller
  // because the order between them is the caller's rule and not this file's.
  // Omitted for a take of whatever is on the board — which is what ⎙ meant
  // before there was a walk to render and still means for an empty tray.
  render: (
    seconds: number,
    seed: number,
    onFrame?: (frame: number) => void,
  ) => void
  cancel: () => void
}

export function useRender(
  engine: EngineApi | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  name: string,
  onError: (message: string) => void,
): RenderApi {
  const [progress, setProgress] = useState<number | null>(null)
  // Read only inside the render's own callback, never during a render pass —
  // a ref is the right shape here precisely because the value has to be visible
  // to a loop that is already running.
  const cancelled = useRef(false)

  const render = useCallback(
    (seconds: number, seed: number, onFrame?: (frame: number) => void) => {
      const canvas = canvasRef.current
      if (engine === null || canvas === null || seconds <= 0) return
      cancelled.current = false
      setProgress(0)
      renderTake(engine, canvas, {
        frames: Math.round(seconds * FPS),
        fps: FPS,
        seed,
        onFrame,
        onProgress: (done, total) => setProgress(done / total),
        cancelled: () => cancelled.current,
      }).then(
        blob => {
          setProgress(null)
          save(blob, fileName(name, 'mp4'))
        },
        (e: unknown) => {
          setProgress(null)
          // A cancel is a thing the user did, not a failure to report at them.
          if (e instanceof RenderCancelled) return
          onError(
            `render failed: ${e instanceof Error ? e.message : String(e)}`,
          )
        },
      )
    },
    [engine, canvasRef, name, onError],
  )

  return {
    progress,
    render,
    cancel: useCallback(() => {
      cancelled.current = true
    }, []),
  }
}
