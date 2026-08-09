// The engine as the page sees it: the narrow surface five hooks actually depend
// on, rather than the 1400-line class behind it.
//
// There is one implementation, `Engine` (pipeline.ts), and TypeScript enforces
// the match through `implements`. There were briefly two — a worker-backed
// `WorkerEngine` presenting the same surface over messages — and this interface
// existed mostly to keep them from drifting. That work is deleted (see
// docs/adr/0003), so what remains is the other half of its job, which stands on
// its own: hooks that need three or four methods should say so, and should not
// have to name a class to do it.
//
// **Everything here is synchronous, deliberately.** React is: a slider write has
// to be readable in `getControls()` before the next render or the control snaps
// back under the user's finger, and `useSyncExternalStore` wants a snapshot it
// can read now rather than a promise. Anything added here has to honour that.
//
// What is deliberately *not* here:
//
//   - `step()`, `frameNo` bookkeeping beyond the read below, and direct access to
//     the pass graph. Those belong to the verification harnesses, which reach
//     through `window.vf` into the object graph itself (`vf.prePasses`,
//     `vf.sources`, `vf.audioState`). `window.vf` therefore stays typed as the
//     concrete `Engine`, which is the honest statement of the constraint rather
//     than a gap.
//   - `pushFrameA`/`pushFrameB`. Internal to how an engine gets fed, not
//     something the app does.
//   - `Engine.create`. Construction is the one place the app has to name the
//     implementation, and it does.
//   - **Recovering from a lost device.** `useEngine` stands a fresh `Engine` up
//     on the same canvas and moves the refs across; that is a property of how the
//     page owns the engine, not something the engine offers, so it stays off this
//     surface.

import type { ControlKey, Controls, FrameStats, ModSlot } from '../controls'
import type { AudioState } from '../signal/audiostate'
import type { GlidePlan } from '../signal/glide'
import type { StabPlan } from '../signal/stab'
import type { FrozenKind } from './renderloop'

export interface DestroyOptions {
  // Leave the audio graph open, because a successor engine is taking it over.
  // Only the rebuild path passes this; every other teardown means the audio is
  // going away too.
  keepAudio?: boolean
  // Leave the GPUDevice open for the successor: this engine is going away for a
  // reason that is not the device's fault — a hot update, a remount — so the next
  // one should inherit it rather than ask the tab for another. Cheaper than it
  // looks, because the alternative is a teardown, and a teardown of a presenting
  // device is what costs a tab its rendering step (gpu/context.ts).
  //
  // Not passed for a device that is itself the fault: a lost or hung one must not
  // be handed on. It is still not *destroyed* — `releaseGpu` only lets go of it.
  keepDevice?: boolean
}

export interface EngineApi {
  // Not the engine's to rebuild: a media element binds to one AudioContext for
  // life, so an engine replacing a lost one inherits its predecessor's graph.
  readonly audioState: AudioState

  // How an engine reports its own health. Four failures the app answers
  // differently, which is why they are four callbacks and not one: a lost device
  // rebuilds, a hang is fatal, a frozen tab is a banner that clears itself, and
  // a GPU error is a banner that does not.
  onStats: (stats: FrameStats) => void
  onDeviceLost: (message: string) => void
  onHang: () => void
  onFrozen: (frozen: FrozenKind | null) => void
  onGpuError: (message: string) => void

  // --- controls ---

  setControl: (key: ControlKey, value: number) => void
  applyControls: (patch: Partial<Controls>) => void
  // Hold-to-compare: push a look to the render path without touching the
  // snapshot React renders from, so the sliders stay where they are. `null`
  // restores from the snapshot.
  preview: (next: Controls | null) => void
  // Morph the board towards a look over a span of seconds instead of landing on
  // it — see signal/glide.ts. The origin is the engine's live controls, so a
  // morph started over a morph carries on from where the picture is; a slider,
  // MIDI message or outright `applyControls` cancels one.
  startGlide: (plan: GlidePlan) => void
  stopGlide: () => void
  // The look a running morph is heading for, or null if none is. What the undo
  // walk banks while a morph is in flight — see useMix.
  glideTarget: () => Controls | null
  // A morph's progress as its own store, so the one widget that draws it can
  // subscribe without putting a frame-rate value anywhere App can see it. Same
  // stability rule as the controls pair below: both are fields.
  readonly subscribeGlide: (fn: () => void) => () => void
  readonly getGlide: () => number | null
  // The frame rate as a store, so the readout that draws it subscribes on its
  // own rather than the app holding a value that moves four times a second.
  // Complements `onStats` above rather than replacing it — see pipeline.ts.
  readonly subscribeStats: (fn: () => void) => () => void
  readonly getStats: () => FrameStats
  // useSyncExternalStore's pair. Both are fields rather than methods so they are
  // referentially stable across renders — React resubscribes if `subscribe`
  // changes identity, and a method would be a fresh binding every time.
  readonly subscribeControls: (fn: () => void) => () => void
  readonly getControls: () => Controls

  // --- sources ---
  //
  // A and B are asymmetric because the shaders want different things from them:
  // A keeps its own aspect (hence the argument) and B is always staged to the
  // raster with a 4:3 crop. See gpu/sources.ts.

  // **The engine does not take ownership of a still.** It copies what it needs
  // and leaves the source usable, because the caller keeps it: useEngine records
  // the still in `lastSrc` so a device-loss rebuild can re-issue the same
  // picture. An implementation that transferred it (detaching an ImageBitmap) or
  // drained it (`transferToImageBitmap` on a canvas hands over the backing
  // store) would satisfy this signature and still be wrong — silently, and only
  // once a device is lost with a still on the slot.
  //
  // Decoded *video frames* are the opposite and do not appear here: ownership
  // passes, because VideoPump made them and nothing else holds a reference.
  setImageSource: (
    source: OffscreenCanvas | ImageBitmap,
    aspect?: number,
  ) => void
  setVideoSource: (el: HTMLVideoElement | null) => void
  // The stretch of this slot's clip to keep the playhead inside, or null to play
  // straight through. Positions on the *source's* own timeline, which is why this
  // is a source setter and not a control: a pair of timestamps means nothing
  // against a different clip, so it must never be recalled by a preset or moved
  // by mutate. Held here rather than in the panel because the wrap has to happen
  // once a frame (see VideoPump.wrap) and nothing in React runs that often.
  setVideoRegion: (region: { start: number; end: number } | null) => void
  // A GPU-generated noise field instead of a texture (1 TV static, 2 VHS
  // static); 0 restores the texture path.
  setNoiseSource: (kind: number) => void
  setImageSourceB: (source: OffscreenCanvas | ImageBitmap) => void
  setVideoSourceB: (el: HTMLVideoElement | null) => void
  setVideoRegionB: (region: { start: number; end: number } | null) => void
  setNoiseSourceB: (kind: number) => void
  setSourceBEnabled: (on: boolean) => void
  // Whether B is summing into the picture. The panel's mode enum is a different
  // question — 'none' is only one of the ways B ends up off — so the rebuild
  // path reads this off the engine it is replacing rather than off React.
  readonly sourceBOn: boolean

  // --- the rest ---

  // Modulation: LFOs, random walks and audio envelopes that wiggle controls
  // around their slider settings. Written to, never read from — it is applied
  // and undone inside a single frame and never touches the resting values.
  setModSlots: (slots: ModSlot[]) => void
  // Strike a one-shot envelope in the bay: one routing by its slot id, or every
  // routing patched to a trigger when called with nothing. The one part of the
  // bay driven by an event rather than a setting, which is why it does not go
  // through setModSlots — a press between two frames has to survive until the
  // next one runs, and a flag on a slot list that presets and undo rewrite
  // wholesale could not.
  fireMod: (id?: number, level?: number) => void
  // The stab gate: how often the whole look is poked into an otherwise clean
  // picture, and for how long (signal/stab.ts). Same contract as the bay above —
  // written to, never read from, applied and undone inside one frame — so a rate
  // of 0 is off and nothing here ever reaches `getControls`.
  setStab: (stab: StabPlan) => void
  // Which decode-stage tap is on the glass. The engine owns the value (it reads
  // `?dbg=` at construction), so React mirrors it rather than the reverse.
  setDbgView: (view: number) => void
  getDbgView: () => number
  // Re-arm the render loop after a transition (fullscreen exit, tab re-shown)
  // that can leave the browser having stopped delivering rAF callbacks. A no-op
  // on a healthy loop.
  kick: () => void
  frameNo: () => number
  destroy: (opts?: DestroyOptions) => void
}
