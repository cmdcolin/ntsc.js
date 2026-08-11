import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
import { VideoPump } from './videopump'

import type { PumpedFrame } from './videopump'

// A <video> as far as the pump is concerned: it reads a handful of properties off
// one and listens for `seeked`, which is the whole reason this half of the input
// path is separable from Sources.
//
// `fire` is the test's handle on that listener — the wrap's cost is the time from
// the seek being issued to the decoder saying it landed, so a test that cannot say
// when it landed cannot exercise the measurement at all.
type FakeVideo = HTMLVideoElement & { fire: (type: string) => void }

const videoEl = (over: Partial<HTMLVideoElement> = {}): FakeVideo => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  return {
    readyState: 2,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 0,
    // Finite by default: a clip. The loop region is only honoured on something
    // with a timeline, so a stream arm overrides this with Infinity.
    duration: 30,
    paused: false,
    addEventListener: (
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      listeners.get(type)?.delete(fn)
    },
    fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) {
        if (typeof fn === 'function') fn(new Event(type))
      }
    },
    ...over,
  } as unknown as FakeVideo
}

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

  // The loop region: the cue buttons mark it, the pump is what actually holds the
  // playhead inside it, because this is the only thing that reads an element once
  // a frame.
  describe('loop region', () => {
    it('wraps the playhead back to the start once it passes the end', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const el = videoEl({ currentTime: 4.0 })
      pump.setA(el)
      pump.setRegionA({ start: 4.0, end: 4.3 })

      pump.pump(s)
      expect(el.currentTime).toBe(4.0) // inside: left alone
      el.currentTime = 4.29
      pump.pump(s)
      expect(el.currentTime).toBe(4.29)
      el.currentTime = 4.31
      pump.pump(s)
      expect(el.currentTime).toBe(4.0)
    })

    it('wraps on the end exactly, not one frame past it', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const el = videoEl({ currentTime: 4.3 })
      pump.setA(el)
      pump.setRegionA({ start: 4.0, end: 4.3 })

      pump.pump(s)
      expect(el.currentTime).toBe(4.0)
    })

    // A held deck stops delivering pictures; the element underneath it keeps
    // playing. If the wrap were behind the freeze gate the loop would run out of
    // its region while the button was down and come back somewhere else.
    it('wraps even while the deck is frozen', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const el = videoEl({ currentTime: 4.5 })
      pump.setA(el)
      pump.setRegionA({ start: 4.0, end: 4.3 })

      pump.pump(s, true, false)
      expect(el.currentTime).toBe(4.0)
      expect(s.a).toHaveLength(0) // and still delivered nothing
    })

    it('wraps in direct mode too', () => {
      stubBitmaps()
      const pump = new VideoPump(true)
      const s = sink()
      const el = videoEl({ currentTime: 9.9 })
      pump.setB(el)
      pump.setRegionB({ start: 8.0, end: 9.0 })

      pump.pump(s)
      expect(el.currentTime).toBe(8.0)
    })

    it('leaves the playhead alone with no region', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const el = videoEl({ currentTime: 12 })
      pump.setA(el)

      pump.pump(s)
      expect(el.currentTime).toBe(12)
    })

    // A region names positions in one particular clip. Carried across a source
    // change it would clamp a new timeline against numbers that mean nothing in
    // it — and a short region would pin the fresh clip on a single frame.
    it('forgets the region when the slot is pointed at something else', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      pump.setA(videoEl({ currentTime: 4 }))
      pump.setRegionA({ start: 4.0, end: 4.3 })

      const next = videoEl({ currentTime: 12 })
      pump.setA(next)
      pump.pump(s)
      expect(next.currentTime).toBe(12)
    })

    // The second read head. A loop with one wraps by changing elements instead
    // of seeking, which is what makes the wrap free — and the failure this has to
    // be held against is a relay that ends the loop, because a promotion that
    // went back through `setA` would clear the region on the way past.
    describe('relay', () => {
      it('continues on the head instead of seeking, and keeps looping', () => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        const el = videoEl({ currentTime: 4.31 })
        const head = videoEl({ currentTime: 4.0 })
        pump.setA(el)
        pump.setRegionA({ start: 4.0, end: 4.3 })
        pump.setRelayA(() => head)

        pump.pump(s)
        // The outgoing element is left where it was: the caller owns it now, and
        // sending it back to the in-point is the caller's job rather than a seek
        // the pump made a second decision about.
        expect(el.currentTime).toBe(4.31)

        // And the region survived, which is the whole of what `continueOn`
        // exists for. Proven by the head wrapping in its turn rather than by
        // reading a private field.
        head.currentTime = 4.31
        pump.setRelayA(() => null)
        pump.pump(s)
        expect(head.currentTime).toBe(4.0)
      })

      it('seeks when no head is ready', () => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        const el = videoEl({ currentTime: 4.31 })
        pump.setA(el)
        pump.setRegionA({ start: 4.0, end: 4.3 })
        pump.setRelayA(() => null)

        pump.pump(s)
        expect(el.currentTime).toBe(4.0)
      })

      // Being handed back the element already on air is "no head", not a swap
      // onto itself — which would bump the generation every frame and drop every
      // decode in flight.
      it('seeks when the head is the element already playing', () => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        const el = videoEl({ currentTime: 4.31 })
        pump.setA(el)
        pump.setRegionA({ start: 4.0, end: 4.3 })
        pump.setRelayA(() => el)

        pump.pump(s)
        expect(el.currentTime).toBe(4.0)
      })

      // The listener moves with the element. Left on the outgoing head, a
      // `seeked` from the re-park the caller starts would be counted as a wrap
      // this loop paid for — the one reading that must stay about the seek.
      it('does not count the outgoing head re-parking as a wrap', () => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        const el = videoEl({ currentTime: 4.31 })
        const head = videoEl({ currentTime: 4.0 })
        pump.setA(el)
        pump.setRegionA({ start: 4.0, end: 4.3 })
        pump.setRelayA(() => head)

        pump.pump(s)
        el.fire('seeked')
        expect(pump.health().a.laps).toBe(0)
      })

      it('never relays a slot that is not looping', () => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        const el = videoEl({ currentTime: 12 })
        const head = videoEl({ currentTime: 0 })
        let asked = 0
        pump.setA(el)
        pump.setRelayA(() => {
          asked += 1
          return head
        })

        pump.pump(s)
        expect(asked).toBe(0)
      })
    })

    // A live stream reports Infinity and ignores seeks. Left unguarded this is a
    // seek attempted every frame against a playhead that never comes back.
    it('never wraps a source with no timeline', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const el = videoEl({ currentTime: 9.9, duration: Infinity })
      pump.setA(el)
      pump.setRegionA({ start: 8.0, end: 9.0 })

      pump.pump(s)
      expect(el.currentTime).toBe(9.9)
    })

    // The wrap-cost measurement, which exists so the panel can tell the user a
    // clip judders because of how it was encoded (ui/cue.ts reads the threshold).
    //
    // The failure mode it has to be held against is reporting nothing, or zero. An
    // earlier version watched `currentTime` instead of the `seeked` event and did
    // exactly that: assigning currentTime snaps to a frame boundary, so the write
    // the wrap made read back as movement and closed the gap instantly.
    describe('wrap cost', () => {
      // performance.now() is what the pump times with, so the clock is driven
      // rather than waited on.
      const clock = () => {
        let t = 1000
        vi.stubGlobal('performance', { now: () => t })
        return {
          advance: (ms: number) => {
            t += ms
          },
        }
      }

      // One lap of a `frameMs`-per-frame clip: move the playhead the way a decoder
      // would, pumping across each frame like a 60Hz loop. The pump has to run
      // *after* the playhead moves, or the frame that crosses the out-point never
      // gets wrapped.
      const play = (
        pump: VideoPump,
        s: ReturnType<typeof sink>,
        el: FakeVideo,
        c: ReturnType<typeof clock>,
        frames: number,
        frameMs: number,
      ) => {
        for (let f = 0; f < frames; f++) {
          el.currentTime = Number((el.currentTime + frameMs / 1000).toFixed(3))
          for (let tick = 0; tick < frameMs / 16; tick++) {
            c.advance(16)
            pump.pump(s)
          }
        }
      }

      // The decoder taking `ms` to land the wrap's seek, then saying so.
      const seekTakes = (
        pump: VideoPump,
        s: ReturnType<typeof sink>,
        el: FakeVideo,
        c: ReturnType<typeof clock>,
        ms: number,
      ) => {
        for (let t = 0; t < ms; t += 16) {
          c.advance(16)
          pump.pump(s)
        }
        el.fire('seeked')
      }

      // Six laps of a region, each wrap taking `seekMs` to complete.
      const laps = (
        pump: VideoPump,
        s: ReturnType<typeof sink>,
        el: FakeVideo,
        c: ReturnType<typeof clock>,
        seekMs: number,
      ) => {
        for (let lap = 0; lap < 6; lap++) {
          play(pump, s, el, c, 7, 32) // 1.0 -> 1.224, past a 1.2 out-point
          expect(el.currentTime).toBe(1)
          seekTakes(pump, s, el, c, seekMs)
        }
      }

      const looping = (el: FakeVideo) => {
        stubBitmaps()
        const pump = new VideoPump()
        const s = sink()
        pump.setA(el)
        pump.setRegionA({ start: 1, end: 1.2 })
        return { pump, s }
      }

      it('says nothing until a loop has gone round twice', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump, s } = looping(el)
        play(pump, s, el, c, 7, 32)
        seekTakes(pump, s, el, c, 200)
        expect(pump.health().a.laps).toBe(1)
      })

      it('measures a quick wrap as short, and not as zero', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump, s } = looping(el)
        laps(pump, s, el, c, 16)

        const h = pump.health().a
        expect(h.laps).toBeGreaterThanOrEqual(2)
        expect(h.medianMs).toBeGreaterThan(0)
        expect(h.medianMs).toBeLessThan(50)
      })

      it('measures a stalling wrap in the hundreds of ms', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump, s } = looping(el)
        laps(pump, s, el, c, 208)

        expect(pump.health().a.medianMs).toBeGreaterThan(150)
      })

      // A seek nobody's wrap asked for — the scrub bar, a retrigger — must not be
      // counted, or dragging the bar would write a reading the note is rendered
      // from.
      it('ignores a seek that was not a wrap', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump } = looping(el)
        c.advance(500)
        el.fire('seeked')
        expect(pump.health().a.laps).toBe(0)
      })

      it('forgets what it measured when the region moves', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump, s } = looping(el)
        laps(pump, s, el, c, 208)
        expect(pump.health().a.laps).toBeGreaterThanOrEqual(2)

        // A different in-point sits a different distance from a keyframe, so the
        // old reading says nothing about it.
        pump.setRegionA({ start: 5, end: 5.2 })
        expect(pump.health().a.laps).toBe(0)
      })

      it('stops listening to an element the slot has let go of', () => {
        const c = clock()
        const el = videoEl({ currentTime: 1 })
        const { pump, s } = looping(el)
        laps(pump, s, el, c, 208)
        pump.setA(null)
        // The old element outlives the slot briefly (stopSlot retires it after);
        // a stray seeked from it must not reach a slot that has moved on.
        expect(() => el.fire('seeked')).not.toThrow()
        expect(pump.health().a.laps).toBe(0)
      })
    })

    it('wraps the two slots independently', () => {
      stubBitmaps()
      const pump = new VideoPump()
      const s = sink()
      const a = videoEl({ currentTime: 5 })
      const b = videoEl({ currentTime: 5 })
      pump.setA(a)
      pump.setB(b)
      pump.setRegionA({ start: 1, end: 2 })

      pump.pump(s)
      expect(a.currentTime).toBe(1)
      expect(b.currentTime).toBe(5)
    })
  })
})
