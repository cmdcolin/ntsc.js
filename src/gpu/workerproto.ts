// The wire between the page and a worker-owned engine.
//
// Two rules shape every message here.
//
// First, anything carrying pixels carries an ImageBitmap, and it is always
// *transferred* rather than cloned — the whole point of moving the engine is to
// stop paying for frames on the main thread, and a structured clone of a
// 1440x1080 frame would hand most of that cost straight back.
//
// Second, the page stays the authority on controls. Every write originates
// there (a slider, a MIDI knob, a preset, a scene), so the page can keep its own
// snapshot and render from it immediately instead of waiting for a round trip.
// The engine's own snapshot is echoed back only so a page can reconcile after
// something it did not initiate — a device-loss rebuild, say. Modulation never
// appears here at all: it is applied and undone inside a single frame and never
// touches the resting values the UI shows.

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { FrozenKind } from './renderloop'

// Frame geometry as it was when the decode was requested — see PumpedFrame.
// Sent alongside the bitmap because the worker cannot read it back off an
// element it does not have.
export interface FrameGeometry {
  w: number
  h: number
  aspect: number
}

export type ToWorker =
  // Build the engine on the transferred canvas. `search` is the page's query
  // string; a worker cannot read it for itself (see env.setPageSearch).
  | { t: 'init'; canvas: OffscreenCanvas; search: string }
  | { t: 'control'; key: ControlKey; value: number }
  | { t: 'applyControls'; patch: Partial<Controls> }
  | { t: 'preview'; controls: Controls | null }
  | { t: 'modSlots'; slots: ModSlot[] }
  | { t: 'dbgView'; view: number }
  | { t: 'sourceBEnabled'; on: boolean }
  // A still for a slot: patterns, stills, teletype cards. One-shot.
  | { t: 'imageA'; bmp: ImageBitmap; aspect: number }
  | { t: 'imageB'; bmp: ImageBitmap }
  // A GPU-generated noise field instead of a texture (1 TV static, 2 VHS).
  | { t: 'noiseA'; kind: number }
  | { t: 'noiseB'; kind: number }
  // One decoded video frame, from the page's VideoPump.
  | { t: 'frameA'; bmp: ImageBitmap; geom: FrameGeometry }
  | { t: 'frameB'; bmp: ImageBitmap; geom: FrameGeometry }
  // Render exactly one frame regardless of pacing, and say when it is done.
  // The verification harnesses step deterministically rather than waiting on
  // wall-clock frames, so this has to be acknowledged rather than fired off.
  | { t: 'step'; id: number }
  // Re-arm the loop after a transition that can stop rAF being delivered.
  | { t: 'kick' }
  // Report the current frame number, for a harness that is counting.
  | { t: 'frameNo'; id: number }
  // Build a replacement engine on the same canvas after a lost device. Not a
  // fresh worker: transferControlToOffscreen can only ever be called once on a
  // canvas, so the OffscreenCanvas this one already holds is the only one there
  // will be.
  | { t: 'rebuild' }
  | { t: 'destroy' }

export type FromWorker =
  | { t: 'ready' }
  // A replacement engine is up (or could not be built). Distinct from `ready`
  // so the page can tell a rebuild from a first start.
  | { t: 'rebuilt'; ok: boolean; message: string }
  // The engine could not be built at all — no adapter, no device, a canvas the
  // browser would not configure. Fatal, and the page has to say so.
  | { t: 'initFailed'; message: string }
  | { t: 'stats'; stats: FrameStats }
  // The engine's own control snapshot, for reconciliation only. See above.
  | { t: 'controls'; controls: Controls }
  | { t: 'deviceLost'; message: string }
  | { t: 'hang' }
  | { t: 'frozen'; frozen: FrozenKind | null }
  | { t: 'gpuError'; message: string }
  // Acknowledgements, keyed to the request that asked for them.
  | { t: 'stepped'; id: number }
  | { t: 'frameNo'; id: number; frame: number }

// Every bitmap-carrying message, in one place, so a sender cannot forget to
// transfer one and quietly fall back to copying it.
export const transferables = (m: ToWorker): Transferable[] =>
  m.t === 'init'
    ? [m.canvas]
    : m.t === 'imageA' ||
        m.t === 'imageB' ||
        m.t === 'frameA' ||
        m.t === 'frameB'
      ? [m.bmp]
      : []
