// The two input slots feeding the signal chain: two GPU textures, the noise
// flags that let the shaders bypass them, and the capping and aspect handling
// needed to fill them. The chain downstream only ever sees two texture views
// plus a handful of scalars, so none of that reaches it.
//
// A and B are deliberately asymmetric, because the shaders want different
// things from them:
//
//   A keeps its own aspect ratio and its texture is resized to match, so
//     `compose` letterboxes it against the 4:3 raster using srcAspect.
//   B is always at raster size with a centered 4:3 cover-fit crop, so the mixer
//     shader needs no aspect handling at all and its bind groups can be built
//     once.
//
// That asymmetry is why only A can resize a texture mid-session, and therefore
// why only A needs the bind-group rebuild hook.
//
// Nothing here knows what a <video> is. Frames arrive already decoded, as
// bitmaps, from `VideoPump` — which is the half of the input path that has to
// stay on the main thread, and the reason the split exists.

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
import { pageSearch } from './env'

import type { PumpedFrame } from './videopump'

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
// Notably not an HTMLVideoElement: Firefox rejects one outright, which is what
// sends video through VideoPump and arrives back here as a bitmap.
type Drawable = OffscreenCanvas | ImageBitmap

export interface SourcesHost {
  device: GPUDevice
  // Called when slot A's texture is replaced (a new source raster size), which
  // invalidates any bind group holding its view. Never fires during
  // construction — the first call can only come from a set*Source* or a pushed
  // frame whose geometry differs.
  onResizeA: () => void
}

export class Sources {
  private host: SourcesHost

  // Slot A: variable size, its own aspect.
  private texA: GPUTexture
  private aspectA = 4 / 3
  // Oversized *images* stage through this to get capped. Sized to the capped
  // source, not the raster, so A keeps its own aspect. Video never touches it.
  private stageA: OffscreenCanvas | null = null
  // 0 = use the texture; 1 = TV static; 2 = VHS static. Generated in compose.
  private noiseA = 0

  // Slot B: always raster-sized, so its texture and bind groups are fixed.
  private texB: GPUTexture
  private stageB: OffscreenCanvas | null = null
  private noiseB = 0
  private enabledB = true

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

  // A decoded video frame for slot A, sized and aspected as it was when the
  // decode was requested. Ownership of the bitmap passes here.
  pushA(f: PumpedFrame): void {
    this.ensureTexA(f.w, f.h, f.aspect)
    this.host.device.queue.copyExternalImageToTexture(
      { source: f.bmp, flipY: false },
      { texture: this.texA },
      [f.w, f.h],
    )
    this.samplePixel(f.bmp)
    f.bmp.close()
  }

  // Same for B, which always arrives at raster size and pre-cropped.
  pushB(f: PumpedFrame): void {
    this.host.device.queue.copyExternalImageToTexture(
      { source: f.bmp, flipY: false },
      { texture: this.texB },
      [f.w, f.h],
    )
    f.bmp.close()
  }

  // Patterns are drawn on the signal raster (non-square pixels): aspect is 4:3.
  setImageSource(source: Drawable, aspect = 4 / 3): void {
    this.noiseA = 0
    const [w, h] = fitSrc(source.width, source.height)
    this.ensureTexA(w, h, aspect)
    if (w === source.width && h === source.height) {
      this.host.device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture: this.texA },
        [w, h],
      )
      this.samplePixel(source)
    } else {
      this.uploadA(source, w, h)
    }
  }

  // Switch slot A to a GPU-generated noise field (1 TV static, 2 VHS static);
  // 0 restores the texture path. Any real image/video source clears this.
  setNoiseSource(kind: number): void {
    this.noiseA = kind
  }

  setImageSourceB(source: Drawable): void {
    this.noiseB = 0
    this.uploadB(source, source.width, source.height)
  }

  setNoiseSourceB(kind: number): void {
    this.noiseB = kind
  }

  setSourceBEnabled(on: boolean): void {
    this.enabledB = on
  }

  // Centre pixel of what was actually staged, for the ?debug readout. Taken
  // from a 1x1 draw, because on the video path there is no staging canvas left
  // to read back from.
  private samplePixel(src: Drawable): void {
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

  // Dev-only, for the ?debug log: the centre pixel of the last frame staged
  // into A, which is what proves frames are landing rather than the texture
  // being stale. Whether a slot holds a live video is VideoPump's to report.
  get stagedPixelA(): number[] | null {
    return this.lastPixelA
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

  // Scale an oversized image down into stageA (its own aspect, capped).
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
    if (w === ACTIVE_WIDTH && h === ACTIVE_HEIGHT) {
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
