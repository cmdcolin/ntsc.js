// The offline render: frames pulled by hand, on a clock the render owns.
//
// This is the third of the three things docs/EDITOR.md's export half needed,
// and the one neither of the others could stand in for.
//
//   1. `record.ts` writes a constant-framerate file. But it was fed by rAF, so
//      it captured at whatever rate the tab managed and *called* that 60fps —
//      internally consistent, and a take that plays fast if the tab dropped
//      frames.
//   2. The virtual clock makes the five rate-driven readers functions of the
//      frame counter. But while rAF is also running, the counter moves between
//      steps and two runs of the same take see different times.
//   3. Here: stop the loop, step the engine, hand each frame straight to the
//      encoder. Now the frame count is exactly the frame count, the clock is
//      exactly the frames, and the file is exactly both.
//
// A fourth arrived with `startTake`, and it is the one that makes the other
// three worth having: frame N was a function of N *and of where the engine
// happened to be* when the render started, so two renders of the same take came
// out about 5% apart. A take now begins from a fresh engine's signal state with
// its dice seeded, and two renders of one take are the same file.
//
// **It renders as fast as the GPU will go, and that is the point.** A take is
// no longer something you sit through in real time — a slow frame costs the
// render wall time and costs the file nothing. That is what separates this from
// the screen grab it replaces, and it is why the recorder's timestamps come off
// a count rather than a clock.

import { startRecording } from './record'

import type { EngineApi } from '../gpu/engineapi'

// How often the render yields to the browser. Every frame would halve the
// throughput on a macrotask hop; never would freeze the tab for the length of
// the render and let the watchdog decide the page had hung. Twelve is about a
// fifth of a second of output per hop at 60fps, which keeps a progress readout
// honest and a cancel button answerable.
const YIELD_EVERY = 12

export interface RenderSpec {
  frames: number
  fps: number
  // What everything left in the take that rolls draws from — the tape's wow,
  // the stick-slip patches, the bay's random walk. The rundown's seed, so a
  // re-render of a strip asks the dice the same questions its walk did.
  seed: number
  // Called after each yield, never per frame — a progress bar has no use for
  // sixty updates a second and React has no time for them mid-render.
  onProgress?: (done: number, total: number) => void
  // Checked at each yield. A render is the one thing here that can run for
  // minutes, so it has to be abandonable without a reload.
  cancelled?: () => boolean
}

export class RenderCancelled extends Error {
  constructor() {
    super('render cancelled')
    this.name = 'RenderCancelled'
  }
}

// Render `frames` frames and hand back the file.
//
// The engine is left exactly as it was found — clock back on the wall, loop
// running if it was running — through a `finally`, because every way out of
// here that is not a finished file is a way somebody wants their picture back:
// a cancel, an encoder failure, a lost device mid-render.
export async function renderTake(
  engine: EngineApi,
  canvas: HTMLCanvasElement,
  spec: RenderSpec,
): Promise<Blob> {
  const { frames, fps, seed } = spec
  const wasRunning = engine.pauseLoop()
  // **Let the loop actually finish stopping before taking the frames.**
  //
  // `RenderLoop.stop()` drops a flag rather than calling
  // `cancelAnimationFrame` — deliberately, and its comment says so: the chains
  // retire on their next callback, at a cost of one no-op call each. But "next
  // callback" is a frame that has already been scheduled, and it lands *after*
  // `pauseLoop()` has returned. Two chains, so up to two stray frames, each
  // arriving at whatever moment the browser chose.
  //
  // Which is a race with the stepping below, and `scripts/rendercheck.mjs`
  // measured it: 122 frames advanced across a 120-frame render. Two animation
  // frames is enough for both chains to see the flag and retire.
  //
  // It does not make those two frames not happen — they were already scheduled,
  // and they are part of the take's history either way. What it buys is that
  // they land *before* the render rather than interleaved with it, so the
  // frames this loop steps are consecutive and the file has no seam in it.
  if (wasRunning) {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }
  // After the two frames above, not before: those strays are the live loop's
  // last, and stepping them through a freshly-cleared signal path would put two
  // frames of someone else's take at the front of this one.
  engine.startTake({ fps, seed })
  const recorder = await startRecording({
    width: canvas.width,
    height: canvas.height,
    fps: { num: fps, den: 1 },
  })
  try {
    for (let i = 0; i < frames; i++) {
      // Step first, then take what it drew: `step()` renders synchronously, so
      // the canvas holds frame `i` by the time this returns. Taking the frame
      // first would record the state *before* the render and shift the whole
      // take one frame early — which no assertion about frame rate would catch,
      // because the file would be perfectly constant and one frame wrong.
      engine.step()
      recorder.frame(canvas)
      if (i % YIELD_EVERY === YIELD_EVERY - 1) {
        // A macrotask, not a microtask: `await null` never lets the browser
        // paint, so a progress bar behind this would not move and the tab would
        // look hung for the whole render.
        await new Promise(resolve => setTimeout(resolve, 0))
        spec.onProgress?.(i + 1, frames)
        if (spec.cancelled?.() === true) throw new RenderCancelled()
        // The encoder reports asynchronously (record.ts), so a fault raised
        // three frames ago surfaces here rather than at the flush — which
        // matters when the flush is four minutes away.
        const failure = recorder.error()
        if (failure !== '') throw new Error(failure)
      }
    }
    spec.onProgress?.(frames, frames)
    return await recorder.finish()
  } catch (e) {
    recorder.abort()
    throw e
  } finally {
    engine.endTake()
    if (wasRunning) engine.resumeLoop()
  }
}
