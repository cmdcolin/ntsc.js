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

// Anything that can be drawn into a 2D canvas or copied straight to a texture.
type Drawable = OffscreenCanvas | ImageBitmap | HTMLVideoElement

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
  // Firefox's copyExternalImageToTexture rejects HTMLVideoElement, so video has
  // to stage through a 2D canvas anyway; oversized images stage through the same
  // one to get capped. Sized to the capped source, not the raster, so A keeps
  // its own aspect.
  private stageA: OffscreenCanvas | null = null
  // 0 = use the texture; 1 = TV static; 2 = VHS static. Generated in compose.
  private noiseA = 0

  // Slot B: always raster-sized, so its texture and bind groups are fixed.
  private texB: GPUTexture
  private videoB: HTMLVideoElement | null = null
  private stageB: OffscreenCanvas | null = null
  private noiseB = 0
  private enabledB = true

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
  }

  // Switch slot A to a GPU-generated noise field (1 TV static, 2 VHS static);
  // 0 restores the texture path. Any real image/video source clears this.
  setNoiseSource(kind: number): void {
    this.noiseA = kind
    this.videoA = null
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.noiseB = 0
    this.videoB = null
    this.uploadB(source, source.width, source.height)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    if (el !== null) this.noiseB = 0
    this.videoB = el
  }

  setNoiseSourceB(kind: number): void {
    this.noiseB = kind
    this.videoB = null
  }

  setSourceBEnabled(on: boolean): void {
    this.enabledB = on
  }

  // Pull a frame from whichever slots hold a live <video>. Called once per
  // rendered frame, before the chain runs.
  uploadFrames(): void {
    const a = this.videoA
    if (a !== null && a.readyState >= 2 && a.videoWidth > 0) {
      const [w, h] = fitSrc(a.videoWidth, a.videoHeight)
      this.ensureTexA(w, h, a.videoWidth / a.videoHeight)
      this.uploadA(a, w, h)
    }
    const b = this.videoB
    if (b !== null && b.readyState >= 2 && b.videoWidth > 0) {
      this.uploadB(b, b.videoWidth, b.videoHeight)
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
    const stage = this.stageA
    let stagedPixelA: number[] | null = null
    if (stage !== null) {
      const g = stage.getContext('2d')
      if (g !== null) {
        const d = g.getImageData(stage.width >> 1, stage.height >> 1, 1, 1).data
        stagedPixelA = [d[0], d[1], d[2]]
      }
    }
    return {
      videoA: probe(this.videoA),
      videoB: probe(this.videoB),
      stagedPixelA,
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
    }
  }

  // B is staged to raster size with a centered 4:3 cover-fit crop, so the mixer
  // shader needs no aspect handling.
  private uploadB(source: Drawable, w: number, h: number): void {
    const d = this.host.device
    if (
      w === ACTIVE_WIDTH &&
      h === ACTIVE_HEIGHT &&
      !(source instanceof HTMLVideoElement)
    ) {
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
    this.texA.destroy()
    this.texB.destroy()
  }
}
