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

// What a slot wants a source staged as: the size to land at, the aspect to tell
// compose about, and the rectangle of the source to take.
//
// **Stated once for each slot rather than at each call site**, because there are
// now two of those — a frame off the element and a frame off a take's decoder —
// and the rules are a property of the slot rather than of where the picture came
// from. Two copies of "B is raster-sized with a centred 4:3 crop" is the
// duplication `slotView.ts` already argues about at a smaller scale.
interface Stage {
  w: number
  h: number
  aspect: number
  // Source rectangle, or null for the whole picture.
  crop: [number, number, number, number] | null
}

// A keeps its own aspect and compose letterboxes it, so there is no crop.
const stageA = (vw: number, vh: number): Stage => {
  const [w, h] = fitSrc(vw, vh)
  return { w, h, aspect: vw / vh, crop: null }
}

// B is always raster-sized with a centred 4:3 crop, and `createImageBitmap`
// takes the crop rect and the target size together — so the crop the CPU used to
// do in drawImage's source rectangle goes off-thread as well. Rounded because
// the bitmap crop rect is in whole source pixels, where drawImage took the
// fractional rect directly. Sub-pixel, against a raster 754 wide.
const stageB = (vw: number, vh: number): Stage => {
  const [cx, cy, cw, ch] = coverFit43(vw, vh)
  return {
    w: ACTIVE_WIDTH,
    h: ACTIVE_HEIGHT,
    aspect: 4 / 3,
    crop: [Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch)],
  }
}

const bitmapFor = (
  src: ImageBitmapSource,
  stage: Stage,
): Promise<ImageBitmap> =>
  stage.crop === null
    ? createImageBitmap(src, BITMAP_OPTS(stage.w, stage.h))
    : createImageBitmap(
        src,
        stage.crop[0],
        stage.crop[1],
        stage.crop[2],
        stage.crop[3],
        BITMAP_OPTS(stage.w, stage.h),
      )

// Where finished frames go. Slot A keeps its own aspect and may resize its
// texture; slot B always arrives at raster size, pre-cropped. The pushExt
// pair is the direct path: no bitmap was made, the element itself is handed
// over for the engine to importExternalTexture this frame (see blit_ext.wgsl).
interface VideoFrameSink {
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

// Asked at the moment a loop would wrap: is there a second read head to
// continue on, already parked at `start`? An element means "carry on with this
// one"; null means seek, which is what every loop did before there was a second
// head and what every loop still does when one is not ready in time.
//
// **The caller does not tell the pump about the element it hands back.** The
// swap below is the telling — routing it through `setVideoSource` as well would
// come back through `retarget`, which clears the region on purpose, and the loop
// would end at its first lap. This is not the same operation as a source change
// and does not share its funnel: see `continueOn`.
// The whole region and not just the in-point: the caller sends the outgoing head
// back to `start`, and `end - start` is the lap it has to be back inside — which
// is the deadline that decides whether keeping a head is worth anything at all.
export type Relay = (start: number, end: number) => HTMLVideoElement | null

// A clip a take can step frame by frame, as the pump needs it. Declared here
// rather than where one is built, because the shape is what this file depends
// on and the decoder behind it is the app's business — `ui/framePull.ts` holds
// the WebCodecs implementation and the measurements that chose it.
export interface FramePull {
  // The frame shown at `seconds` on the clip's own timeline. **Ownership passes
  // to the caller**, which must `close()` it — a `VideoFrame` holds a decoded
  // picture and a decoder that runs out of them stalls rather than failing.
  //
  // Null means there is no frame there: before the first, past the last, or a
  // decoder that has given up. A render treats that the way it treats a clip
  // that has not loaded — it renders what is on the slot already — rather than
  // as an error, because a rundown that runs a row past its clip's end is an
  // ordinary thing for a rundown to do.
  frameAt: (seconds: number) => Promise<VideoFrame | null>
  // The clip's own length, so a caller can decide what running off the end
  // means without having to demux it a second time.
  duration: number
  codedWidth: number
  codedHeight: number
  close: () => void
}

// Where a slot's frames come from while a take is running, given the url the
// element is on. Null for a source that cannot be pulled from — a webcam, a
// generated mode, a codec the demuxer declines — and that is a fallback rather
// than a failure: the slot keeps the wall-rate element it already has, and the
// take is exactly as reproducible as one has always been.
//
// Handed in rather than imported, on the same seam as `Relay` above and for the
// same reason: this file owns *when* a frame is wanted, and whoever owns the
// elements owns what is behind them.
export type PullOpener = (url: string) => Promise<FramePull | null>

interface Slot {
  el: HTMLVideoElement | null
  inFlight: boolean
  ready: PumpedFrame | null
  // Where this slot's loop runs, or null for "play straight through".
  region: Region | null
  relay: Relay | null
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
  // --- under a take only ---
  //
  // The decoder this slot's pictures come from, and the open that is still in
  // flight. Two fields rather than one because opening is a fetch and a demux:
  // a row that swaps a clip mid-render has to be *waited for* by the frame that
  // wants it, which is the awaiting sink docs/EDITOR.md describes and the reason
  // it was worth nothing until the thing on the other side was frame exact.
  pull: FramePull | null
  pullPending: Promise<FramePull | null> | null
  // The take frame this slot's current source went on. What makes the clip
  // position a function of the take frame *and of when this clip arrived*, so a
  // row firing at frame 300 starts its clip at its in-point rather than five
  // seconds in.
  takeFrom: number
}

const emptySlot = (): Slot => ({
  el: null,
  inFlight: false,
  ready: null,
  region: null,
  relay: null,
  wrapAt: 0,
  onSeeked: null,
  wrapGaps: [],
  lastTime: -1,
  gen: 0,
  pull: null,
  pullPending: null,
  takeFrom: 0,
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
  // Non-null while a take is running: the rate its frames are counted at, and
  // the frame it has reached. See `setTakeFps`.
  private takeFps: number | null = null
  private takeFrame = 0
  private opener: PullOpener | null = null

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

  // Where a slot's second read head is offered from, or null for "always seek".
  // Set once for the life of the slot rather than armed per loop: the answer to
  // "is there another head" belongs to whoever owns the elements, and asking it
  // at the wrap is cheaper than keeping this in step with every cue press.
  setRelayA(relay: Relay | null): void {
    this.a.relay = relay
  }

  setRelayB(relay: Relay | null): void {
    this.b.relay = relay
  }

  // Where a take's frames are opened from. Set once at engine creation, like
  // the relay: the answer belongs to whoever owns the elements.
  setPullOpener(open: PullOpener | null): void {
    this.opener = open
  }

  // **The take's clock reaching the video**, which is the last place in the
  // engine it did not (docs/EDITOR.md › _Take state_). `fps` puts every slot on
  // a playhead the pump computes from the frame number; `null` gives them back
  // to their elements.
  //
  // What changes under it is not only where frames come from but *who owns the
  // playhead*. Live, the element's `currentTime` is the position and the pump
  // reads it; under a take the position is arithmetic on the frame counter and
  // the element is not consulted at all — which is the whole difference between
  // a picture that advances at wall rate and one that is a function of N.
  setTakeFps(fps: number | null): void {
    this.takeFps = fps
    this.takeFrame = 0
    for (const slot of [this.a, this.b]) {
      this.closePull(slot)
      slot.takeFrom = 0
      if (fps !== null) this.openPull(slot)
    }
  }

  // Stage each pulling slot's picture for take frame `frame`. Awaited by the
  // render before it steps, which is the one thing `pump()` cannot be: a decode
  // that has not landed is a frame of the wrong picture, and polling for it the
  // way the live path does is exactly the wall-rate behaviour this replaces.
  //
  // A slot with no puller is untouched and goes on being pumped from its
  // element. That is the fallback, and it is why this can be awaited
  // unconditionally by a render that does not know what is on the decks.
  async pullFrames(frame: number): Promise<void> {
    if (this.takeFps === null) return
    this.takeFrame = frame
    await Promise.all([
      this.pullSlot(this.a, frame, false),
      this.pullSlot(this.b, frame, true),
    ])
  }

  // Whether this slot's pictures are coming from a decoder rather than from its
  // element. The guard on every path that would otherwise read or move the
  // element's own playhead.
  private pulling(slot: Slot): boolean {
    return this.takeFps !== null && slot.pull !== null
  }

  private closePull(slot: Slot): void {
    slot.pull?.close()
    slot.pull = null
    // A pending open is left to settle and closed on arrival rather than
    // cancelled: a fetch cannot be taken back, and an opener that resolved into
    // a slot which had moved on would be a decoder nothing ever closes.
    const pending = slot.pullPending
    slot.pullPending = null
    if (pending !== null) void pending.then(p => p?.close())
  }

  // Start opening a puller for whatever this slot's element is on. A no-op
  // outside a take, for an element with no url, or with no opener wired — all
  // three of which are the fallback rather than a fault.
  private openPull(slot: Slot): void {
    const el = slot.el
    if (this.takeFps === null || this.opener === null) return
    // `src` alone is the test, and it is exact: the load paths set either `src`
    // (a url) or `srcObject` (a webcam, a grabber, a shared screen) and never
    // both, so an empty `src` *is* "nothing here a decoder could be opened on".
    // Checking `srcObject` as well reads as more careful and is not — it is a
    // second way to spell the same condition, and one an element that has never
    // had either leaves undefined rather than null.
    if (el === null || el.src === '') return
    const gen = slot.gen
    const opening = this.opener(el.src)
    slot.pullPending = opening
    void opening.then(
      pull => {
        // The slot moved on while the file was being fetched, so this decoder
        // is for a clip that is no longer here. Same generation check the
        // bitmap path makes, for the same reason.
        if (this.disposed || gen !== slot.gen || slot.pullPending !== opening) {
          pull?.close()
          return
        }
        slot.pullPending = null
        slot.pull = pull
      },
      () => {
        if (slot.pullPending === opening) slot.pullPending = null
      },
    )
  }

  // One slot's picture for one take frame.
  //
  // **The clip position is computed from the frame, not accumulated.** An
  // accumulated head would drift with every rounding, and worse, would make the
  // picture depend on how many times this was called rather than on which frame
  // it was called for — which is the property the whole take rests on.
  private async pullSlot(
    slot: Slot,
    frame: number,
    crop: boolean,
  ): Promise<void> {
    // An open still in flight is waited for here, which is the only place a
    // render blocks on a load. A row that names a clip therefore arrives on the
    // frame it was fired on rather than whenever the network answered.
    if (slot.pullPending !== null) await slot.pullPending
    const pull = slot.pull
    const fps = this.takeFps
    if (pull === null || fps === null) return
    // The deck's own speed, which is a setting rather than a position — so
    // reading it off the element keeps a slowed clip slowed without putting the
    // element's playhead back in the loop.
    const rate = slot.el?.playbackRate ?? 1
    const elapsed = ((frame - slot.takeFrom) / fps) * rate
    const r = slot.region
    const looped = r !== null && r.end > r.start
    const base = looped ? r.start : 0
    const span = looped ? r.end - r.start : pull.duration
    // **The wrap is a modulo, and it is exact where the live one is not.** A
    // playing element overshoots its out-point by up to a frame because the
    // clamp can only fire once the playhead has crossed it; arithmetic has no
    // such lag, so a looped take lands on the in-point rather than a frame past
    // it. That is a difference from the live picture and the right way round:
    // the render is the one that can afford to be exact.
    const at = span > 0 ? base + (elapsed % span) : base
    const vf = await pull.frameAt(at)
    if (vf === null) return
    try {
      if (this.disposed) return
      // The frame's *display* size, not its coded one: a clip with a non-square
      // pixel aspect codes at one size and is meant to be seen at another, and
      // the aspect is what compose letterboxes by.
      const vw = vf.displayWidth
      const vh = vf.displayHeight
      if (vw === 0 || vh === 0) return
      const stage = crop ? stageB(vw, vh) : stageA(vw, vh)
      const bmp = await bitmapFor(vf, stage)
      // Checked after the await as well as before: a source change during the
      // conversion retires this frame rather than landing the outgoing clip in
      // the incoming one's texture.
      if (this.disposed || !this.pulling(slot)) {
        bmp.close()
        return
      }
      slot.ready?.bmp.close()
      slot.ready = { bmp, w: stage.w, h: stage.h, aspect: stage.aspect }
    } catch {
      // A frame the browser would not convert. The slot holds its last picture,
      // which is what the element path does with the same failure.
    } finally {
      vf.close()
    }
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
    // A decoder belongs to the clip it was opened on, so a source change retires
    // it and opens the next — and the new clip starts *now* rather than however
    // far into the take it happens to be, which is what makes a row that fires
    // at frame 300 begin its clip at the top.
    this.closePull(slot)
    slot.takeFrom = this.takeFrame
    this.openPull(slot)
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
    // **A pulling slot takes the bitmap path even in direct mode.** Direct means
    // "let the engine import the decoder's own frame off the element", and a
    // slot under a take has no element worth importing — its picture was staged
    // by `pullFrames` as a bitmap, on the route `scripts/codeccheck.mjs` found
    // is the only one Firefox leaves open for a `VideoFrame` anyway. A branch
    // per slot rather than per pump, because A and B can differ: one deck on a
    // pullable clip and the other on a webcam is an ordinary thing to render.
    // **Wrapped, not passed.** `Sources` is a class and its `pushA` wants its
    // own receiver; handing the method across bare drops it, and the failure is
    // `this is undefined` inside the *sink* — a stack that names neither this
    // file nor the change that caused it. The direct path below always wrapped
    // for this reason and the bitmap path used to call through `sink.` directly,
    // so factoring the two together is exactly where the receiver goes missing.
    if (!freezeA) {
      this.deliver(
        this.a,
        f => sink.pushA(f),
        el => sink.pushExtA(el),
      )
    }
    if (!freezeB) {
      this.deliver(
        this.b,
        f => sink.pushB(f),
        el => sink.pushExtB(el),
      )
    }
    if (!freezeA) this.requestA()
    if (!freezeB) this.requestB()
  }

  private deliver(
    slot: Slot,
    push: (f: PumpedFrame) => void,
    pushExt: (el: HTMLVideoElement) => void,
  ): void {
    if (this.direct && !this.pulling(slot)) {
      this.deliverDirect(slot, pushExt)
      return
    }
    const ready = this.take(slot)
    if (ready !== null) push(ready)
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
    // A pulling slot's loop is the modulo in `pullSlot`, and seeking the element
    // here would be moving a playhead nothing reads — at the price of the seek
    // this whole route exists to avoid.
    if (this.pulling(slot)) return
    // Nothing without a timeline gets looped, whatever it was handed. A webcam, a
    // grabber or a screen share reports a duration of Infinity and ignores a seek
    // anyway, so a region over one would be a wrap attempted every single frame
    // against a playhead that never comes back — and the guard belongs here
    // rather than at each caller, because this is the line that would do it.
    if (!Number.isFinite(el.duration)) return
    // An empty region is the same shape of fault one line down: the playhead is
    // never strictly before the end, so every frame issues a seek that lands
    // right back where the test fails again, and the slot pins on one frame while
    // the decoder is asked to jump sixty times a second. `tapCue` and `parseCue`
    // both hold a non-empty span, but `setVideoRegion` is on the public engine
    // API that the harnesses drive, and this is the line that would spin.
    if (r.end <= r.start) return
    if (el.currentTime < r.end) return
    // The second read head first, because it is the version of this that costs
    // nothing: an element already parked at the in-point needs no seek, and the
    // seek is the whole of what a wrap costs the picture *and* the sound
    // (scripts/wrapsound.mjs). Null is the ordinary answer — no head armed, or
    // one that has not finished parking — and then this is the seek it always
    // was.
    const head = slot.relay?.(r.start, r.end) ?? null
    if (head !== null && head !== el) {
      this.continueOn(slot, head)
      return
    }
    // Stamped before the assignment: `seeked` can fire synchronously for a seek
    // that is already satisfied, and a handler finding wrapAt still 0 would drop
    // the cheapest wraps and leave the median reading only the expensive ones.
    slot.wrapAt = performance.now()
    el.currentTime = r.start
  }

  // The same clip, on the other read head. `retarget` with the two lines that
  // make it a *source* change left out, and that is the whole of the difference:
  //
  //   - **the region stays.** A relay is one lap of the loop it was marked on,
  //     not a new clip, so clearing the region here would end every loop at its
  //     first wrap. This is why a promotion must not go back through
  //     `setVideoSource`.
  //   - **the health window goes**, which is the one place this departs from
  //     retarget's reasons rather than borrowing them. `wrapCostMs` is what the
  //     cue row shows, and what it has to mean is *what wrapping this loop is
  //     costing now* — so laps the loop has stopped paying for cannot be left in
  //     it. Carrying them would let a head that arrived late latch a number from
  //     the two or three seeking wraps that beat it there, and report that number
  //     for the life of the cue while every wrap after it was free.
  //
  //     Clearing rather than pushing a zero because `laps` is the count of
  //     *measured seeks* and the readout says nothing below two: a head that
  //     gives up refills the window within two laps and the number comes back.
  //     That is only stable because a head cannot alternate — one that misses its
  //     lap is retired at the deadline (ui/videoSlot.ts › `promoteHead`) rather
  //     than left to be not-ready at every other wrap.
  //
  // Everything else is retarget's, for retarget's reasons: the listener follows
  // the element, the generation is bumped so a decode from the outgoing head
  // cannot write here, and `lastTime` is cleared so the first frame of the new
  // one is asked for even though it sits at a position the old one already had.
  private continueOn(slot: Slot, el: HTMLVideoElement): void {
    this.listen(slot, el)
    slot.el = el
    slot.lastTime = -1
    slot.inFlight = false
    slot.gen += 1
    slot.ready?.bmp.close()
    slot.ready = null
    // Which also clears `wrapAt`, and that half is not optional: a seek
    // outstanding on the element being left belongs to it, and its `seeked` will
    // never be heard here now. Left set, the next real wrap's handler would close
    // it and report a gap that spans a lap.
    this.resetHealth(slot)
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
      // A pulling slot's picture is staged by `pullFrames` before the step, so
      // asking the element for one would overwrite a frame that is a function
      // of N with one that is a function of the wall clock — silently, and only
      // in the file.
      !this.pulling(slot) &&
      !slot.inFlight &&
      el.readyState >= 2 &&
      el.videoWidth > 0 &&
      el.currentTime !== slot.lastTime
    )
  }

  private requestA(): void {
    const el = this.a.el
    // Direct mode makes no bitmaps at all; `deliver` above is the whole of its
    // delivery. A pulling slot is caught by `due`.
    if (this.direct) return
    if (el !== null && this.due(this.a)) {
      this.a.lastTime = el.currentTime
      const stage = stageA(el.videoWidth, el.videoHeight)
      this.start(this.a, stage, () => bitmapFor(el, stage))
    }
  }

  private requestB(): void {
    const el = this.b.el
    if (this.direct) return
    if (el !== null && this.due(this.b)) {
      this.b.lastTime = el.currentTime
      const stage = stageB(el.videoWidth, el.videoHeight)
      this.start(this.b, stage, () => bitmapFor(el, stage))
    }
  }

  // Kick off one bitmap and hold it until the next frame collects it. The
  // dimensions are captured now rather than read back off the element later: a
  // source that changes size mid-flight would otherwise size the texture from
  // the new frame and copy the old one into it.
  private start(
    slot: Slot,
    stage: Stage,
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
          slot.ready = { bmp, w: stage.w, h: stage.h, aspect: stage.aspect }
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
      // The relay closes over the slot that owns the elements, which outlives
      // this object — a pump kept alive by a stale reference would go on being
      // asked nothing and holding everything.
      slot.relay = null
      slot.ready?.bmp.close()
      slot.ready = null
      // A decoder is a real resource and holds decoded pictures; an engine torn
      // down mid-render must not leave one open. `closePull` also disposes of an
      // open still in flight, which is the case a teardown is most likely to
      // catch — a render abandoned while a row's clip was being fetched.
      this.closePull(slot)
    }
    this.takeFps = null
    this.opener = null
  }
}
