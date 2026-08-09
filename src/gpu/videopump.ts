// Turning a playing <video> into something the GPU will take.
//
// This is deliberately the only part of the input path that touches a DOM
// element, and it is separated from `Sources` for two reasons. The obvious one
// is that they are different jobs: this decides *when* a frame is worth
// decoding and produces a bitmap, while Sources owns textures and knows nothing
// about where a picture came from.
//
// The split was made for a second reason that no longer applies — a worker has
// no HTMLVideoElement, so this was the half that would have stayed on the main
// thread. That engine is deleted (docs/adr/0003). The seam outlived it because
// the first reason was the real one: it is what the staging fix in 990b3d5 was
// built on, moving the decode and scale off-thread via `createImageBitmap`.

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
// Long edge capped, aspect preserved — see MAX_SRC_EDGE in sources.ts.
import { coverFit43, fitSrc } from './sources'

// 'low' rather than a nicer filter on purpose: it is what a 2D canvas used for
// drawImage (imageSmoothingQuality defaults to 'low'), so the picture that
// reaches the raster is the one this path always produced. The signal chain
// resamples to a 754-wide raster and then damages it thoroughly, so nothing
// downstream could tell a better filter apart anyway.
const BITMAP_OPTS = (w: number, h: number): ImageBitmapOptions => ({
  resizeWidth: w,
  resizeHeight: h,
  resizeQuality: 'low',
})

// A decoded frame and the geometry that was true when it was requested.
export interface PumpedFrame {
  bmp: ImageBitmap
  w: number
  h: number
  aspect: number
}

// Where finished frames go. Slot A keeps its own aspect and may resize its
// texture; slot B always arrives at raster size, pre-cropped. The pushExt
// pair is the direct path: no bitmap was made, the element itself is handed
// over for the engine to importExternalTexture this frame (see blit_ext.wgsl).
export interface VideoFrameSink {
  pushA: (f: PumpedFrame) => void
  pushB: (f: PumpedFrame) => void
  pushExtA: (el: HTMLVideoElement) => void
  pushExtB: (el: HTMLVideoElement) => void
}

// A stretch of a clip's own timeline to keep the playhead inside. Set by the
// panel's cue buttons (ui/cue.ts), applied here because this is the only place
// that touches an element once a frame — the 10 Hz playhead poll the seek bar
// reads is a tenth of a second coarse, which on a short loop is a quarter of it
// played past the out-point before anything notices.
interface Region {
  start: number
  end: number
}

// What a loop's wrap is actually costing, measured rather than predicted.
//
// Worth measuring in the app at all because the cost cannot be predicted from
// here: it is the decode from the previous keyframe forward to the in-point, and
// JS cannot see where the keyframes are or how expensive the frames between them
// are. Two of the four clips this repo ships stall on it (scripts/loopseek.mjs
// --file=), so it is not a rarity worth ignoring.
//
// Measured with the `seeked` event: the decoder's own answer for how long the jump
// took. That is the instrument scripts/loopseek.mjs validated from the outside —
// its `seeked` column tracks the visibly dropped frames within about 10%.
//
// It replaced a version that watched `currentTime` instead, to avoid putting a
// listener on an element this class does not own. That was the wrong trade and the
// harness caught it: assigning `currentTime` snaps to a frame boundary, so the
// write the wrap absorbs sometimes reads back as movement and closes the gap
// instantly. It under-reported by two to four times and swung 2x between runs on
// one clip — 237ms then 122ms where rVFC measured 541ms. A listener is no more
// invasive than the `currentTime` write already made two lines below it.
export interface WrapHealth {
  // Typical time the jump back took, across the wraps measured so far, in ms.
  // Absolute rather than a ratio: it is what the eye registers, and it needs no
  // baseline to be meaningful.
  medianMs: number
  // Wraps measured. The verdict says nothing below two — the first lap of a
  // fresh region can be slow for reasons that are not the seek.
  laps: number
}

// How many wrap gaps to keep. A median over eight is enough to shrug off the
// occasional multi-hundred-ms stall that is the compositor's doing rather than
// the decoder's — which a plain worst-of would report as the loop's fault.
const WRAP_WINDOW = 8

interface Slot {
  el: HTMLVideoElement | null
  inFlight: boolean
  ready: PumpedFrame | null
  // Where this slot's loop runs, or null for "play straight through".
  region: Region | null
  // Wrap timing: when the wrap's seek was issued (0 for none outstanding), the
  // listener that closes it, and the window of durations it has collected.
  wrapAt: number
  onSeeked: (() => void) | null
  wrapGaps: number[]
  // currentTime of the last frame requested. Video plays at its own rate
  // (24/30 fps) under a 60 fps loop, so without this check most requests
  // re-decode a frame the texture already holds. -1 forces the first one.
  lastTime: number
  // Bumped whenever the slot's source changes. A bitmap already being decoded
  // when the user switched sources resolves against the old generation and is
  // dropped, rather than landing a frame of the previous clip in the new one's
  // texture — a flash that would be near-impossible to attribute later.
  gen: number
}

const emptySlot = (): Slot => ({
  el: null,
  inFlight: false,
  ready: null,
  region: null,
  wrapAt: 0,
  onSeeked: null,
  wrapGaps: [],
  lastTime: -1,
  gen: 0,
})

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = xs.toSorted((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

const probe = (el: HTMLVideoElement | null) =>
  el === null
    ? null
    : {
        ready: el.readyState,
        time: Number(el.currentTime.toFixed(2)),
        // Attached is not the same as rolling: an element that stopped decoding
        // leaves one frozen frame on the slot, which reads as a live source.
        paused: el.paused,
      }

export class VideoPump {
  private a = emptySlot()
  private b = emptySlot()
  private disposed = false

  // Direct mode: the device can sample the decoder's own frame
  // (importExternalTexture), so the pump never makes a bitmap — it just says
  // which element has a fresh frame and lets the engine import it. The same
  // currentTime dedup gates both modes: a 30 fps clip under a faster loop
  // still only hands over ~30 frames a second.
  constructor(private readonly direct = false) {}

  // Point a slot at an element, or at nothing. A re-attached element may sit
  // paused at the same currentTime, so the next frame must be requested
  // regardless or the slot goes on showing whatever was there before.
  setA(el: HTMLVideoElement | null): void {
    this.retarget(this.a, el)
  }

  setB(el: HTMLVideoElement | null): void {
    this.retarget(this.b, el)
  }

  // Point a slot's loop at a stretch of its clip, or at nothing. Null is the
  // ordinary state and means the element plays straight through — including past
  // its own end, where `loop` on the element takes over as it always did.
  setRegionA(region: Region | null): void {
    this.a.region = region
    this.resetHealth(this.a)
  }

  setRegionB(region: Region | null): void {
    this.b.region = region
    this.resetHealth(this.b)
  }

  // Everything about the slot goes back to untouched, `inFlight` included. A
  // decode from the outgoing source is still running and cannot be cancelled,
  // but it belongs to a generation this slot has retired, so it is not allowed
  // to write here at all — see `start`. Leaving `inFlight` for that decode's own
  // handler to clear was the same coupling in the other direction: the stale
  // decode cleared a flag the *new* one had set, and the next pump started a
  // second decode of a source already being decoded.
  private retarget(slot: Slot, el: HTMLVideoElement | null): void {
    // Before `slot.el` moves: the old element is where the old listener lives.
    this.listen(slot, el)
    slot.el = el
    slot.lastTime = -1
    slot.inFlight = false
    slot.gen += 1
    slot.ready?.bmp.close()
    slot.ready = null
    // A region belongs to the clip it was marked on, not to the slot: carried
    // over to the next source it would clamp a new timeline against positions
    // that mean nothing in it, and a short one would pin the fresh clip on a
    // single frame. The panel clears its own cue on a source change too
    // (videoSlot.ts's stopSlot); this is the half that cannot be forgotten.
    slot.region = null
    this.resetHealth(slot)
  }

  // Once per rendered frame: hand over anything that finished decoding, then
  // ask for the next. Delivery comes first so a bitmap that arrived during the
  // last frame reaches the GPU now rather than waiting a further frame behind a
  // fresh request. The freeze flags are the decks' pause buttons: a frozen
  // slot stops delivering and stops asking, so the GPU keeps the frame it has
  // — a decoded frame already waiting stays queued for the moment the button
  // comes up.
  pump(sink: VideoFrameSink, freezeA = false, freezeB = false): void {
    // Before anything is delivered, and outside the freeze gates below. A held
    // deck stops the *pictures*, not the tape: its element goes on playing, so a
    // loop that stopped wrapping while the button was down would come back off it
    // somewhere else entirely — and the region is a property of playback, which
    // is exactly what freezing a deck does not touch.
    this.wrap(this.a)
    this.wrap(this.b)
    if (this.direct) {
      if (!freezeA) this.deliverDirect(this.a, el => sink.pushExtA(el))
      if (!freezeB) this.deliverDirect(this.b, el => sink.pushExtB(el))
      return
    }
    if (!freezeA) {
      const readyA = this.take(this.a)
      if (readyA !== null) sink.pushA(readyA)
    }
    if (!freezeB) {
      const readyB = this.take(this.b)
      if (readyB !== null) sink.pushB(readyB)
    }
    if (!freezeA) this.requestA()
    if (!freezeB) this.requestB()
  }

  // Direct mode's whole delivery: the frame test the bitmap path uses, minus
  // the decode it exists to pace.
  private deliverDirect(
    slot: Slot,
    push: (el: HTMLVideoElement) => void,
  ): void {
    const el = slot.el
    if (el !== null && this.due(slot)) {
      slot.lastTime = el.currentTime
      push(el)
    }
  }

  // Bring a slot's playhead back to the top of its loop once it has run past the
  // end. Nothing else is needed to make the next frame arrive: `due` compares
  // currentTime against lastTime, and a seek moves currentTime, so the wrapped
  // position reads as a fresh frame on its own.
  //
  // The seek is issued on the frame the playhead crossed the out-point, so the
  // picture overshoots by one frame at most — measured at 21ms against a 42ms
  // delivery interval on Firefox Nightly (scripts/loopseek.mjs), which is inside
  // the cadence the clip already had. What the same harness found the cost
  // actually tracks is how far back the previous keyframe is: about 17ms plus a
  // third of a millisecond per frame the decoder has to walk forward, so a
  // normally-encoded clip wraps invisibly and one with no keyframes in it does
  // not.
  // Watch the playhead so a wrap's cost can be reported. Runs every frame, before
  // the wrap below, so the "last position the picture was actually at" is current
  // when a wrap is issued.
  //
  // The wrap's own write to currentTime is absorbed rather than counted: it moves
  // the property instantly while the picture stays on the pre-seek frame, so
  // treating it as movement would report every stall as zero — the same mistake
  // the first version of scripts/loopseek.mjs made from the outside.
  // Listen for the end of a seek on whatever element this slot now holds. One
  // listener for the life of the element rather than one per wrap: a wrap can fire
  // several times a second, and adding and removing a listener each time is churn
  // that also races its own removal.
  //
  // A `seeked` with no wrap outstanding is a seek somebody else asked for — the
  // scrub bar, a retrigger — and is ignored, because it is not what the note is
  // about. (A retrigger lands on the same in-point and costs the same, so counting
  // it would not be *wrong*; it is left out so the reading means one thing.)
  private listen(slot: Slot, el: HTMLVideoElement | null): void {
    const prev = slot.el
    if (prev !== null && slot.onSeeked !== null) {
      prev.removeEventListener('seeked', slot.onSeeked)
    }
    slot.onSeeked = null
    if (el === null) return
    const handler = () => {
      if (slot.wrapAt === 0) return
      const took = performance.now() - slot.wrapAt
      slot.wrapAt = 0
      slot.wrapGaps.push(took)
      if (slot.wrapGaps.length > WRAP_WINDOW) slot.wrapGaps.shift()
    }
    slot.onSeeked = handler
    el.addEventListener('seeked', handler)
  }

  // Forget what was measured: a different region is a different in-point, and the
  // cost is a property of where the in-point sits relative to a keyframe.
  private resetHealth(slot: Slot): void {
    slot.wrapGaps = []
    slot.wrapAt = 0
  }

  health(): { a: WrapHealth; b: WrapHealth } {
    const read = (s: Slot): WrapHealth => ({
      medianMs: median(s.wrapGaps),
      laps: s.wrapGaps.length,
    })
    return { a: read(this.a), b: read(this.b) }
  }

  private wrap(slot: Slot): void {
    const el = slot.el
    const r = slot.region
    if (el === null || r === null) return
    // Nothing without a timeline gets looped, whatever it was handed. A webcam, a
    // grabber or a screen share reports a duration of Infinity and ignores a seek
    // anyway, so a region over one would be a wrap attempted every single frame
    // against a playhead that never comes back — and the guard belongs here
    // rather than at each caller, because this is the line that would do it.
    if (!Number.isFinite(el.duration)) return
    if (el.currentTime < r.end) return
    // Stamped before the assignment: `seeked` can fire synchronously for a seek
    // that is already satisfied, and a handler finding wrapAt still 0 would drop
    // the cheapest wraps and leave the median reading only the expensive ones.
    slot.wrapAt = performance.now()
    el.currentTime = r.start
  }

  private take(slot: Slot): PumpedFrame | null {
    const r = slot.ready
    slot.ready = null
    return r
  }

  private due(slot: Slot): boolean {
    const el = slot.el
    return (
      el !== null &&
      !slot.inFlight &&
      el.readyState >= 2 &&
      el.videoWidth > 0 &&
      el.currentTime !== slot.lastTime
    )
  }

  private requestA(): void {
    const el = this.a.el
    if (el !== null && this.due(this.a)) {
      this.a.lastTime = el.currentTime
      const [w, h] = fitSrc(el.videoWidth, el.videoHeight)
      // No crop: A keeps its own aspect and compose letterboxes it.
      this.start(this.a, w, h, el.videoWidth / el.videoHeight, () =>
        createImageBitmap(el, BITMAP_OPTS(w, h)),
      )
    }
  }

  private requestB(): void {
    const el = this.b.el
    if (el !== null && this.due(this.b)) {
      this.b.lastTime = el.currentTime
      // B is always raster-sized with a centred 4:3 crop, and createImageBitmap
      // takes the crop rect and the target size together — so the crop the CPU
      // used to do in drawImage's source rectangle goes off-thread as well.
      // Rounded because the bitmap crop rect is in whole source pixels, where
      // drawImage took the fractional rect directly. Sub-pixel, against a raster
      // 754 wide.
      const [cx, cy, cw, ch] = coverFit43(el.videoWidth, el.videoHeight)
      const sx = Math.round(cx)
      const sy = Math.round(cy)
      const sw = Math.round(cw)
      const sh = Math.round(ch)
      this.start(this.b, ACTIVE_WIDTH, ACTIVE_HEIGHT, 4 / 3, () =>
        createImageBitmap(
          el,
          sx,
          sy,
          sw,
          sh,
          BITMAP_OPTS(ACTIVE_WIDTH, ACTIVE_HEIGHT),
        ),
      )
    }
  }

  // Kick off one bitmap and hold it until the next frame collects it. The
  // dimensions are captured now rather than read back off the element later: a
  // source that changes size mid-flight would otherwise size the texture from
  // the new frame and copy the old one into it.
  private start(
    slot: Slot,
    w: number,
    h: number,
    aspect: number,
    make: () => Promise<ImageBitmap>,
  ): void {
    slot.inFlight = true
    const gen = slot.gen
    // Both handlers check the generation before they touch anything, so a decode
    // the slot has moved on from is inert rather than half-applied.
    make().then(
      bmp => {
        // Nothing downstream survives teardown or a source switch, and an
        // ImageBitmap holds a decoded frame's worth of memory until closed.
        if (this.disposed || gen !== slot.gen) {
          bmp.close()
        } else {
          slot.inFlight = false
          slot.ready?.bmp.close()
          slot.ready = { bmp, w, h, aspect }
        }
      },
      () => {
        // A source torn down mid-decode, or a frame the decoder could not give
        // us. Neither is worth reporting: the slot simply holds its last frame.
        if (gen === slot.gen) {
          slot.inFlight = false
          // But it does have to be *askable* again. `lastTime` was advanced
          // before the decode, and `due()` only re-fires once currentTime moves
          // past it — which a playing clip does on its own and a paused element
          // never does. Left alone, one rejected decode on a still-framed source
          // (an element mid-seek when it was attached, a blocked autoplay)
          // parked that slot on whatever texture it already had for the rest of
          // the session.
          slot.lastTime = -1
        }
      },
    )
  }

  // Dev-only, for the ?debug log: whether a slot holds a live video and how far
  // into it we are.
  info(): {
    videoA: { ready: number; time: number; paused: boolean } | null
    videoB: { ready: number; time: number; paused: boolean } | null
  } {
    return { videoA: probe(this.a.el), videoB: probe(this.b.el) }
  }

  destroy(): void {
    // Before anything downstream goes: a bitmap still in flight resolves after
    // this and must find the flag already set.
    this.disposed = true
    for (const slot of [this.a, this.b]) {
      this.listen(slot, null)
      slot.el = null
      slot.ready?.bmp.close()
      slot.ready = null
    }
  }
}
