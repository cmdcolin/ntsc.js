// One input slot's <video> elements: creating them with the playback settings
// the vaporwave path needs, pointing one at a source, and retiring it cleanly.
//
// A and B differ only in which engine setter and which React state a step
// drives, so those are fields on the slot and the mechanics below are written
// once. What is genuinely per-slot — the mode enum, the name label, B's enable
// flag — stays with the caller rather than being smuggled in here as options.
//
// **A slot holds two elements: the one on air and the next one.** That is
// preroll depth 1 (docs/EDITOR.md › _Performance: the boundary is the only
// cost_), and it is here rather than on deck B because B is the mix source and
// a take will want it. Steady-state playback does not care how long a rundown
// is — `VideoPump.due()` yields one decode per newly decoded source frame
// whatever is attached — so all of the cost is at the cut: a new element, the
// network, the first frame. A second element already loaded and parked at its
// in-point is that cost paid during the bar before it.
//
// **Depth 1, and the ceiling is structural rather than a rule to remember.**
// There is one `next` field, so a second preroll retires the first: each parked
// element is a live decoder, and an archive.org pick is a `blob:` holding the
// entire file (`sources/pool.ts` says why it downloads whole), so a deeper
// queue is a memory bug waiting to happen.

import { debugLog } from '../gpu/env'

import type { TeletypeCard } from '../sources/teletype'

// What a slot is holding, for the panel sections that can only offer something
// to one of them. A clip has a timeline: it can be slowed, and slowing it drops
// the pitch, which is the whole vaporwave path. A live stream — webcam, RCA
// grabber, screen share — has no timeline at all, and an element backed by a
// MediaStream ignores playbackRate outright, so a speed slider over one is a
// control that cannot do anything.
export type SlotKind = 'none' | 'clip' | 'stream'

// A clip loaded ahead of the cut that will use it. `url` is what identifies it:
// a promotion only takes the parked element if it is the one being asked for,
// because a rundown edited mid-bar can ask for a different clip than the one
// the last boundary looked ahead to.
export interface Preroll {
  url: string
  el: HTMLVideoElement
}

export interface VideoSlot {
  // Which deck this is. Everything genuinely per-slot stays with the caller, but
  // *which* slot a helper was handed is a fact about the slot itself, and the
  // async load paths need it to say whose reply they are holding — a Commons roll
  // that lands after the user has moved that deck on has to be dropped, and the
  // token it checks is kept per deck.
  id: 'a' | 'b'
  ref: { current: HTMLVideoElement | null }
  // The next clip, loaded and parked at its in-point, or nothing. Never
  // attached to the engine and never adopted by the audio graph until it is
  // promoted — a parked element that the mixer could see would be a second
  // picture, and one the audio graph had adopted would be a second sound.
  next: { current: Preroll | null }
  // The teletype reveal currently printing into this slot, if any. It lives
  // here for the same reason the element does: whatever a slot holds has to be
  // retired by stopSlot, and every load path already opens with that call.
  typer: { current: { stop: () => void } | null }
  // Playback rate to stamp on a new element. A getter, because every caller
  // runs inside an async fetch callback or the mount-time restore, where the
  // state it would otherwise close over is stale.
  rate: () => number
  // Hand the element (or nothing) to this slot on the engine.
  attach: (el: HTMLVideoElement | null) => void
  setImage: (source: OffscreenCanvas | ImageBitmap, aspect?: number) => void
  setNoise: (kind: number) => void
  // React mirrors: what kind of <video> the slot holds, and the YouTube URL it
  // was loaded from (kept so the source round-trips through the query string).
  setLive: (kind: SlotKind) => void
  setYtUrl: (url: string) => void
  // The caption under this slot's picker. Most sources leave it empty — the
  // picker already names them — but a Commons roll has to, since the option
  // names a pool and the caption is the only thing that says which file came
  // back out of it.
  setName: (name: string) => void
  // The teletype card this slot last showed, kept so the dialog reopens on it
  // and the source round-trips through the query string. A getter for the same
  // reason `rate` is one: the callers run in async callbacks and the mount-time
  // restore, where closed-over state is stale.
  card: () => TeletypeCard
  setCard: (card: TeletypeCard) => void
  onError: (message: string) => void
  // Forget this slot's cue point and whatever loop hung off it. A cue is a pair
  // of positions on one particular clip's timeline, so it cannot outlive the clip
  // — carried over it would clamp a new source against numbers that mean nothing
  // in it. Called by stopSlot, which every load path already opens with.
  clearCue: () => void
  // Audio graph: drop a retired element, adopt a fresh one.
  release: (el: HTMLMediaElement) => void
  adopt: () => void
}

// Retire a teletype reveal on its own, for the load paths that put a picture
// on the slot without retiring the rest of it: an interval left running would
// go on typing over whatever replaced it.
export function stopTyping(slot: VideoSlot): void {
  slot.typer.current?.stop()
  slot.typer.current = null
}

// Retire whatever the slot holds: stop a teletype reveal, stop a capture
// stream, free a blob url, drop the element from the audio graph, and point the
// engine at nothing. Safe on an empty slot, so every load path can open with it
// — which is also what keeps a reveal from typing over the source that replaced
// it, since a running interval outlives the mode change on its own.
//
// **It deliberately leaves a parked preroll alone**, and the order of the load
// paths is why: `commitDeck` stops the slot and *then* calls `playUrl`, so a
// `stopSlot` that retired the next element would destroy it a line before the
// cut it was loaded for. What bounds it instead is that there is one `next`
// slot and `prerollUrl` clears it — so a preroll nobody spends is replaced by
// the following one and retired with the deck (`dropPreroll`), rather than
// accumulating.
export function stopSlot(slot: VideoSlot): void {
  stopTyping(slot)
  const v = slot.ref.current
  if (v !== null) {
    v.pause()
    if (v.srcObject instanceof MediaStream) {
      for (const t of v.srcObject.getTracks()) t.stop()
    }
    v.srcObject = null
    if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src)
    v.removeAttribute('src')
    slot.ref.current = null
    slot.release(v)
  }
  slot.setLive('none')
  slot.setYtUrl('')
  slot.clearCue()
  slot.attach(null)
}

// A fresh element for the slot, configured but not sourced, not installed and
// not adopted — the half of `makeSlotVideo` a preroll wants, since a parked
// element must be configured exactly like a live one and visible to nothing.
function configureVideo(slot: VideoSlot): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.loop = true
  v.playsInline = true
  // Lets copyExternalImageToTexture read frames from a CORS-cleared
  // cross-origin source (the bundled clips on S3) without tainting; a no-op
  // for same-origin and blob: sources, so it's safe to set unconditionally.
  v.crossOrigin = 'anonymous'
  // The error already reaches the user through the banner; the log is the extra
  // detail (the numeric code) that a bug report wants, so it is gated like every
  // other DEBUG line rather than printed at everyone. `playing` is pure
  // telemetry and fires on every roll, loop and resume — ungated it was the
  // noisiest line in the app, on the same console a frozen tab is diagnosed
  // from.
  v.addEventListener('error', () => {
    slot.onError(
      `video error: ${v.error?.message ?? 'unknown'} (code ${v.error?.code ?? '?'})`,
    )
    debugLog('DEBUG video error', v.error?.code, v.error?.message)
  })
  v.addEventListener('playing', () =>
    debugLog('DEBUG video playing', v.videoWidth, v.videoHeight),
  )
  // preservesPitch off means slowing the rate drops the pitch — the whole
  // point. defaultPlaybackRate too, or loading the src resets playbackRate to
  // 1. muted stays true until the audio graph adopts the element for output.
  const rate = slot.rate()
  v.preservesPitch = false
  v.defaultPlaybackRate = rate
  v.playbackRate = rate
  return v
}

// Put an element on the slot: it becomes what the slot holds, the panel is told
// what kind it is, and the audio graph adopts it so slowed audio keeps playing.
// The three steps that make an element *the* element, split out from making one
// because a preroll does the first half and this half only at the cut.
function installVideo(
  slot: VideoSlot,
  v: HTMLVideoElement,
  kind: SlotKind,
): void {
  slot.ref.current = v
  slot.setLive(kind)
  slot.adopt()
}

// A fresh element for the slot, configured and installed but not yet sourced.
export function makeSlotVideo(
  slot: VideoSlot,
  kind: SlotKind,
): HTMLVideoElement {
  const v = configureVideo(slot)
  installVideo(slot, v, kind)
  return v
}

// Retire a parked element. Its own function because it is not `stopSlot`'s job:
// see the note there.
export function dropPreroll(slot: VideoSlot): void {
  const parked = slot.next.current
  if (parked === null) return
  slot.next.current = null
  parked.el.pause()
  if (parked.el.src.startsWith('blob:')) URL.revokeObjectURL(parked.el.src)
  parked.el.removeAttribute('src')
}

// Load a clip into the slot's second element and hold it at `start`, paused.
// Nothing on screen changes and nothing is attached — this is the bar before
// the cut being spent on the load the cut would otherwise pay for.
//
// Resolves when the element is parked, or rejects nothing: a preroll that fails
// is a cut that pays the old price, which is the price it paid before this
// existed. Nothing downstream branches on it, so a failure has nowhere to be
// reported that would not be noise.
export async function prerollUrl(
  slot: VideoSlot,
  url: string,
  start: number,
): Promise<void> {
  // The one that makes depth 1 structural: a second preroll retires the first.
  dropPreroll(slot)
  const v = configureVideo(slot)
  const parked: Preroll = { url, el: v }
  slot.next.current = parked
  // `auto` rather than the default: the whole point is to have the bytes and
  // the first frames before they are wanted, which is exactly what the browser
  // reads this as asking for.
  v.preload = 'auto'
  v.src = url
  try {
    await once(v, 'loadedmetadata')
    // Parked *at the in-point*, not at zero. A cue is where the row starts, so
    // seeking here is what makes the promotion a cut rather than a seek the
    // audience watches — and `VideoPump.wrap` would have had to do it on the
    // first frame otherwise.
    if (start > 0 && start < v.duration) {
      v.currentTime = start
      await once(v, 'seeked')
    }
  } catch {
    // The element errored or was retired underneath us. Either way it is not
    // worth parking; a promotion will simply not find it and load normally.
    if (slot.next.current === parked) dropPreroll(slot)
  }
}

// One event, as a promise that also settles if the element errors — so a
// preroll of a dead url does not leave an await outstanding for the session.
const once = (el: HTMLVideoElement, name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener('error', bad)
      resolve()
    }
    const bad = () => {
      el.removeEventListener(name, ok)
      reject(new Error(`video ${name} failed`))
    }
    el.addEventListener(name, ok, { once: true })
    el.addEventListener('error', bad, { once: true })
  })

// Hand the element to the engine once it actually rolls. A rejected play() is
// an autoplay block, not a failure worth a banner — the element stays loaded
// and the user's next gesture starts it.
function roll(slot: VideoSlot, v: HTMLVideoElement): void {
  v.play()
    .then(() => slot.attach(v))
    .catch(() => {})
}

// Point the slot at a url: a blob for a picked file or a fetched clip, or a
// plain one for ?vurl.
//
// **The one place a preroll is spent**, and every clip load in the app already
// comes through here — the picker, a pool pick, a link's `?vurl`, a strip row —
// so none of them has to know preroll exists. A parked element for this exact
// url is promoted; anything else loads as it always did.
export function playUrl(slot: VideoSlot, url: string): void {
  const parked = slot.next.current
  const ready = parked !== null && parked.url === url ? parked.el : null
  if (ready !== null) slot.next.current = null
  const v = ready ?? makeSlotVideo(slot, 'clip')
  if (ready === null) {
    v.src = url
  } else {
    // Installed now rather than when it was parked: until this line it was a
    // configured element nothing could see, which is what let it load without
    // being on air or in the audio graph.
    installVideo(slot, v, 'clip')
  }
  roll(slot, v)
}

// Point the slot at a live capture stream (webcam, an RCA grabber, or a shared
// screen). `onEnded` fires when the source stops on its own — the browser's own
// "stop sharing" bar, or a dongle being unplugged — which the slot cannot see
// any other way: the element simply holds its last frame forever. Not called
// when stopSlot retires the track itself, since the caller is already replacing
// the source and does not need telling.
export function playStream(
  slot: VideoSlot,
  stream: MediaStream,
  onEnded?: () => void,
): void {
  const v = makeSlotVideo(slot, 'stream')
  v.srcObject = stream
  if (onEnded !== undefined) {
    for (const t of stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        // The slot may have moved on since; only the stream still on it speaks.
        if (slot.ref.current === v) onEnded()
      })
    }
  }
  roll(slot, v)
}
