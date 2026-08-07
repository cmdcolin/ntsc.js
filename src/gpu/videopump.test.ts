import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
import { VideoPump } from './videopump'

import type { PumpedFrame } from './videopump'

// A <video> as far as the pump is concerned: it reads five properties off one
// and never touches the element otherwise, which is the whole reason this half
// of the input path is separable from Sources.
const videoEl = (over: Partial<HTMLVideoElement> = {}) =>
  ({
    readyState: 2,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 0,
    paused: false,
    ...over,
  }) as HTMLVideoElement

// createImageBitmap is the only global the pump calls. Each stub records the
// calls and hands back a bitmap whose close() is observable, because a leaked
// decoded frame is the failure this class is most able to cause.
function stubBitmaps() {
  const made: { closed: boolean }[] = []
  const calls: unknown[][] = []
  let fail = false
  vi.stubGlobal('createImageBitmap', (...args: unknown[]) => {
    calls.push(args)
    if (fail) return Promise.reject(new Error('decode failed'))
    const bmp = {
      closed: false,
      close() {
        this.closed = true
      },
    }
    made.push(bmp)
    return Promise.resolve(bmp as unknown as ImageBitmap)
  })
  return {
    made,
    calls,
    setFail: (v: boolean) => {
      fail = v
    },
  }
}

const sink = () => {
  const a: PumpedFrame[] = []
  const b: PumpedFrame[] = []
  const extA: HTMLVideoElement[] = []
  const extB: HTMLVideoElement[] = []
  return {
    a,
    b,
    extA,
    extB,
    pushA: (f: PumpedFrame) => a.push(f),
    pushB: (f: PumpedFrame) => b.push(f),
    pushExtA: (el: HTMLVideoElement) => extA.push(el),
    pushExtB: (el: HTMLVideoElement) => extB.push(el),
  }
}

// One pump cycle plus the microtask turn the decode settles on.
const cycle = async (pump: VideoPump, s: ReturnType<typeof sink>) => {
  pump.pump(s)
  await Promise.resolve()
  await Promise.resolve()
}

describe('VideoPump', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delivers a decoded frame on the cycle after it was asked for', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setA(videoEl())

    // Delivery comes before the request, so the first cycle only asks.
    await cycle(pump, s)
    expect(s.a).toHaveLength(0)
    expect(bmps.calls).toHaveLength(1)

    await cycle(pump, s)
    expect(s.a).toHaveLength(1)
    expect(s.a[0].aspect).toBeCloseTo(640 / 480, 6)
  })

  it('does not re-decode a frame the texture already holds', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    const el = videoEl({ currentTime: 1.5 })
    pump.setA(el)

    // Video runs at 24/30fps under a 60fps loop, so most cycles land on a
    // currentTime the slot has already decoded. Asking anyway was 27ms of main
    // thread per video frame before the bitmap path, and is still a decode.
    for (let i = 0; i < 5; i++) await cycle(pump, s)
    expect(bmps.calls).toHaveLength(1)

    el.currentTime = 1.54
    await cycle(pump, s)
    expect(bmps.calls).toHaveLength(2)
  })

  it('caps the decode at the source texture cap, keeping aspect', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setA(videoEl({ videoWidth: 3840, videoHeight: 2160 }))
    await cycle(pump, s)

    // The resize is the point: uncapped, a 4K clip re-uploads 33MB a frame.
    const opts = bmps.calls[0][1] as ImageBitmapOptions
    expect(Math.max(opts.resizeWidth ?? 0, opts.resizeHeight ?? 0)).toBe(1536)
  })

  it('asks for B pre-cropped to the raster, so the crop goes off-thread too', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setB(videoEl({ videoWidth: 1920, videoHeight: 1080 }))
    await cycle(pump, s)

    // sx, sy, sw, sh then the options: a centred 4:3 window of a 16:9 source.
    const [, sx, sy, sw, sh, opts] = bmps.calls[0] as [
      unknown,
      number,
      number,
      number,
      number,
      ImageBitmapOptions,
    ]
    expect(sw).toBe(1440)
    expect(sh).toBe(1080)
    expect(sx).toBe(240)
    expect(sy).toBe(0)
    expect(opts.resizeWidth).toBe(ACTIVE_WIDTH)
    expect(opts.resizeHeight).toBe(ACTIVE_HEIGHT)
  })

  it('drops a frame that finished decoding after the source changed', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setA(videoEl())
    pump.pump(s) // decode in flight

    pump.setA(null)
    await Promise.resolve()
    await Promise.resolve()
    await cycle(pump, s)

    // Landing it would put one frame of the previous clip in the new one's
    // texture — a flash near-impossible to attribute afterwards.
    expect(s.a).toHaveLength(0)
    expect(bmps.made[0].closed).toBe(true)
  })

  it('asks again after a decode that failed on a paused source', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    // A still-framed element: currentTime never moves on its own, so nothing
    // but the pump itself can make the slot due again.
    pump.setA(videoEl({ paused: true, currentTime: 0 }))

    bmps.setFail(true)
    await cycle(pump, s)
    expect(bmps.calls).toHaveLength(1)

    bmps.setFail(false)
    await cycle(pump, s)
    expect(bmps.calls).toHaveLength(2)
    await cycle(pump, s)
    expect(s.a).toHaveLength(1)
  })

  it('lets a decode the slot has moved on from touch nothing', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    bmps.setFail(true)
    pump.setA(videoEl({ paused: true, currentTime: 0 }))
    pump.pump(s) // the outgoing source's decode, which will reject

    bmps.setFail(false)
    pump.setA(videoEl({ paused: true, currentTime: 3 }))
    pump.pump(s) // the incoming source's decode, still in flight
    expect(bmps.calls).toHaveLength(2)

    // Now the first one rejects. It must not clear the flag the second decode
    // set, or mark the slot due again — either one starts a redundant decode of
    // a source already being decoded.
    await Promise.resolve()
    await Promise.resolve()
    pump.pump(s)
    expect(bmps.calls).toHaveLength(2)
  })

  it('closes what it is holding when it is torn down', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setA(videoEl())
    await cycle(pump, s) // one decoded and parked, undelivered

    pump.destroy()
    expect(bmps.made[0].closed).toBe(true)
  })

  it('closes a bitmap that lands after teardown', async () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump()
    const s = sink()
    pump.setA(videoEl())
    pump.pump(s)

    pump.destroy()
    await Promise.resolve()
    await Promise.resolve()
    // An ImageBitmap holds a decoded frame's worth of memory until closed, and
    // nothing downstream survives teardown to do it.
    expect(bmps.made[0].closed).toBe(true)
  })

  it('reports whether a slot is rolling, not just attached', () => {
    stubBitmaps()
    const pump = new VideoPump()
    pump.setA(videoEl({ paused: true, currentTime: 4.256 }))
    // An element that stopped decoding leaves one frozen frame on the slot,
    // which reads as a live source unless the readout says otherwise.
    expect(pump.info().videoA).toEqual({ ready: 2, time: 4.26, paused: true })
    expect(pump.info().videoB).toBe(null)
  })

  it('direct mode hands over the element, once per video frame, no decode', () => {
    const bmps = stubBitmaps()
    const pump = new VideoPump(true)
    const s = sink()
    const el = videoEl({ currentTime: 1.5 })
    pump.setA(el)

    // Same dedup as the bitmap path: only a moved currentTime is a new frame.
    for (let i = 0; i < 5; i++) pump.pump(s)
    expect(s.extA).toEqual([el])
    el.currentTime = 1.54
    pump.pump(s)
    expect(s.extA).toHaveLength(2)
    // The whole point of the mode: nothing was decoded on the CPU.
    expect(bmps.calls).toHaveLength(0)
    expect(s.a).toHaveLength(0)
  })

  it('direct mode respects the freeze flags like the bitmap path', () => {
    stubBitmaps()
    const pump = new VideoPump(true)
    const s = sink()
    pump.setB(videoEl({ currentTime: 2 }))

    pump.pump(s, false, true) // B's deck is paused: hold the frame it has
    expect(s.extB).toHaveLength(0)
    pump.pump(s)
    expect(s.extB).toHaveLength(1)
  })
})
