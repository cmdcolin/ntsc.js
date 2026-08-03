// One input slot's <video> element: creating it with the playback settings the
// vaporwave path needs, pointing it at a source, and retiring it cleanly.
//
// A and B differ only in which engine setter and which React state a step
// drives, so those are fields on the slot and the mechanics below are written
// once. What is genuinely per-slot — the mode enum, the name label, B's enable
// flag — stays with the caller rather than being smuggled in here as options.

import type { TeletypeCard } from '../sources/teletype'

export interface VideoSlot {
  ref: { current: HTMLVideoElement | null }
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
  // React mirrors: whether the slot holds a live <video>, and the YouTube URL
  // it was loaded from (kept so the source round-trips through the query string).
  setLive: (live: boolean) => void
  setYtUrl: (url: string) => void
  // The teletype card this slot last showed, kept so the dialog reopens on it
  // and the source round-trips through the query string. A getter for the same
  // reason `rate` is one: the callers run in async callbacks and the mount-time
  // restore, where closed-over state is stale.
  card: () => TeletypeCard
  setCard: (card: TeletypeCard) => void
  onError: (message: string) => void
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
  slot.setLive(false)
  slot.setYtUrl('')
  slot.attach(null)
}

// A fresh element for the slot, configured but not yet sourced.
export function makeSlotVideo(slot: VideoSlot): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.loop = true
  v.playsInline = true
  // Lets copyExternalImageToTexture read frames from a CORS-cleared
  // cross-origin source (the bundled clips on S3) without tainting; a no-op
  // for same-origin and blob: sources, so it's safe to set unconditionally.
  v.crossOrigin = 'anonymous'
  v.addEventListener('error', () => {
    slot.onError(
      `video error: ${v.error?.message ?? 'unknown'} (code ${v.error?.code ?? '?'})`,
    )
    console.log('DEBUG video error', v.error?.code, v.error?.message)
  })
  v.addEventListener('playing', () =>
    console.log('DEBUG video playing', v.videoWidth, v.videoHeight),
  )
  // preservesPitch off means slowing the rate drops the pitch — the whole
  // point. defaultPlaybackRate too, or loading the src resets playbackRate to
  // 1. muted stays true until the audio graph adopts the element for output.
  const rate = slot.rate()
  v.preservesPitch = false
  v.defaultPlaybackRate = rate
  v.playbackRate = rate
  slot.ref.current = v
  slot.setLive(true)
  // A fresh clip is a new element the audio graph has not adopted; re-route so
  // it is captured (and slowed audio keeps playing) when playback audio is on.
  slot.adopt()
  return v
}

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
export function playUrl(slot: VideoSlot, url: string): void {
  const v = makeSlotVideo(slot)
  v.src = url
  roll(slot, v)
}

// Point the slot at a live capture stream (webcam or an RCA grabber).
export function playStream(slot: VideoSlot, stream: MediaStream): void {
  const v = makeSlotVideo(slot)
  v.srcObject = stream
  roll(slot, v)
}
