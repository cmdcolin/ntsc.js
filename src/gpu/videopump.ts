// Turning a playing <video> into something the GPU will take.
//
// This is deliberately the only part of the input path that touches a DOM
// element, and it is separated from `Sources` for two reasons. The obvious one
// is that they are different jobs: this decides *when* a frame is worth
// decoding and produces a bitmap, while Sources owns textures and knows nothing
// about where a picture came from.
//
// The other is that a worker has no HTMLVideoElement at all. Splitting here
// means the half that must stay on the main thread is exactly this file, and
// what crosses to a worker-owned engine is an ImageBitmap — which is
// transferable, so it crosses without a copy.

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
// texture; slot B always arrives at raster size, pre-cropped.
export interface VideoFrameSink {
  pushA: (f: PumpedFrame) => void
  pushB: (f: PumpedFrame) => void
}

interface Slot {
  el: HTMLVideoElement | null
  inFlight: boolean
  ready: PumpedFrame | null
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
  lastTime: -1,
  gen: 0,
})

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

  // Point a slot at an element, or at nothing. A re-attached element may sit
  // paused at the same currentTime, so the next frame must be requested
  // regardless or the slot goes on showing whatever was there before.
  setA(el: HTMLVideoElement | null): void {
    this.retarget(this.a, el)
  }

  setB(el: HTMLVideoElement | null): void {
    this.retarget(this.b, el)
  }

  // Everything about the slot goes back to untouched, `inFlight` included. A
  // decode from the outgoing source is still running and cannot be cancelled,
  // but it belongs to a generation this slot has retired, so it is not allowed
  // to write here at all — see `start`. Leaving `inFlight` for that decode's own
  // handler to clear was the same coupling in the other direction: the stale
  // decode cleared a flag the *new* one had set, and the next pump started a
  // second decode of a source already being decoded.
  private retarget(slot: Slot, el: HTMLVideoElement | null): void {
    slot.el = el
    slot.lastTime = -1
    slot.inFlight = false
    slot.gen += 1
    slot.ready?.bmp.close()
    slot.ready = null
  }

  // Once per rendered frame: hand over anything that finished decoding, then
  // ask for the next. Delivery comes first so a bitmap that arrived during the
  // last frame reaches the GPU now rather than waiting a further frame behind a
  // fresh request.
  pump(sink: VideoFrameSink): void {
    const readyA = this.take(this.a)
    if (readyA !== null) sink.pushA(readyA)
    const readyB = this.take(this.b)
    if (readyB !== null) sink.pushB(readyB)
    this.requestA()
    this.requestB()
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
      slot.el = null
      slot.ready?.bmp.close()
      slot.ready = null
    }
  }
}
