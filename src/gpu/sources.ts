// The two input slots feeding the signal chain, and everything needed to get a
// picture into a GPU texture: patterns, stills, video elements, webcam streams,
// and the GPU-generated noise fields. The chain downstream only ever sees two
// texture views plus a handful of scalars, so none of the staging, capping, or
// aspect handling here reaches it.
//
// A and B are deliberately asymmetric, because the shaders want different
// things from them:
//
//   A keeps its own aspect ratio and its texture is resized to match, so
//     `compose` letterboxes it against the 4:3 raster using srcAspect.
//   B is always staged at raster size with a centered 4:3 cover-fit crop on the
//     CPU, so the mixer shader needs no aspect handling at all and its bind
//     groups can be built once.
//
// That asymmetry is why only A can resize a texture mid-session, and therefore
// why only A needs the bind-group rebuild hook.

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
import { pageSearch } from './env'

// compose samples the A texture down to the 754x480 raster (plus a +-2 line
// deinterlace tap), so resolution past ~2x that buys no detail. Uncapped, a
// phone photo lands as a ~200 MB texture whose minified fetches thrash cache
// every frame, and a 4K clip re-uploads 33 MB per frame.
export const MAX_SRC_EDGE = 1536

// Long edge capped to MAX_SRC_EDGE, aspect preserved.
export const fitSrc = (w: number, h: number): [number, number] => {
  const s = Math.min(1, MAX_SRC_EDGE / Math.max(w, h))
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

// Centered 4:3 cover-fit crop of a w x h source: the largest 4:3 rectangle that
// fits inside it, as [sx, sy, sw, sh] in source pixels. Wider-than-4:3 sources
// lose their sides, taller ones lose top and bottom.
export const coverFit43 = (
  w: number,
  h: number,
): [number, number, number, number] => {
  const wide = w / h > 4 / 3
  const sw = wide ? h * (4 / 3) : w
  const sh = wide ? h : w * (3 / 4)
  return [(w - sw) / 2, (h - sh) / 2, sw, sh]
}

// `HTMLVideoElement` is a DOM class, so referencing it as a value throws in a
// worker where it does not exist. The type annotation is erased and harmless;
// only the runtime instanceof needs the guard.
const isVideoElement = (v: unknown): boolean =>
  typeof HTMLVideoElement !== 'undefined' && v instanceof HTMLVideoElement

// Anything that can be drawn into a 2D canvas or copied straight to a texture.
type Drawable = OffscreenCanvas | ImageBitmap | HTMLVideoElement

// One slot's in-flight / awaiting-copy bitmap. `w`/`h`/`aspect` are the values
// captured when the bitmap was requested, not read back off the element later.
interface VideoStaging {
  inFlight: boolean
  ready: { bmp: ImageBitmap; w: number; h: number; aspect: number } | null
  // Bumped whenever the slot's source changes. A bitmap that was already being
  // decoded when the user switched sources resolves against the old generation
  // and is dropped, rather than landing a frame of the previous clip in the new
  // one's texture — a flash that would be near-impossible to attribute later.
  gen: number
}

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

export interface SourcesHost {
  device: GPUDevice
  // Called when slot A's texture is replaced (a new source raster size), which
  // invalidates any bind group holding its view. Never fires during
  // construction — the first call can only come from a set*Source*.
  onResizeA: () => void
}

const probe = (el: HTMLVideoElement | null) =>
  el === null
    ? null
    : { ready: el.readyState, time: Number(el.currentTime.toFixed(2)) }

export class Sources {
  private host: SourcesHost

  // Slot A: variable size, its own aspect.
  private texA: GPUTexture
  private aspectA = 4 / 3
  private videoA: HTMLVideoElement | null = null
  // Firefox's copyExternalImageToTexture takes only ImageBitmap,
  // HTMLImageElement, HTMLCanvasElement and OffscreenCanvas — an
  // HTMLVideoElement is rejected outright, importExternalTexture is not
  // implemented (bugzilla 1827116) and a WebCodecs VideoFrame is rejected too.
  // So a video frame has to become one of those four first, and which one is
  // the single biggest main-thread decision in the app. See uploadVideoFrames.
  //
  // This canvas is now only the one-shot path: oversized *images* stage through
  // it to get capped. Sized to the capped source, not the raster, so A keeps its
  // own aspect.
  private stageA: OffscreenCanvas | null = null
  // 0 = use the texture; 1 = TV static; 2 = VHS static. Generated in compose.
  private noiseA = 0
  // currentTime of the last frame staged, per slot. Video plays at its own
  // rate (24/30 fps) under a 60 fps render loop, so without this check half
  // the uploads re-stage a byte-identical frame — and the stage + copy of a
  // capped 1080p frame measures ~5 ms on an iGPU, the single largest per-frame
  // cost in the whole app. -1 forces the first upload.
  private lastTimeA = -1
  private lastTimeB = -1

  // Slot B: always raster-sized, so its texture and bind groups are fixed.
  private texB: GPUTexture
  private videoB: HTMLVideoElement | null = null
  private stageB: OffscreenCanvas | null = null
  private noiseB = 0
  private enabledB = true

  // Per-slot video staging state. `inFlight` is a createImageBitmap that has not
  // resolved; `ready` is one that has, waiting for the next frame to copy it.
  // At most one of each per slot: a decoder that falls behind must not be able
  // to queue bitmaps faster than they are consumed.
  private stagingA: VideoStaging = { inFlight: false, ready: null, gen: 0 }
  private stagingB: VideoStaging = { inFlight: false, ready: null, gen: 0 }
  private disposed = false
  // The centre staged pixel, kept for the ?debug readout only — see debugInfo.
  // Sampling it costs a getImageData, so it is only taken when asked for.
  private readonly debug = pageSearch().includes('debug')
  private probe1: OffscreenCanvas | null = null
  private lastPixelA: number[] | null = null

  constructor(host: SourcesHost) {
    this.host = host
    this.texA = this.createTexA(ACTIVE_WIDTH, ACTIVE_HEIGHT)
    this.texB = host.device.createTexture({
      size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.STORAGE_BINDING,
    })
  }

  // What the chain reads: two views and the scalars that describe the slots.
  viewA(): GPUTextureView {
    return this.texA.createView()
  }

  viewB(): GPUTextureView {
    return this.texB.createView()
  }

  get srcAspect(): number {
    return this.aspectA
  }

  get srcNoise(): number {
    return this.noiseA
  }

  get srcNoiseB(): number {
    return this.noiseB
  }

  get bEnabled(): boolean {
    return this.enabledB
  }

  private createTexA(w: number, h: number): GPUTexture {
    return this.host.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  // Patterns are drawn on the signal raster (non-square pixels): aspect is 4:3.
  setImageSource(source: OffscreenCanvas | ImageBitmap, aspect = 4 / 3): void {
    this.noiseA = 0
    this.videoA = null
    this.resetStaging(this.stagingA)
    const [w, h] = fitSrc(source.width, source.height)
    this.ensureTexA(w, h, aspect)
    if (w === source.width && h === source.height) {
      this.host.device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture: this.texA },
        [w, h],
      )
    } else {
      this.uploadA(source, w, h)
    }
  }

  setVideoSource(el: HTMLVideoElement | null): void {
    if (el !== null) this.noiseA = 0
    this.videoA = el
    this.resetStaging(this.stagingA)
    // a re-attached element may sit paused at the same currentTime; the first
    // frame must upload regardless or the slot shows whatever was there before
    this.lastTimeA = -1
  }

  // Switch slot A to a GPU-generated noise field (1 TV static, 2 VHS static);
  // 0 restores the texture path. Any real image/video source clears this.
  setNoiseSource(kind: number): void {
    this.noiseA = kind
    this.videoA = null
    this.resetStaging(this.stagingA)
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.noiseB = 0
    this.videoB = null
    this.resetStaging(this.stagingB)
    this.uploadB(source, source.width, source.height)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    if (el !== null) this.noiseB = 0
    this.videoB = el
    this.resetStaging(this.stagingB)
    this.lastTimeB = -1
  }

  setNoiseSourceB(kind: number): void {
    this.noiseB = kind
    this.videoB = null
    this.resetStaging(this.stagingB)
  }

  setSourceBEnabled(on: boolean): void {
    this.enabledB = on
  }

  // Pull a frame from whichever slots hold a live <video>. Called once per
  // rendered frame, before the chain runs.
  //
  // Staging a video frame used to be `drawImage` into a 2D canvas and copy from
  // that, all of it synchronous on the main thread, and it was by a distance the
  // most expensive thing the app did per frame: measured on Firefox Nightly with
  // a 1440x1080 clip, 27 ms median (43 ms p90) for slot A and 14 ms (23 ms p90)
  // for slot B, against a 16.7 ms budget. Staging fires once per *video* frame
  // rather than per rendered frame, so at 24 fps that is still most of a second
  // of main thread per second — enough to starve rAF outright, and enough to
  // stall the completion callbacks the render loop reads GPU liveness from,
  // which is how it used to end up reporting a hung GPU that was perfectly fine.
  //
  // createImageBitmap does the decode-to-RGBA and the scale off-thread and hands
  // back something copyExternalImageToTexture will take directly, leaving only
  // the copy on the main thread: 7 ms and 2 ms for the same two cases. It is
  // asynchronous, so the frame staged is up to one rendered frame behind — which
  // costs nothing, because video runs at 24-30 fps under a 60 fps loop and the
  // texture already only changed on the frames where currentTime moved.
  uploadFrames(): void {
    // Copy first, then request: a bitmap that arrived during the last frame goes
    // to the GPU now rather than waiting a further frame behind a fresh request.
    this.copyStaged(this.stagingA, true)
    this.copyStaged(this.stagingB, false)
    this.requestA()
    this.requestB()
  }

  private requestA(): void {
    const a = this.videoA
    if (
      a !== null &&
      !this.stagingA.inFlight &&
      a.readyState >= 2 &&
      a.videoWidth > 0 &&
      a.currentTime !== this.lastTimeA
    ) {
      this.lastTimeA = a.currentTime
      const [w, h] = fitSrc(a.videoWidth, a.videoHeight)
      this.stage(this.stagingA, w, h, a.videoWidth / a.videoHeight, () =>
        // No crop: A keeps its own aspect and compose letterboxes it.
        createImageBitmap(a, BITMAP_OPTS(w, h)),
      )
    }
  }

  private requestB(): void {
    const b = this.videoB
    if (
      b !== null &&
      !this.stagingB.inFlight &&
      b.readyState >= 2 &&
      b.videoWidth > 0 &&
      b.currentTime !== this.lastTimeB
    ) {
      this.lastTimeB = b.currentTime
      // B is always raster-sized with a centred 4:3 crop, and createImageBitmap
      // takes the crop rect and the target size together — so the crop the CPU
      // used to do in drawImage's source rectangle goes off-thread as well.
      // Rounded because the bitmap crop rect is in whole source pixels, where
      // drawImage took the fractional rect directly. Sub-pixel, and the raster
      // it lands on is 754 wide.
      const [cx, cy, cw, ch] = coverFit43(b.videoWidth, b.videoHeight)
      const sx = Math.round(cx)
      const sy = Math.round(cy)
      const sw = Math.round(cw)
      const sh = Math.round(ch)
      this.stage(this.stagingB, ACTIVE_WIDTH, ACTIVE_HEIGHT, 4 / 3, () =>
        createImageBitmap(
          b,
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
  private stage(
    slot: VideoStaging,
    w: number,
    h: number,
    aspect: number,
    make: () => Promise<ImageBitmap>,
  ): void {
    slot.inFlight = true
    const gen = slot.gen
    make().then(
      bmp => {
        slot.inFlight = false
        // Nothing downstream survives teardown or a source switch, and an
        // ImageBitmap holds a decoded frame's worth of memory until closed.
        if (this.disposed || gen !== slot.gen) {
          bmp.close()
        } else {
          slot.ready?.bmp.close()
          slot.ready = { bmp, w, h, aspect }
        }
      },
      () => {
        // A source torn down mid-decode, or a frame the decoder could not give
        // us. Neither is worth reporting: the slot simply holds its last frame,
        // and `lastTime` has already moved on so the next one is requested
        // normally.
        slot.inFlight = false
      },
    )
  }

  // The slot's source changed: drop anything staged for the old one. The
  // in-flight decode cannot be cancelled, so the generation bump is what
  // disowns it when it lands.
  private resetStaging(slot: VideoStaging): void {
    slot.gen += 1
    slot.ready?.bmp.close()
    slot.ready = null
  }

  private copyStaged(slot: VideoStaging, isA: boolean): void {
    const r = slot.ready
    if (r !== null) {
      slot.ready = null
      if (isA) this.ensureTexA(r.w, r.h, r.aspect)
      this.host.device.queue.copyExternalImageToTexture(
        { source: r.bmp, flipY: false },
        { texture: isA ? this.texA : this.texB },
        [r.w, r.h],
      )
      if (isA) this.samplePixel(r.bmp)
      r.bmp.close()
    }
  }

  // Centre pixel of what was actually staged, for the ?debug readout. Taken from
  // a 1x1 draw rather than the full staging canvas, which no longer exists on
  // the video path.
  private samplePixel(src: ImageBitmap | OffscreenCanvas): void {
    if (this.debug) {
      this.probe1 ??= new OffscreenCanvas(1, 1)
      const g = this.probe1.getContext('2d')
      if (g !== null) {
        g.drawImage(src, src.width >> 1, src.height >> 1, 1, 1, 0, 0, 1, 1)
        const d = g.getImageData(0, 0, 1, 1).data
        this.lastPixelA = [d[0], d[1], d[2]]
      }
    }
  }

  // Dev-only snapshot for the ?debug log: whether a slot holds a live video and
  // how far into it we are, plus the centre staged pixel, which is what proves
  // frames are actually landing rather than the texture being stale.
  debugInfo(): {
    videoA: { ready: number; time: number } | null
    videoB: { ready: number; time: number } | null
    stagedPixelA: number[] | null
  } {
    return {
      videoA: probe(this.videoA),
      videoB: probe(this.videoB),
      // Sampled at staging time (samplePixel) rather than read back here: on the
      // video path there is no staging canvas left to read, and this is still
      // what proves frames are landing rather than the texture being stale.
      stagedPixelA: this.lastPixelA,
    }
  }

  private ensureTexA(w: number, h: number, aspect: number): void {
    this.aspectA = aspect
    if (this.texA.width !== w || this.texA.height !== h) {
      this.texA.destroy()
      this.texA = this.createTexA(w, h)
      // The view held by compose's bind group belongs to the destroyed texture.
      this.host.onResizeA()
    }
  }

  // Scale a source down into stageA (its own aspect, capped) and upload. Used
  // for oversized images and every video frame (the latter also because Firefox
  // won't copy an HTMLVideoElement directly).
  private uploadA(source: Drawable, w: number, h: number): void {
    if (this.stageA?.width !== w || this.stageA.height !== h) {
      this.stageA = new OffscreenCanvas(w, h)
    }
    const g = this.stageA.getContext('2d')
    if (g) {
      g.drawImage(source, 0, 0, w, h)
      this.host.device.queue.copyExternalImageToTexture(
        { source: this.stageA, flipY: false },
        { texture: this.texA },
        [w, h],
      )
      this.samplePixel(this.stageA)
    }
  }

  // B is staged to raster size with a centered 4:3 cover-fit crop, so the mixer
  // shader needs no aspect handling.
  private uploadB(source: Drawable, w: number, h: number): void {
    const d = this.host.device
    if (w === ACTIVE_WIDTH && h === ACTIVE_HEIGHT && !isVideoElement(source)) {
      d.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture: this.texB },
        [w, h],
      )
    } else {
      this.stageB ??= new OffscreenCanvas(ACTIVE_WIDTH, ACTIVE_HEIGHT)
      const g = this.stageB.getContext('2d')
      if (g) {
        const [sx, sy, sw, sh] = coverFit43(w, h)
        g.drawImage(source, sx, sy, sw, sh, 0, 0, ACTIVE_WIDTH, ACTIVE_HEIGHT)
        d.queue.copyExternalImageToTexture(
          { source: this.stageB, flipY: false },
          { texture: this.texB },
          [ACTIVE_WIDTH, ACTIVE_HEIGHT],
        )
      }
    }
  }

  destroy(): void {
    // Before the textures go: a bitmap still in flight resolves after this and
    // must find the flag already set, or it copies into a destroyed texture.
    this.disposed = true
    for (const slot of [this.stagingA, this.stagingB]) {
      slot.ready?.bmp.close()
      slot.ready = null
    }
    this.texA.destroy()
    this.texB.destroy()
  }
}
